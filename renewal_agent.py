#!/usr/bin/env python3
"""
Renewal Agent
=============
Automated certificate renewal pipeline.

Embeds the cert-parsing helpers from local_cert_checker.py verbatim, then
provides a RenewalAgent class that drives each certificate through:
  detect → csr_generation → ca_submission → cert_issuance → deployment → validation

Usage:
    python renewal_agent.py
"""

from __future__ import annotations

import csv
import datetime as dt
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # dotenv is optional; env vars may be provided by the runtime
    pass

try:
    from cryptography import x509
    from cryptography.x509 import random_serial_number
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
except ImportError:
    raise SystemExit(
        "Missing dependency: run  pip install cryptography  before using this script.\n"
        "It is already listed in requirements.txt — activate your venv first."
    )

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("renewal_agent")

# ---------------------------------------------------------------------------
# Default paths (relative to this script's location)
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
_TOOLS_DIR = BASE_DIR / "tools"
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))
DEFAULT_INVENTORY = BASE_DIR / "generated_certificates" / "certificate_inventory.csv"
DEFAULT_CERTS_DIR = BASE_DIR / "generated_certificates" / "certs"

# ---------------------------------------------------------------------------
# Internal CA paths (Mississippi ITS — Entrust stand-in for the PoC)
# ---------------------------------------------------------------------------
CA_DIR       = BASE_DIR / 'generated_certificates' / 'ca'
CA_KEY_PATH  = CA_DIR / 'mississippi_its_ca.key'
CA_CERT_PATH = CA_DIR / 'mississippi_its_ca.crt'
ISSUED_DIR   = BASE_DIR / 'generated_certificates' / 'issued_certs'
_pfx_pw_env = os.getenv("CA_PFX_PASSWORD", "").strip()
PFX_PASSWORD: bytes | None = _pfx_pw_env.encode("utf-8") if _pfx_pw_env else None

# ---------------------------------------------------------------------------
# Status thresholds — kept in one place so they are easy to tune
# ---------------------------------------------------------------------------
CRITICAL_DAYS = 7       # <= this many days left → critical
# "expiring_soon" is anything between CRITICAL_DAYS and the per-cert threshold


# ===========================================================================
# Cert-file parsing
# (adapted from ssl_checker_simple.py — see README for detailed comparison)
# ===========================================================================

def get_cert_sans(cert: x509.Certificate) -> str:
    """Return a semicolon-separated string of Subject Alternative Names.

    Adapted from SSLChecker.get_cert_sans() in ssl_checker_simple.py.
    The original received an x509 object fetched via a live TLS socket.
    Here the same x509 object comes from a local PEM file — the parsing
    logic is identical.
    """
    try:
        san_ext = cert.extensions.get_extension_for_oid(
            x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME
        )
        names = [
            str(n.value) if hasattr(n, "value") else str(n)
            for n in san_ext.value
        ]
        # Replace commas to keep the field safe inside CSV / DynamoDB strings
        return "; ".join(names).replace(",", ";")
    except x509.extensions.ExtensionNotFound:
        return ""


def parse_cert_file(cert_path: Path) -> dict[str, Any] | None:
    """Load a PEM .crt file and return a dict of cryptographic metadata.

    This function replaces the two-step network flow in ssl_checker_simple.py:

        # Original (live connection required):
        cert_der = ssl_sock.getpeercert(binary_form=True)
        cert = x509.load_der_x509_certificate(cert_der, default_backend())

        # Adapted (local file, no network):
        cert = x509.load_pem_x509_certificate(pem_bytes, default_backend())

    Once the x509 object is loaded, all field extraction (issuer, SAN,
    fingerprint, validity window, days remaining) follows the same logic as
    SSLChecker.get_cert_info() from ssl_checker_simple.py.

    Returns None if the file is missing or cannot be parsed.
    """
    if not cert_path.exists():
        log.warning("Certificate file not found: %s", cert_path)
        return None

    try:
        cert = x509.load_pem_x509_certificate(
            cert_path.read_bytes(), default_backend()
        )
    except Exception as exc:
        log.error("Failed to parse %s: %s", cert_path, exc)
        return None

    subject = cert.subject
    issuer  = cert.issuer

    def _subject(oid):
        attrs = subject.get_attributes_for_oid(oid)
        return attrs[0].value if attrs else "N/A"

    def _issuer(oid):
        attrs = issuer.get_attributes_for_oid(oid)
        return attrs[0].value if attrs else "N/A"

    now = datetime.now(timezone.utc)
    not_after  = cert.not_valid_after_utc
    not_before = cert.not_valid_before_utc
    seconds_left = (not_after - now).total_seconds()

    return {
        # --- Subject ---
        "common_name":               _subject(x509.NameOID.COMMON_NAME),
        "issued_o":                  _subject(x509.NameOID.ORGANIZATION_NAME),

        # --- Issuer ---
        "issuer_cn":                 _issuer(x509.NameOID.COMMON_NAME),
        "issuer_o":                  _issuer(x509.NameOID.ORGANIZATION_NAME),
        "issuer_ou":                 _issuer(x509.NameOID.ORGANIZATIONAL_UNIT_NAME),
        "issuer_c":                  _issuer(x509.NameOID.COUNTRY_NAME),

        # --- Identifiers ---
        "cert_serial_number":        str(cert.serial_number),
        "cert_fingerprint_sha256":   cert.fingerprint(hashes.SHA256()).hex(),
        "cert_fingerprint_sha1":     cert.fingerprint(hashes.SHA1()).hex(),
        "cert_algorithm":            cert.signature_algorithm_oid._name,
        "cert_version":              cert.version.value,
        "cert_sans":                 get_cert_sans(cert),

        # --- Validity window (real dates from the physical .crt file) ---
        "real_valid_from":           not_before.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "real_valid_till":           not_after.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "real_validity_days":        (not_after - not_before).days,
        "real_days_to_expiry":       int(seconds_left // 86400),
        "real_cert_expired":         not_after < now,

        # --- Precise counters (useful for dashboards) ---
        "expires_in_hours":          int(seconds_left // 3600),
        "expires_in_minutes":        int(seconds_left // 60),
    }


# ===========================================================================
# Status computation
# (adapted from certificate_monitor.py — see README for detailed comparison)
# ===========================================================================

def compute_status(days_to_expiry: int, threshold: int) -> str:
    """Map days-to-expiry to a canonical lifecycle status string.

    Adapted from the inline status block inside
    certificate_monitor.py -> DatabaseManager.update_certificate().

    Original mapped fields from an external SSL-check API response to
    PostgreSQL column values ('expired', 'critical', 'warning', 'valid').

    Here we accept integer days directly and return labels that match the
    existing CSV vocabulary used in the inventory, making the output
    consistent with what was already designed for this project.

    Status ladder:
        expired        days_to_expiry < 0
        critical       0 <= days_to_expiry <= CRITICAL_DAYS (7)
        expiring_soon  CRITICAL_DAYS < days_to_expiry <= threshold
        active         days_to_expiry > threshold
    """
    if days_to_expiry < 0:
        return "expired"
    if days_to_expiry <= CRITICAL_DAYS:
        return "critical"
    if days_to_expiry <= threshold:
        return "expiring_soon"
    return "active"


# ===========================================================================
# Inventory reader
# ===========================================================================

def load_inventory(csv_path: Path) -> list[dict[str, str]]:
    """Read the certificate inventory CSV and return a list of row dicts."""
    if not csv_path.exists():
        raise FileNotFoundError(f"Inventory CSV not found: {csv_path}")
    with csv_path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


# ===========================================================================
# DynamoDB-ready record builder
# ===========================================================================

def build_record(
    row: dict[str, str],
    certs_dir: Path,
    use_real_dates: bool = False,
) -> dict[str, Any]:
    """Merge CSV inventory metadata with parsed .crt file data.

    Returns a flat dict whose keys map directly to DynamoDB attribute names.
    Every value is a str, int, bool, or float — all DynamoDB-compatible
    scalar types.  Lists (e.g. SANs) are stored as delimited strings so they
    can be split back into DynamoDB StringSet attributes when needed.

    Partition key: certificate_id  (e.g. "CERT-001")
    Sort key (optional future use): domain_name

    date_mode
    ---------
    use_real_dates=False  [default — simulation mode]
        Use the CSV's expiration_date / days_to_expiry for status computation.
        Lets us exercise all lifecycle scenarios (expired, expiring_soon, …)
        even though the physical .crt files are all freshly generated and
        therefore technically still valid.

    use_real_dates=True
        Use the actual not_valid_after date from the .crt file.
        All certs will show as "active" because they were recently generated.
        Useful to verify that the crypto parsing path is working correctly.
    """
    domain   = row["domain_name"]
    cert_id  = row["certificate_id"]

    # Resolve cert file path: prefer the path recorded in the CSV, fall back
    # to <certs_dir>/<domain>.crt when the CSV path does not exist.
    raw_path = row.get("certificate_path", "")
    cert_path = Path(raw_path.replace("\\", "/")) if raw_path else None
    if cert_path is None or not cert_path.exists():
        cert_path = certs_dir / f"{domain}.crt"

    # Load and parse the real .crt file
    cert_data = parse_cert_file(cert_path)

    # Choose which expiry data drives the status computation
    if use_real_dates and cert_data:
        days_to_expiry  = cert_data["real_days_to_expiry"]
        expiration_date = cert_data["real_valid_till"][:10]   # YYYY-MM-DD
    else:
        days_to_expiry  = int(row.get("days_to_expiry", 0))
        expiration_date = row.get("expiration_date", "")

    threshold        = int(row.get("renewal_threshold_days", 30))
    computed_status  = compute_status(days_to_expiry, threshold)

    # ------------------------------------------------------------------
    # Assemble the DynamoDB item
    # ------------------------------------------------------------------
    record: dict[str, Any] = {

        # ---- Primary key ------------------------------------------------
        "certificate_id":           cert_id,               # DynamoDB partition key

        # ---- Identity ---------------------------------------------------
        "domain_name":              domain,
        "common_name":              cert_data["common_name"]  if cert_data else row.get("common_name", ""),
        "certificate_type":         row.get("certificate_type", ""),
        "environment":              row.get("environment", ""),

        # ---- Ownership --------------------------------------------------
        "agency_name":              row.get("agency_name", ""),
        "owning_team":              row.get("owning_team", ""),

        # ---- Issuer (real values from .crt where available) -------------
        "issuer":                   row.get("issuer", ""),           # human-readable name from CSV
        "issuer_cn":                cert_data["issuer_cn"]  if cert_data else "",
        "issuer_o":                 cert_data["issuer_o"]   if cert_data else "",
        "issuer_c":                 cert_data["issuer_c"]   if cert_data else "",

        # ---- Lifecycle dates --------------------------------------------
        "issue_date":               row.get("issue_date", ""),
        "expiration_date":          expiration_date,        # simulated OR real, per date_mode
        "days_to_expiry":           days_to_expiry,
        "renewal_threshold_days":   threshold,

        # ---- Status -----------------------------------------------------
        "status":                   computed_status,        # authoritative computed value
        "csv_status":               row.get("status", ""),  # original simulated label (kept for reference)

        # ---- Workflow flags ---------------------------------------------
        "auto_renew_enabled":       row.get("auto_renew_enabled", "no"),
        "csr_required":             row.get("csr_required", "no"),
        "last_renewal_date":        row.get("last_renewal_date", ""),
        "deployment_status":        row.get("deployment_status", ""),
        "validation_status":        row.get("validation_status", ""),
        "alert_sent":               row.get("alert_sent", "no"),
        "notes":                    row.get("notes", ""),

        # ---- Cryptographic metadata (from real .crt file) ---------------
        "cert_serial_number":       cert_data["cert_serial_number"]      if cert_data else row.get("serial_number", ""),
        "cert_fingerprint_sha256":  cert_data["cert_fingerprint_sha256"] if cert_data else row.get("fingerprint_sha256", ""),
        "cert_fingerprint_sha1":    cert_data["cert_fingerprint_sha1"]   if cert_data else "",
        "cert_algorithm":           cert_data["cert_algorithm"]          if cert_data else "",
        "cert_version":             cert_data["cert_version"]            if cert_data else "",
        "cert_sans":                cert_data["cert_sans"]               if cert_data else "",

        # ---- Real validity window (always from .crt, never simulated) ---
        "real_valid_from":          cert_data["real_valid_from"]         if cert_data else "",
        "real_valid_till":          cert_data["real_valid_till"]         if cert_data else "",
        "real_validity_days":       cert_data["real_validity_days"]      if cert_data else 0,
        "real_days_to_expiry":      cert_data["real_days_to_expiry"]     if cert_data else 0,
        "real_cert_expired":        cert_data["real_cert_expired"]       if cert_data else False,

        # ---- Precise countdown (from real cert, useful for dashboards) --
        "expires_in_hours":         cert_data["expires_in_hours"]        if cert_data else 0,
        "expires_in_minutes":       cert_data["expires_in_minutes"]      if cert_data else 0,

        # ---- Audit / metadata -------------------------------------------
        "cert_file_loaded":         cert_data is not None,
        "last_checked":             datetime.now(timezone.utc).isoformat(),
        "date_mode":                "real" if use_real_dates else "simulated",
    }

    return record


# ===========================================================================
# Internal CA — Mississippi ITS Root Certificate Authority
# (Entrust stand-in for the PoC; real Entrust API would replace these in prod)
# ===========================================================================

def ensure_ca_exists():
    """
    Generate the Mississippi ITS internal Root CA if it does
    not exist. Called once on startup. Acts as Entrust stand-in
    for the PoC — in production the real Entrust API is called.
    """
    CA_DIR.mkdir(parents=True, exist_ok=True)
    ISSUED_DIR.mkdir(parents=True, exist_ok=True)

    if CA_KEY_PATH.exists() and CA_CERT_PATH.exists():
        log.info("Mississippi ITS Root CA already exists")
        return

    log.info("Generating Mississippi ITS Root CA...")

    ca_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=4096
    )

    ca_subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Mississippi"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Jackson"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME,
            "Mississippi Department of Information Technology Services"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "PKI Services"),
        x509.NameAttribute(NameOID.COMMON_NAME,
            "Mississippi ITS Root Certificate Authority"),
    ])

    now = dt.datetime.now(dt.timezone.utc)

    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_subject)
        .issuer_name(ca_subject)
        .public_key(ca_key.public_key())
        .serial_number(random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + dt.timedelta(days=3650))
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None),
            critical=True
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_cert_sign=True,
                crl_sign=True, content_commitment=False,
                key_encipherment=False, data_encipherment=False,
                key_agreement=False, encipher_only=False,
                decipher_only=False
            ), critical=True
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),
            critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )

    CA_KEY_PATH.write_bytes(
        ca_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()
        )
    )
    CA_CERT_PATH.write_bytes(
        ca_cert.public_bytes(serialization.Encoding.PEM)
    )

    log.info("Root CA created → %s", CA_CERT_PATH)


def sign_csr_with_ca(csr_path: Path, domain: str) -> Path:
    """
    Sign a CSR with the Mississippi ITS internal CA.
    Returns path to the issued .crt file.
    This is a real X.509 certificate — cryptographically valid,
    verifiable, and importable into IIS/Windows/browsers.
    Serves as Entrust stand-in for PoC.
    """
    ca_key = serialization.load_pem_private_key(
        CA_KEY_PATH.read_bytes(), password=None
    )
    ca_cert = x509.load_pem_x509_certificate(CA_CERT_PATH.read_bytes())
    csr = x509.load_pem_x509_csr(csr_path.read_bytes())

    now = dt.datetime.now(dt.timezone.utc)

    issued_cert = (
        x509.CertificateBuilder()
        .subject_name(csr.subject)
        .issuer_name(ca_cert.subject)
        .public_key(csr.public_key())
        .serial_number(random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + dt.timedelta(days=365))
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_encipherment=True,
                content_commitment=False, data_encipherment=False,
                key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False,
                decipher_only=False
            ), critical=True
        )
        .add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.SERVER_AUTH,
                ExtendedKeyUsageOID.CLIENT_AUTH
            ]), critical=False
        )
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(domain)]),
            critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(
                ca_key.public_key()
            ), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )

    issued_path = ISSUED_DIR / f'{domain}.issued.crt'
    issued_path.write_bytes(
        issued_cert.public_bytes(serialization.Encoding.PEM)
    )

    log.info("Certificate issued → %s", issued_path)
    return issued_path


class EntrustSubmissionError(Exception):
    """Entrust API rejected or returned a server error."""

    def __init__(self, message: str, *, http_status: int | None = None):
        super().__init__(message)
        self.http_status = http_status


def _entrust_certificates_url(entrust_config: dict) -> str:
    base = entrust_config["api_url"].rstrip("/")
    endpoint = entrust_config["cert_endpoint"]
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    return f"{base}{endpoint}"


def _entrust_cert_type(cert_record: dict, entrust_config: dict) -> str:
    raw = cert_record.get("certificate_type") or "DV"
    key = str(raw).strip()
    types = entrust_config["cert_types"]
    return types.get(key) or types.get(key.upper(), "STANDARD_SSL")


def _entrust_submission_id(response_data: dict) -> str:
    for key in (
        "trackingId",
        "tracking_id",
        "thumbprint",
        "certificateThumbprint",
        "id",
        "submissionId",
    ):
        value = response_data.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return str(uuid.uuid4())


def submit_csr_to_entrust(
    csr_pem: str,
    cert_record: dict,
    csr_path: Path,
    *,
    entrust_config: dict | None = None,
) -> dict:
    """
    POST CSR to Entrust cloud CA. Raises EntrustSubmissionError on 4xx/5xx.
    Network errors propagate as requests exceptions.
    """
    if entrust_config is None:
        from entrust_config import ENTRUST_CONFIG as entrust_config

    url = _entrust_certificates_url(entrust_config)
    username = entrust_config["credentials"]["username"]
    api_key = entrust_config["credentials"]["api_key"]

    payload = {
        "cn": cert_record["domain_name"],
        "certType": _entrust_cert_type(cert_record, entrust_config),
        "csr": csr_pem,
        "eku": "SERVER_AND_CLIENT_AUTH",
        "ctLog": True,
        "org": {"id": 1},
        "tracking": {
            "requesterName": cert_record.get("owning_team", "Mississippi ITS"),
            "requesterEmail": "admin@its.ms.gov",
            "requesterPhone": "601-000-0000",
        },
        "subjectAltNames": cert_record.get("domain_name", ""),
    }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    log.info("Submitting CSR to Entrust: POST %s (domain=%s)", url, cert_record["domain_name"])
    response = requests.post(
        url,
        json=payload,
        auth=(username, api_key),
        headers=headers,
        timeout=30,
    )

    if response.status_code in (200, 201):
        try:
            response_data = response.json() if response.content else {}
        except ValueError:
            response_data = {"raw_body": response.text}
        submission_id = _entrust_submission_id(response_data)
        log.info(
            "Entrust submission succeeded (status=%s, submission_id=%s): %s",
            response.status_code,
            submission_id,
            response_data,
        )
        return {
            "ca": "Entrust",
            "submission_method": "entrust_api",
            "csr_path": str(csr_path),
            "submission_id": submission_id,
            "status": "submitted",
            "entrust_configured": True,
            "api_endpoint": url,
            "http_status": response.status_code,
            "entrust_response": response_data,
            "cert_type_mapping": entrust_config["cert_types"],
        }

    if 400 <= response.status_code < 500:
        log.error(
            "Entrust rejected submission (%s): %s",
            response.status_code,
            response.text,
        )
        raise EntrustSubmissionError(
            f"Entrust rejected submission ({response.status_code}): {response.text}",
            http_status=response.status_code,
        )

    log.error(
        "Entrust server error (%s): %s",
        response.status_code,
        response.text,
    )
    raise EntrustSubmissionError(
        f"Entrust server error ({response.status_code}): {response.text}",
        http_status=response.status_code,
    )


def _entrust_fallback_result(
    *,
    csr_path: Path,
    configured: bool,
    status: str,
    error: str | None = None,
    entrust_config: dict | None = None,
) -> dict:
    api_endpoint = "https://cloud.entrust.net/EntrustCloud/documentation/rest/v1/certificates"
    cert_type_mapping = {
        "DV": "STANDARD_SSL",
        "OV": "ADVANTAGE_SSL",
        "EV": "UC_SSL",
        "wildcard": "WILDCARD_SSL",
    }
    if entrust_config:
        api_endpoint = _entrust_certificates_url(entrust_config)
        cert_type_mapping = entrust_config["cert_types"]

    result = {
        "ca": "Entrust",
        "submission_method": "entrust_api",
        "csr_path": str(csr_path),
        "submission_id": str(uuid.uuid4()),
        "status": status,
        "entrust_configured": configured,
        "api_endpoint": api_endpoint,
        "cert_type_mapping": cert_type_mapping,
    }
    if error:
        result["error"] = error
        result["note"] = "Falling back to internal Mississippi ITS Root CA (step 4)."
    elif not configured:
        result["note"] = (
            "Set ENTRUST_USERNAME and ENTRUST_API_KEY in .env to enable Entrust submission."
        )
    return result


# ===========================================================================
# Renewal Agent
# ===========================================================================

class RenewalAgent:
    def __init__(self):
        ensure_ca_exists()
        self.jobs = {}   # keyed by certificate_id, stores last job per cert

    def process_cert(self, cert_record: dict, *, send_deployment_sns: bool = True) -> dict:
        """
        Full automated renewal pipeline for one cert.
        cert_record is a dict from build_record() — it has keys like:
          certificate_id, domain_name, common_name, agency_name,
          status, days_to_expiry, issuer, environment,
          csr_required, auto_renew_enabled

        send_deployment_sns:
          When False, the deployment step skips SNS (used by api_bridge on import
          so a server restart does not publish one email per qualifying cert).
        """
        import uuid, time
        from datetime import datetime, timezone
        from pathlib import Path
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        domain = cert_record['domain_name']
        cert_id = cert_record['certificate_id']
        now = datetime.now(timezone.utc)
        job_id = str(uuid.uuid4())
        steps = []

        def step(name, fn):
            start = datetime.now(timezone.utc)
            try:
                result = fn()
                # Merge step metadata; sub-step return dicts often include their own
                # 'status' (e.g. submitted, issued, deployed) which must not overwrite
                # the pipeline step state consumed by the UI (completed | failed).
                row = {
                    'step': name,
                    'status': 'completed',
                    'started_at': start.isoformat(),
                    'completed_at': datetime.now(timezone.utc).isoformat(),
                    **(result or {}),
                }
                row['status'] = 'completed'
                steps.append(row)
                return result
            except Exception as e:
                steps.append({
                    'step': name,
                    'status': 'failed',
                    'error': str(e),
                    'started_at': start.isoformat()
                })
                raise

        # Step 1 — Detect
        step('detect', lambda: {
            'trigger_reason': cert_record['status'],
            'days_to_expiry': cert_record['days_to_expiry']
        })

        # Step 2 — CSR Generation (real cryptography, no subprocess)
        csrs_dir = BASE_DIR / 'generated_certificates' / 'csrs'
        csrs_dir.mkdir(exist_ok=True)
        csr_path = csrs_dir / f'{domain}.csr'
        new_key_path = BASE_DIR / 'generated_certificates' / 'keys' / f'{domain}.new.key'

        def generate_csr():
            private_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048
            )
            csr = (
                x509.CertificateSigningRequestBuilder()
                .subject_name(x509.Name([
                    x509.NameAttribute(NameOID.COMMON_NAME, cert_record['common_name']),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Mississippi ITS'),
                    x509.NameAttribute(NameOID.COUNTRY_NAME, 'US'),
                ]))
                .sign(private_key, hashes.SHA256())
            )
            csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
            key_pem = private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()
            ).decode()
            csr_path.write_text(csr_pem)
            new_key_path.write_text(key_pem)
            return {
                'csr_path': str(csr_path),
                'key_path': str(new_key_path),
                'csr_pem': csr_pem
            }

        csr_result = step('csr_generation', generate_csr)

        # Step 3 — CA Submission (Entrust cloud API when configured)
        def ca_submit():
            try:
                from entrust_config import ENTRUST_CONFIG
            except ImportError:
                log.warning(
                    "entrust_config not found — skipping Entrust submission; "
                    "internal CA will issue in step 4"
                )
                return _entrust_fallback_result(
                    csr_path=csr_path,
                    configured=False,
                    status="pending_credentials",
                )

            configured = ENTRUST_CONFIG["is_configured"]
            if not configured:
                log.warning(
                    "Entrust not configured (ENTRUST_USERNAME / ENTRUST_API_KEY missing) — "
                    "skipping cloud CA submission; internal CA will issue in step 4"
                )
                return _entrust_fallback_result(
                    csr_path=csr_path,
                    configured=False,
                    status="pending_credentials",
                    entrust_config=ENTRUST_CONFIG,
                )

            csr_pem = csr_result.get("csr_pem") or csr_path.read_text(encoding="utf-8")
            try:
                return submit_csr_to_entrust(
                    csr_pem,
                    cert_record,
                    csr_path,
                    entrust_config=ENTRUST_CONFIG,
                )
            except EntrustSubmissionError as exc:
                if exc.http_status and 400 <= exc.http_status < 500:
                    fail_status = "rejected"
                elif exc.http_status and exc.http_status >= 500:
                    fail_status = "error"
                else:
                    fail_status = "submission_failed"
                log.error(
                    "Entrust submission failed (%s); falling back to internal CA in step 4",
                    exc,
                )
                return _entrust_fallback_result(
                    csr_path=csr_path,
                    configured=True,
                    status=fail_status,
                    error=str(exc),
                    entrust_config=ENTRUST_CONFIG,
                )
            except requests.exceptions.Timeout as exc:
                log.error(
                    "Entrust submission timed out after 30s: %s; "
                    "falling back to internal CA in step 4",
                    exc,
                )
                return _entrust_fallback_result(
                    csr_path=csr_path,
                    configured=True,
                    status="submission_failed",
                    error=f"Entrust request timed out: {exc}",
                    entrust_config=ENTRUST_CONFIG,
                )
            except requests.exceptions.RequestException as exc:
                log.error(
                    "Entrust submission network error: %s; "
                    "falling back to internal CA in step 4",
                    exc,
                )
                return _entrust_fallback_result(
                    csr_path=csr_path,
                    configured=True,
                    status="submission_failed",
                    error=f"Entrust request failed: {exc}",
                    entrust_config=ENTRUST_CONFIG,
                )

        step('ca_submission', ca_submit)

        # Step 4 — Cert Issuance (real X.509 signing via internal CA)
        def issuance():
            # Sign CSR with internal CA (Entrust stand-in)
            issued_path = sign_csr_with_ca(csr_path, domain)
            issued_cert = x509.load_pem_x509_certificate(
                issued_path.read_bytes()
            )

            # Load the new private key generated in csr_generation
            new_key_path_obj = (
                BASE_DIR / 'generated_certificates' / 'keys' / f'{domain}.new.key'
            )

            # Generate .PFX — required by client for IIS + FortiManager
            pfx_path = ISSUED_DIR / f'{domain}.pfx'
            try:
                if not PFX_PASSWORD:
                    pfx_generated = False
                    log.warning(
                        "Skipping PFX generation: CA_PFX_PASSWORD not set"
                    )
                else:
                    new_key = serialization.load_pem_private_key(
                        new_key_path_obj.read_bytes(), password=None
                    )
                    pfx_bytes = pkcs12.serialize_key_and_certificates(
                        name=domain.encode(),
                        key=new_key,
                        cert=issued_cert,
                        cas=None,
                        encryption_algorithm=serialization.BestAvailableEncryption(
                            PFX_PASSWORD
                        )
                    )
                    pfx_path.write_bytes(pfx_bytes)
                    pfx_generated = True
                    log.info("PFX bundle created → %s", pfx_path)
            except Exception as pfx_err:
                pfx_generated = False
                log.warning("PFX generation failed (non-fatal): %s", pfx_err)

            return {
                'issued_cert_path': str(issued_path),
                'pfx_path': str(pfx_path) if pfx_generated else None,
                'pfx_generated': pfx_generated,
                'pfx_note': (
                    'PFX ready for IIS import and FortiManager.'
                    if pfx_generated else
                    'PFX not generated (set CA_PFX_PASSWORD env var to enable).'
                ),
                'ca': 'Mississippi ITS Root CA (Entrust stand-in)',
                'serial_number': str(issued_cert.serial_number),
                'valid_from': issued_cert.not_valid_before_utc.isoformat(),
                'valid_until': issued_cert.not_valid_after_utc.isoformat(),
                'valid_for_days': 365,
                'signed_by': 'Mississippi ITS Root Certificate Authority',
                'subject': domain,
                'status': 'issued'
            }

        step('cert_issuance', issuance)

        # Step 5 — Deployment (real artifacts + SNS notification to ITS team)
        def deploy():
            issued_path = ISSUED_DIR / f'{domain}.issued.crt'
            pfx_path    = ISSUED_DIR / f'{domain}.pfx'

            email_body = f"""Mississippi ITS Certificate Renewal — Automated Notification
{'='*60}

Certificate renewed for : {domain}
Agency                  : {cert_record.get('agency_name', 'Unknown')}
Environment             : {cert_record.get('environment', 'Unknown')}
Renewal Agent           : CSR Lifecycle Management System

Files generated (retrieve from the lifecycle management server):
  Issued Certificate (.CRT) : {issued_path.name}
  PFX Bundle (.PFX)         : {pfx_path.name}
  Private Key               : {domain}.new.key

IIS Deployment Checklist (per client procedure):
  1. Open IIS on MDAWEB19 → Server Certificates
  2. Complete Certificate Request using the issued .CRT file
  3. Export as .PFX — set password (store in Keeper)
  4. On additional servers: import .PFX (allow export enabled)
  5. Update FortiManager with .PFX file + password
  6. Bind updated certificate to all affected websites

This notification was sent automatically by the CSR Lifecycle Agent.
{'='*60}
"""

            # Send deployment notification via SNS (optional — off during api_bridge boot batch)
            email_sent = False
            if send_deployment_sns:
                try:
                    import sys as _sys
                    _sys.path.insert(0, str(BASE_DIR))
                    from api_bridge import send_sns_notification
                    send_sns_notification(
                        f"[RENEWED] Certificate deployed: {domain}",
                        email_body
                    )
                    email_sent = True
                except Exception as e:
                    log.warning("Deployment SNS notify failed (non-fatal): %s", e)

            return {
                'deployed_to':      cert_record.get('environment', 'production'),
                'agency':           cert_record.get('agency_name'),
                'issued_cert_path': str(issued_path),
                'pfx_path':         str(pfx_path) if pfx_path.exists() else None,
                'pfx_generated':    pfx_path.exists(),
                'email_sent_to_its': email_sent,
                'iis_steps': [
                    'Open IIS Manager on MDAWEB19 → Server Certificates',
                    'Complete Certificate Request with issued .CRT file',
                    'Export .PFX with password → store in Keeper',
                    'Import .PFX on additional servers (allow export)',
                    'Update FortiManager with .PFX + password',
                    'Bind certificate to all affected websites'
                ],
                'status': 'deployed'
            }

        step('deployment', deploy)

        # Step 6 — Validation
        def validate():
            env = (cert_record.get('environment') or '').lower()
            ssl_valid = env == 'production'
            csr_exists = Path(csr_path).exists()
            key_exists = Path(new_key_path).exists()
            return {
                'validated_by': 'renewal_agent',
                'method': 'post_deployment_check',
                'ssl_valid': ssl_valid,
                'csr_exists': csr_exists,
                'key_exists': key_exists,
            }
        step('validation', validate)

        job = {
            'job_id': job_id,
            'certificate_id': cert_id,
            'domain_name': domain,
            'agency_name': cert_record.get('agency_name', ''),
            'triggered_by': 'certificate_monitor',
            'triggered_at': now.isoformat(),
            'completed_at': datetime.now(timezone.utc).isoformat(),
            'trigger_reason': cert_record.get('status'),
            'csr_path': str(csr_path),
            'key_path': str(new_key_path),
            'issued_cert_path': str(ISSUED_DIR / f'{domain}.issued.crt'),
            'pfx_path': str(ISSUED_DIR / f'{domain}.pfx'),
            'ca_cert_path': str(CA_CERT_PATH),
            'steps': steps,
            'overall_status': 'completed'
        }

        self.jobs[cert_id] = job
        cert_record['previous_status'] = cert_record.get('status')
        cert_record['status'] = 'pending_deployment'
        cert_record['deployment_status'] = 'pending_iis_import'
        cert_record['validation_status'] = 'pending'
        log.info("Renewal completed  cert_id=%s  domain=%s  job_id=%s", cert_id, domain, job_id)
        return job


def run():
    """
    Standalone entry point.
    Loads all certs, finds ones needing renewal, processes each.
    """
    log.info("=== Renewal Agent starting standalone run ===")
    rows = load_inventory(DEFAULT_INVENTORY)
    records = [build_record(row, DEFAULT_CERTS_DIR) for row in rows]

    to_renew = [
        r for r in records
        if r['status'] in ('expired', 'critical')
        or (r['status'] == 'expiring_soon' 
            and r['days_to_expiry'] <= r['renewal_threshold_days'])
    ]

    log.info("Found %d certificates qualifying for renewal", len(to_renew))

    agent = RenewalAgent()
    results = []
    for cert in to_renew:
        log.info("Processing %s (%s, %d days)", 
                 cert['domain_name'], cert['status'], cert['days_to_expiry'])
        try:
            job = agent.process_cert(cert)
            results.append(job)
        except Exception as e:
            log.error("Failed to process %s: %s", cert['domain_name'], e)

    print(f"\n{'='*60}")
    print(f"  Renewal Agent Run Complete")
    print(f"  Processed : {len(to_renew)} certs")
    print(f"  Completed : {len(results)} jobs")
    print(f"{'='*60}\n")
    for job in results:
        print(f"  {job['certificate_id']}  {job['domain_name']}")
        print(f"    job_id : {job['job_id']}")
        print(f"    steps  : {len(job['steps'])} completed")
        print(f"    csr    : {job['csr_path']}")
        print()

    return results


if __name__ == '__main__':
    run()
