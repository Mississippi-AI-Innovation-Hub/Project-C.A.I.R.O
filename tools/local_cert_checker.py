#!/usr/bin/env python3
"""
Local Certificate Checker
==========================
Reads the certificate inventory (CSV) and local .crt files, extracts real
cryptographic metadata, computes lifecycle status, and produces a
DynamoDB-ready record for each certificate.

No live network connections.  No database required.
All data comes from:
  - generated_certificates/certificate_inventory.csv   (lifecycle metadata)
  - generated_certificates/certs/*.crt                 (real OpenSSL cert files)

Adapted from "ssl checker python/ssl_checker_simple.py":
  - SSLChecker.get_cert_info()   ->  parse_cert_file()
  - SSLChecker.get_cert_sans()   ->  get_cert_sans()
  - Status determination logic   ->  compute_status()

See README_local_cert_checker.md for full explanation.

Usage:
    python local_cert_checker.py
    python local_cert_checker.py --output results.json
    python local_cert_checker.py --use-real-dates
    python local_cert_checker.py --filter-status expired
    python local_cert_checker.py --filter-status expiring_soon --output expiring.json
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
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
log = logging.getLogger("local_cert_checker")

# ---------------------------------------------------------------------------
# Default paths (relative to this script's location)
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent.parent   # tools/ → project root
DEFAULT_INVENTORY = BASE_DIR / "generated_certificates" / "certificate_inventory.csv"
DEFAULT_CERTS_DIR = BASE_DIR / "generated_certificates" / "certs"

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
# Console summary
# ===========================================================================

# Controls display ordering in the summary table
_STATUS_ORDER = ["expired", "critical", "expiring_soon", "active", "unknown"]

def print_summary(records: list[dict[str, Any]]) -> None:
    """Print a human-readable summary table to stdout."""
    by_status: dict[str, list] = {}
    for r in records:
        by_status.setdefault(r.get("status", "unknown"), []).append(r)

    print("\n" + "=" * 72)
    print(f"  Certificate Inventory Summary  —  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 72)
    print(f"  Total : {len(records)}")
    for s in _STATUS_ORDER:
        count = len(by_status.get(s, []))
        if count:
            marker = "  !" if s in ("expired", "critical") else "   "
            print(f"{marker} {s:<20} {count}")
    print("=" * 72)

    for s in _STATUS_ORDER:
        group = by_status.get(s, [])
        if not group:
            continue
        print(f"\n[{s.upper()}]")
        for r in group:
            loaded = "ok     " if r["cert_file_loaded"] else "MISSING"
            print(
                f"  {r['certificate_id']}  "
                f"{r['domain_name']:<47}"
                f"  days={r['days_to_expiry']:>4}  "
                f"file={loaded}"
            )
    print()


# ===========================================================================
# CLI
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Check local dummy SSL certificates against the inventory CSV "
            "and produce DynamoDB-ready records."
        )
    )
    p.add_argument(
        "--inventory",
        type=Path,
        default=DEFAULT_INVENTORY,
        metavar="PATH",
        help="Path to certificate_inventory.csv  (default: %(default)s)",
    )
    p.add_argument(
        "--certs-dir",
        type=Path,
        default=DEFAULT_CERTS_DIR,
        metavar="DIR",
        help="Folder containing .crt files  (default: %(default)s)",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=None,
        metavar="FILE",
        help="Write JSON results to this file  (default: print to stdout)",
    )
    p.add_argument(
        "--use-real-dates",
        action="store_true",
        default=False,
        help=(
            "Derive status from the actual not_valid_after date in the .crt "
            "file instead of the simulated expiration_date in the CSV.  "
            "All certs will show 'active' because they were freshly generated."
        ),
    )
    p.add_argument(
        "--filter-status",
        metavar="STATUS",
        default=None,
        help=(
            "Only output records with this computed status.  "
            "Choices: expired | critical | expiring_soon | active"
        ),
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    log.info("Loading inventory from %s", args.inventory)
    rows = load_inventory(args.inventory)
    log.info("Found %d certificates in inventory", len(rows))

    records: list[dict[str, Any]] = []
    for row in rows:
        rec = build_record(row, args.certs_dir, use_real_dates=args.use_real_dates)
        records.append(rec)
        log.info(
            "%-10s  %-47s  status=%-14s  days=%4d  file=%s",
            rec["certificate_id"],
            rec["domain_name"],
            rec["status"],
            rec["days_to_expiry"],
            "ok" if rec["cert_file_loaded"] else "MISSING",
        )

    # Optional status filter
    if args.filter_status:
        before  = len(records)
        records = [r for r in records if r["status"] == args.filter_status]
        log.info(
            "Filtered to %d / %d records with status=%s",
            len(records), before, args.filter_status,
        )

    print_summary(records)

    payload = json.dumps(records, indent=2, default=str)

    if args.output:
        args.output.write_text(payload, encoding="utf-8")
        log.info("Results written to %s", args.output)
    else:
        print(payload)


if __name__ == "__main__":
    main()
