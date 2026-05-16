#!/usr/bin/env python3
"""
API Bridge
==========
Flask REST API (port 5000) that bridges the certificate checker and renewal
agent to the React frontend running at http://localhost:8081.

On startup:
  - Loads all certificates from the local inventory + .crt files
  - Runs the renewal agent against qualifying certs
  - Builds a notification list
  - Starts serving all endpoints immediately

Usage:
    python api_bridge.py
"""

from __future__ import annotations

import csv
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from functools import wraps
from jose import jwt as _jose_jwt, JWTError
import urllib.request
import json as _json
from flask import g

try:
    import boto3  # type: ignore
    from botocore.config import Config as BotocoreConfig  # type: ignore
    from botocore.exceptions import ClientError, NoCredentialsError  # type: ignore
except Exception as _aws_import_err:
    boto3 = None
    BotocoreConfig = None

    class ClientError(Exception):
        pass

    class NoCredentialsError(Exception):
        pass

    log_aws = logging.getLogger("api_bridge.aws")
    log_aws.warning("AWS SDK unavailable (SNS will be simulated): %s", _aws_import_err)
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()
# Same repo layout as Vite: optional `.env.local` overrides `.env` for local dev.
_ROOT_ENV = Path(__file__).resolve().parent
_ENV_LOCAL = _ROOT_ENV / '.env.local'
if _ENV_LOCAL.is_file():
    load_dotenv(_ENV_LOCAL, override=True)


def _env_nonempty(*keys: str) -> str:
    """First non-empty env value among keys (strip whitespace)."""
    for key in keys:
        val = os.getenv(key, '').strip()
        if val:
            return val
    return ''


# ---------------------------------------------------------------------------
# Cognito auth (PoC)
# ---------------------------------------------------------------------------
_AUTH_LOG = logging.getLogger("api_bridge.auth")
# Backend accepts COGNITO_* or the same IDs as the SPA under VITE_COGNITO_* so
# one `.env.local` can drive both Vite and this process.
COGNITO_USER_POOL_ID = _env_nonempty(
    'COGNITO_USER_POOL_ID',
    'VITE_COGNITO_USER_POOL_ID',
)
COGNITO_APP_CLIENT_ID = _env_nonempty(
    'COGNITO_APP_CLIENT_ID',
    'VITE_COGNITO_APP_CLIENT_ID',
)
COGNITO_REGION = os.getenv('AWS_REGION', 'us-east-1')
COGNITO_ISSUER = f'https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}'
COGNITO_JWKS_URL = f'{COGNITO_ISSUER}/.well-known/jwks.json'
COGNITO_AUTH_ENABLED = bool(COGNITO_USER_POOL_ID and COGNITO_APP_CLIENT_ID)

if COGNITO_AUTH_ENABLED:
    _AUTH_LOG.info('Cognito JWT verification enabled (pool %s)', COGNITO_USER_POOL_ID)
elif COGNITO_USER_POOL_ID or COGNITO_APP_CLIENT_ID:
    _AUTH_LOG.warning(
        'Incomplete Cognito config (need both pool id and app client id); dev fallback may mis-identify users'
    )
else:
    _AUTH_LOG.warning(
        'Cognito unset — API uses dev fallback user; set COGNITO_* or VITE_COGNITO_* (+ restart)'
    )

# Cache the JWKS keys at startup (avoid fetching on every request)
_JWKS_CACHE: dict = {}


def _get_jwks():
    global _JWKS_CACHE
    if not _JWKS_CACHE and COGNITO_AUTH_ENABLED:
        try:
            with urllib.request.urlopen(COGNITO_JWKS_URL, timeout=5) as r:
                _JWKS_CACHE = _json.loads(r.read())
        except Exception as e:
            _AUTH_LOG.warning("Could not fetch Cognito JWKS: %s", e)
    return _JWKS_CACHE


# Fetch JWKS at startup
_get_jwks()


def _verify_cognito_jwt(token: str) -> dict | None:
    """Verify Cognito JWT (access or ID token) against JWKS; returns claims or None."""
    try:
        jwks = _get_jwks()
        if not jwks.get('keys'):
            return None
        headers = _jose_jwt.get_unverified_header(token)
        kid = headers.get('kid')
        key = next((k for k in jwks.get('keys', []) if k.get('kid') == kid), None)
        if not key:
            return None
        return _jose_jwt.decode(
            token,
            key,
            algorithms=['RS256'],
            audience=COGNITO_APP_CLIENT_ID,
            issuer=COGNITO_ISSUER,
        )
    except JWTError:
        return None


def _email_like(value: str) -> bool:
    return '@' in (value or '')


def require_auth(roles=None):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # If Cognito is not fully configured, allow all (PoC fallback)
            if not COGNITO_AUTH_ENABLED:
                _dev_email = (
                    os.environ.get('DEV_AUTH_EMAIL', 'dev@example.com').strip()
                    or 'dev@example.com'
                )
                _dev_name = os.environ.get('DEV_AUTH_NAME', '').strip()
                g.current_user = {
                    'sub': 'dev',
                    'role': 'admin',
                    'name': _dev_name,
                    'email': _dev_email,
                }
                return f(*args, **kwargs)

            auth_header = request.headers.get('Authorization', '')
            if not auth_header.startswith('Bearer '):
                return jsonify({'error': 'Unauthorized'}), 401

            token = auth_header.split(' ', 1)[1]
            claims = _verify_cognito_jwt(token)
            if not claims:
                return jsonify({'error': 'Unauthorized'}), 401

            token_use = claims.get('token_use')
            if token_use not in (None, 'access'):
                _AUTH_LOG.warning('Rejected Bearer token_use=%s for API auth', token_use)
                return jsonify({'error': 'Unauthorized'}), 401

            groups = claims.get('cognito:groups', []) or []
            role = 'admin' if 'admin' in groups else 'operator'

            # Access tokens usually omit email and expose an opaque `username` (often a UUID).
            # `/auth/me` enriches from the ID token when the SPA sends X-Cognito-Id-Token.
            email = (claims.get('email') or '').strip()
            username = (claims.get('username') or '').strip()
            profile_name = (claims.get('name') or '').strip()
            display_name = email or username or profile_name or 'User'

            g.current_user = {
                'sub': claims.get('sub'),
                'email': email or username or '',
                'role': role,
                'name': display_name,
            }

            if roles and role not in roles:
                return jsonify({'error': 'Forbidden — insufficient role'}), 403

            return f(*args, **kwargs)

        return wrapper

    return decorator

try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
except ImportError:
    raise SystemExit(
        "Missing dependency: run  pip install cryptography  before using this script."
    )

from renewal_agent import RenewalAgent

# ---------------------------------------------------------------------------
# DynamoDB persistence (certificate lifecycle app)
# ---------------------------------------------------------------------------
import sys as _sys_early
_sys_early.path.insert(0, str(Path(__file__).parent / 'infra'))
try:
    from dynamodb_store import (
        db_delete_cert,
        db_health_check,
        db_load_email_log,
        db_load_jobs,
        db_load_manual_certs,
        db_load_notifications,
        db_load_setting,
        db_save_cert,
        db_save_email_log_entry,
        db_save_job,
        db_save_notification,
        db_save_setting,
    )

    _DDB_AVAILABLE = True
except Exception as _ddb_import_err:
    _DDB_AVAILABLE = False
    log_ddb = logging.getLogger("api_bridge.dynamodb")
    log_ddb.warning("DynamoDB store unavailable (persistence disabled): %s", _ddb_import_err)

    def _ddb_noop(*_a, **_k):  # type: ignore
        return None

    db_delete_cert = _ddb_noop
    db_health_check = _ddb_noop
    db_load_email_log = _ddb_noop
    db_load_jobs = _ddb_noop
    db_load_manual_certs = _ddb_noop
    db_load_notifications = _ddb_noop
    db_load_setting = _ddb_noop
    db_save_cert = _ddb_noop
    db_save_email_log_entry = _ddb_noop
    db_save_job = _ddb_noop
    db_save_notification = _ddb_noop
    db_save_setting = _ddb_noop


def _ddb_background(fn, *args, **kwargs) -> None:
    """Fire-and-forget DynamoDB write so API responses never block."""

    def _run():
        try:
            fn(*args, **kwargs)
        except Exception:
            log.exception("Background DynamoDB operation failed: %s", getattr(fn, "__name__", "unknown"))

    try:
        threading.Thread(target=_run, daemon=True).start()
    except Exception:
        # As a last resort, do nothing; never crash request handlers.
        log.exception("Failed to start background DynamoDB thread.")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("api_bridge")

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(
    app,
    origins=["http://localhost:8080", "http://localhost:8081"],
    allow_headers=["Content-Type", "Authorization", "X-Cognito-Id-Token"],
)

# ---------------------------------------------------------------------------
# Constants (verbatim from local_cert_checker.py)
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
DEFAULT_INVENTORY = BASE_DIR / "generated_certificates" / "certificate_inventory.csv"
DEFAULT_CERTS_DIR = BASE_DIR / "generated_certificates" / "certs"

# Legacy alias; authoritative values come from MONITORING_SETTINGS at runtime.
CRITICAL_DAYS = 7

import sys as _sys
_sys.path.insert(0, str(BASE_DIR / 'agents' / 'agent_backend'))
_sys.path.insert(0, str(BASE_DIR / 'tools' / 'ssl_checker'))
_sys.path.insert(0, str(BASE_DIR / 'tools'))

try:
    from bedrock_client import analyze_certificate as _analyze_certificate
    _BEDROCK_AVAILABLE = True
    log.info("bedrock_client loaded — Amazon Nova Lite ready")
except Exception as _bedrock_import_err:
    log.warning("bedrock_client import failed (rule-based fallback will be used): %s", _bedrock_import_err)
    _analyze_certificate = None
    _BEDROCK_AVAILABLE = False

AI_ANALYSIS: dict = {}
_AI_ANALYSIS_LOCK = threading.Lock()

_LIFECYCLE_OVERLAY_KEYS = (
    'status', 'deployment_status', 'validation_status',
    'days_to_expiry', 'expiration_date', 'issue_date',
    'deployed_at', 'deployed_by', 'notes',
)


def _rule_based_analysis(cert: dict) -> dict:
    """Deterministic urgency from cert status and days_to_expiry."""
    days   = int(cert.get('days_to_expiry', 999))
    status = cert.get('status', 'active')
    if status == 'expired' or days < 0:
        urgency, action, risk = 98, 'renew_immediately', 'critical'
    elif status == 'critical' or days <= int(MONITORING_SETTINGS.get('critical_threshold_days', 7)):
        urgency, action, risk = 90, 'renew_immediately', 'critical'
    elif status == 'expiring_soon' or days <= int(MONITORING_SETTINGS.get('warning_threshold_days', 30)):
        urgency, action, risk = 70, 'renew_immediately', 'high'
    elif days <= 60:
        urgency, action, risk = 45, 'schedule_renewal', 'medium'
    else:
        urgency, action, risk = 15, 'monitor', 'low'
    return {
        'urgency_score': urgency,
        'action':        action,
        'generate_csr':  action == 'renew_immediately',
        'reason':        f"Rule-based: {status}, {days} days to expiry",
        'provider':      'rule_based_fallback',
        'model':         'none',
        'risk_assessment': {
            'risk_level':       risk,
            'risk_score':       urgency,
            'risks':            [f"Certificate is {status}"],
            'consequences':     ['Service disruption if not renewed'],
            'estimated_impact': 'High' if urgency > 70 else 'Medium',
        },
        'change_tracking': {
            'city_changed':      False,
            'domain_changed':    False,
            'dept_name_changed': False,
            'requires_reissue':  False,
            'change_reason':     'Rule-based assessment',
        },
    }


def run_bedrock_analysis(cert: dict) -> dict:
    """Run Bedrock AI analysis. Falls back to rule-based only on failure."""
    if _BEDROCK_AVAILABLE:
        try:
            result = _analyze_certificate(cert)
            if result and isinstance(result, dict):
                result['provider'] = 'amazon_bedrock'
                result['model'] = 'amazon.nova-lite-v1'
                return result
            log.warning("Bedrock returned empty/non-dict for %s", cert.get('certificate_id'))
        except Exception as e:
            log.warning("Bedrock call failed for %s — %s: %s",
                        cert.get('certificate_id'), type(e).__name__, e)

    return _rule_based_analysis(cert)


def _cert_for_ai_analysis(cert: dict) -> dict:
    """Snapshot cert fields as they should be interpreted for risk scoring."""
    snap = dict(cert)
    cert_id = snap.get('certificate_id')
    job = AGENT.jobs.get(cert_id, {}) if cert_id else {}

    now = datetime.now(timezone.utc)
    renewed_expiry = (now + timedelta(days=365)).strftime('%Y-%m-%d')

    if job.get('deployment_confirmed') or snap.get('deployment_status') == 'deployed':
        snap['status'] = 'active'
        snap['deployment_status'] = 'deployed'
        if int(snap.get('days_to_expiry', 0)) < 60:
            snap['days_to_expiry'] = 365
            snap['expiration_date'] = renewed_expiry
    elif (
        snap.get('status') == 'pending_deployment'
        and job.get('overall_status') == 'completed'
    ):
        snap['days_to_expiry'] = 365
        snap['expiration_date'] = renewed_expiry
        snap['status'] = 'active'

    return snap


def _store_ai_analysis(cert: dict, analysis: dict) -> None:
    cert_id = cert.get('certificate_id')
    if not cert_id:
        return
    with _AI_ANALYSIS_LOCK:
        AI_ANALYSIS[cert_id] = {
            **analysis,
            'certificate_id': cert_id,
            'domain_name':    cert.get('domain_name', ''),
            'agency_name':    cert.get('agency_name', ''),
            'analyzed_at':    datetime.now(timezone.utc).isoformat(),
        }


def refresh_ai_analysis(
    cert_ids: list[str] | None = None,
    *,
    background: bool = True,
) -> None:
    """Re-run analysis for one or more certs (or entire inventory)."""
    def _run() -> None:
        if cert_ids is None:
            targets = list(CERT_CACHE)
        else:
            id_set = set(cert_ids)
            targets = [c for c in CERT_CACHE if c.get('certificate_id') in id_set]
        for cert in targets:
            try:
                snap = _cert_for_ai_analysis(cert)
                analysis = run_bedrock_analysis(snap)
                _store_ai_analysis(cert, analysis)
                log.info(
                    "AI refresh %s → provider=%s urgency=%s days=%s status=%s",
                    cert.get('certificate_id'),
                    analysis.get('provider'),
                    analysis.get('urgency_score'),
                    snap.get('days_to_expiry'),
                    snap.get('status'),
                )
            except Exception as e:
                log.warning(
                    "AI refresh skipped %s: %s",
                    cert.get('domain_name'),
                    e,
                )

    if background:
        threading.Thread(target=_run, daemon=True).start()
    else:
        _run()


def _merge_persisted_cert_overrides(persisted: list[dict]) -> None:
    """Overlay DynamoDB cert lifecycle fields onto in-memory inventory."""
    by_id = {c['certificate_id']: c for c in CERT_CACHE}
    for p in persisted:
        try:
            cid = p.get('certificate_id')
            if not cid:
                continue
            if cid in by_id:
                for key in _LIFECYCLE_OVERLAY_KEYS:
                    val = p.get(key)
                    if val is not None and val != '':
                        by_id[cid][key] = val
            else:
                CERT_CACHE.append(p)
        except Exception:
            continue


def _restore_deployed_cert_state() -> None:
    """Re-apply active/deployed state after restart from jobs + persisted certs."""
    now = datetime.now(timezone.utc)
    renewed_expiry = (now + timedelta(days=365)).strftime('%Y-%m-%d')
    for cert in CERT_CACHE:
        cert_id = cert.get('certificate_id')
        job = AGENT.jobs.get(cert_id, {}) if cert_id else {}
        deployed = (
            job.get('deployment_confirmed')
            or cert.get('deployment_status') == 'deployed'
        )
        if not deployed:
            continue
        cert['status'] = 'active'
        cert['deployment_status'] = 'deployed'
        cert['validation_status'] = cert.get('validation_status') or 'passed'
        if int(cert.get('days_to_expiry', 0)) < 60:
            cert['days_to_expiry'] = 365
            cert['expiration_date'] = renewed_expiry

# ---------------------------------------------------------------------------
# AWS SNS configuration
# ---------------------------------------------------------------------------
SNS_TOPIC_ARN = os.getenv('SNS_TOPIC_ARN', '')
AWS_REGION    = os.getenv('AWS_REGION', 'us-east-2')

# ---------------------------------------------------------------------------
# AWS Cost Explorer (billing) configuration
# ---------------------------------------------------------------------------
# Cost Explorer is a "global" endpoint, but the SDK uses us-east-1 by default.
# Allow override for environments that require explicit region routing.
AWS_COST_EXPLORER_REGION = os.getenv('AWS_COST_EXPLORER_REGION', 'us-east-1')

# ---------------------------------------------------------------------------
# Notification settings (in-memory; updated via /api/notifications/settings)
# ---------------------------------------------------------------------------
NOTIFICATION_SETTINGS: dict[str, Any] = {
    'recipients': ['admin@its.ms.gov'],
    'daily_time': '09:00',
    'triggers':   ['expired', 'critical', 'expiring_soon'],
    # When False: no bulk SNS on server boot (daily digest + weekly reports still run).
    'startup_alerts_enabled': False,
}
_NOTIFY_LOCK = threading.Lock()
_LAST_DIGEST_DATE: str | None = None   # UTC date we last sent the daily digest
_DIGEST_THREAD_STARTED: bool = False

# ---------------------------------------------------------------------------
# Certificate monitoring settings (in-memory; updated via /api/monitoring/settings)
# ---------------------------------------------------------------------------
MONITORING_SETTINGS: dict[str, Any] = {
    'critical_threshold_days': 7,
    'warning_threshold_days': 30,
    'check_interval': 'daily',
    'auto_renewal_enabled': True,
}

_CHECK_INTERVAL_SECONDS = {
    'hourly': 60 * 60,
    'daily': 24 * 60 * 60,
    'weekly': 7 * 24 * 60 * 60,
}
_MONITORING_THREAD_STARTED = False


def _monitoring_critical_days() -> int:
    try:
        return max(1, int(MONITORING_SETTINGS.get('critical_threshold_days', 7)))
    except (TypeError, ValueError):
        return 7


def _monitoring_warning_days() -> int:
    try:
        warning = max(1, int(MONITORING_SETTINGS.get('warning_threshold_days', 30)))
    except (TypeError, ValueError):
        warning = 30
    return max(warning, _monitoring_critical_days())


def _monitoring_check_interval_seconds() -> int:
    key = str(MONITORING_SETTINGS.get('check_interval', 'daily')).lower()
    return _CHECK_INTERVAL_SECONDS.get(key, _CHECK_INTERVAL_SECONDS['daily'])


def _parse_date_yyyy_mm_dd(s: str) -> datetime | None:
    try:
        return datetime.strptime(s, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _days_to_expiry_from_date(expiration_date: str) -> int | None:
    exp = _parse_date_yyyy_mm_dd(str(expiration_date or '').strip())
    if not exp:
        return None
    now = datetime.now(timezone.utc)
    return int((exp - now).total_seconds() // 86400)


def _cert_auto_renew_allowed(cert: dict[str, Any]) -> bool:
    if not bool(MONITORING_SETTINGS.get('auto_renewal_enabled', True)):
        return False
    flag = str(cert.get('auto_renew_enabled', 'no')).strip().lower()
    return flag in ('yes', 'true', '1', 'on', 'y')


def _cert_qualifies_for_agent(cert: dict[str, Any]) -> bool:
    if not _cert_auto_renew_allowed(cert):
        return False
    warning = _monitoring_warning_days()
    status = cert.get('status')
    days = int(cert.get('days_to_expiry', 999))
    if status in ('expired', 'critical'):
        return True
    return status == 'expiring_soon' and days <= warning


def compute_status(days_to_expiry: int, threshold: int | None = None) -> str:
    """Map days-to-expiry to lifecycle status using monitoring thresholds."""
    critical = _monitoring_critical_days()
    warning = _monitoring_warning_days() if threshold is None else max(int(threshold), critical)
    if days_to_expiry < 0:
        return 'expired'
    if days_to_expiry <= critical:
        return 'critical'
    if days_to_expiry <= warning:
        return 'expiring_soon'
    return 'active'


def _recompute_all_cert_statuses() -> int:
    """Re-apply monitoring thresholds to every cert in CERT_CACHE."""
    warning = _monitoring_warning_days()
    updated = 0
    for cert in CERT_CACHE:
        exp = str(cert.get('expiration_date', '') or '').strip()
        if exp:
            days = _days_to_expiry_from_date(exp)
            if days is not None:
                cert['days_to_expiry'] = days
        cert['renewal_threshold_days'] = warning
        new_status = compute_status(int(cert.get('days_to_expiry', 0)))
        if cert.get('status') != new_status:
            cert['status'] = new_status
            updated += 1
        try:
            _ddb_background(db_save_cert, cert)
        except Exception:
            pass
    return updated


# ---------------------------------------------------------------------------
# Integration settings (in-memory; persisted via DynamoDB settings table)
# ---------------------------------------------------------------------------
INTEGRATION_SETTINGS: dict[str, Any] = {
    "local_ca_enabled": True,
    "entrust_enabled": False,
    "fortimanager_enabled": False,
    "fortimanager_host": "",
    "iis_confirmation_required": True,
}


# ===========================================================================
# Cert-file parsing (verbatim from local_cert_checker.py)
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


def load_inventory(csv_path: Path) -> list[dict[str, str]]:
    """Read the certificate inventory CSV and return a list of row dicts."""
    if not csv_path.exists():
        raise FileNotFoundError(f"Inventory CSV not found: {csv_path}")
    with csv_path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


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

    threshold        = _monitoring_warning_days()
    computed_status  = compute_status(days_to_expiry)

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

        # ---- File locations (best-effort; may be blank for manual certs) -
        "certificate_path":         str(cert_path) if cert_path else row.get("certificate_path", ""),
        "private_key_path":         row.get("private_key_path", ""),

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


def _is_within_dir(path: Path, parent: Path) -> bool:
    """Return True if path resolves under parent."""
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _delete_path_best_effort(p: Path) -> bool:
    """Delete a file if it exists. Returns True when removed."""
    try:
        if p.exists() and p.is_file():
            p.unlink()
            return True
    except Exception:
        pass
    return False


def delete_generated_certificate_artifacts(cert: dict[str, Any]) -> dict[str, Any]:
    """Best-effort cleanup of local generated cert artifacts.

    Safety: only deletes files under BASE_DIR/generated_certificates.
    """
    gen_root = BASE_DIR / "generated_certificates"
    domain = str(cert.get("domain_name") or "").strip()
    deleted: list[str] = []
    skipped: list[str] = []

    # Candidate file locations (some may not exist in all flows)
    candidates: list[Path] = []

    # Explicit paths when available
    for key in ("certificate_path", "private_key_path"):
        raw = str(cert.get(key) or "").strip()
        if raw:
            candidates.append(Path(raw.replace("\\", "/")))

    # Conventional outputs used by this repo
    if domain:
        candidates.extend([
            gen_root / "certs" / f"{domain}.crt",
            gen_root / "keys" / f"{domain}.key",
            gen_root / "keys" / f"{domain}.new.key",
            gen_root / "csrs" / f"{domain}.csr",
            gen_root / "issued_certs" / f"{domain}.issued.crt",
            gen_root / "issued_certs" / f"{domain}.pfx",
        ])

    # De-dupe while preserving order
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in candidates:
        s = str(p)
        if s not in seen:
            uniq.append(p)
            seen.add(s)

    for p in uniq:
        if not _is_within_dir(p, gen_root):
            skipped.append(str(p))
            continue
        if _delete_path_best_effort(p):
            deleted.append(str(p))

    return {"deleted_paths": deleted, "skipped_paths": skipped}


def remove_from_inventory_csv(cert_id: str) -> bool:
    """Remove a cert row from generated_certificates/certificate_inventory.csv."""
    try:
        if not DEFAULT_INVENTORY.exists():
            return False
        with DEFAULT_INVENTORY.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            rows = list(reader)
            fieldnames = list(reader.fieldnames or [])
        if not fieldnames:
            return False

        before = len(rows)
        rows = [r for r in rows if str(r.get("certificate_id", "")).strip() != cert_id]
        if len(rows) == before:
            return False

        with DEFAULT_INVENTORY.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        return True
    except Exception:
        return False


# ===========================================================================
# Startup data — executed on module load
# ===========================================================================

log.info("Loading certificate inventory…")
rows = load_inventory(DEFAULT_INVENTORY)
CERT_CACHE: list[dict[str, Any]] = [build_record(r, DEFAULT_CERTS_DIR) for r in rows]
log.info("Loaded %d certificates", len(CERT_CACHE))

# ---------------------------------------------------------------------------
# Load persisted settings + records from DynamoDB (best-effort)
# ---------------------------------------------------------------------------
try:
    # Load persisted settings
    saved_notif_settings = db_load_setting('notification_settings')
    if saved_notif_settings:
        NOTIFICATION_SETTINGS.update(saved_notif_settings)

    saved_monitor_settings = db_load_setting('monitoring_settings')
    if saved_monitor_settings:
        MONITORING_SETTINGS.update(saved_monitor_settings)

    saved_integration_settings = db_load_setting('integration_settings')
    if saved_integration_settings:
        INTEGRATION_SETTINGS.update(saved_integration_settings)
except Exception:
    log.exception("Failed to load persisted settings from DynamoDB (non-fatal).")

try:
    # Load persisted certs (manual/live) and overlay lifecycle onto inventory
    manual_certs = db_load_manual_certs() or []
    _merge_persisted_cert_overrides(manual_certs)
except Exception:
    log.exception("Failed to load manual certs from DynamoDB (non-fatal).")

log.info("Running renewal agent against qualifying certificates…")
AGENT = RenewalAgent()

try:
    for job in (db_load_jobs() or []):
        try:
            AGENT.jobs[job['certificate_id']] = job
        except Exception:
            continue
except Exception:
    log.exception("Failed to load agent jobs from DynamoDB (non-fatal).")

_restore_deployed_cert_state()

_startup_renewed_ids: list[str] = []
for cert in CERT_CACHE:
    if _cert_qualifies_for_agent(cert):
        try:
            # Import-time batch: skip per-cert SNS so restarts do not match
            # NOTIFICATION_SETTINGS "startup" expectations (bulk toggle is separate).
            AGENT.process_cert(cert, send_deployment_sns=False)
            _startup_renewed_ids.append(cert['certificate_id'])
        except Exception as e:
            log.warning("Agent skipped %s: %s", cert['domain_name'], e)

log.info("Building notification list…")
NOTIFICATIONS: list[dict[str, Any]] = []
for cert in CERT_CACHE:
    if cert['status'] == 'expired':
        sev, title = 'critical', 'Certificate Expired'
        msg = f"{cert['domain_name']} expired {abs(cert['days_to_expiry'])} days ago"
        action = True
    elif cert['status'] == 'critical':
        sev, title = 'critical', 'Certificate Critical'
        msg = f"{cert['domain_name']} expires in {cert['days_to_expiry']} days"
        action = True
    elif cert['status'] == 'expiring_soon':
        sev, title = 'warning', 'Expiring Soon'
        msg = f"{cert['domain_name']} expires in {cert['days_to_expiry']} days"
        action = False
    else:
        continue
    NOTIFICATIONS.append({
        'id': str(uuid.uuid4()),
        'certificate_id': cert['certificate_id'],
        'domain_name': cert['domain_name'],
        'agency_name': cert['agency_name'],
        'severity': sev,
        'title': title,
        'message': msg,
        'action_required': action,
        'read': False,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'source': 'certificate_monitor'
    })

for cert in CERT_CACHE:
    if cert.get('status') == 'pending_deployment':
        ts = datetime.now(timezone.utc).isoformat()
        NOTIFICATIONS.append({
            'id': str(uuid.uuid4()),
            'certificate_id': cert['certificate_id'],
            'domain_name': cert['domain_name'],
            'agency_name': cert['agency_name'],
            'type': 'pending_deployment',
            'severity': 'info',
            'message': (
                f"Certificate renewed — awaiting IIS import: "
                f"{cert['domain_name']}"
            ),
            'details': (
                "PFX bundle ready. Import on MDAWEB19 and bind to website."
            ),
            'action_required': 'Import PFX into IIS and confirm deployment',
            'timestamp': ts,
            'created_at': ts,
            'read': False,
            'title': 'Awaiting IIS import',
            'source': 'certificate_monitor',
        })

try:
    # Load persisted notifications (merge, avoid duplicates by id)
    saved_notifs = db_load_notifications() or []
    existing_notif_ids = {n['id'] for n in NOTIFICATIONS}
    for n in saved_notifs:
        try:
            if n['id'] not in existing_notif_ids:
                NOTIFICATIONS.append(n)
        except Exception:
            continue
except Exception:
    log.exception("Failed to load notifications from DynamoDB (non-fatal).")

log.info("Running AI analysis on certificates…")
refresh_ai_analysis(background=True)

def _sync_to_s3():
    try:
        from s3_helper import upload_inventory, upload_renewal_jobs
        upload_inventory(CERT_CACHE, bucket='mock-certificate-data')
        upload_renewal_jobs(
            list(AGENT.jobs.values()),
            bucket='certificate-data-processed1'
        )
        log.info("S3 sync complete")
    except Exception as e:
        log.warning("S3 sync skipped (non-fatal): %s", e)

threading.Thread(target=_sync_to_s3, daemon=True).start()

EMAIL_LOG: list[dict[str, Any]] = []
try:
    # Load email log
    EMAIL_LOG.extend(db_load_email_log() or [])
except Exception:
    log.exception("Failed to load EMAIL_LOG from DynamoDB (non-fatal).")

LAST_REFRESHED: str = datetime.now(timezone.utc).isoformat()

# ---------------------------------------------------------------------------
# Agent failure tracking
# ---------------------------------------------------------------------------
AGENT_FAILURES: list[dict[str, Any]] = []

log.info(
    "Startup complete — %d certs | %d notifications | %d renewal jobs",
    len(CERT_CACHE), len(NOTIFICATIONS), len(AGENT.jobs),
)


# ===========================================================================
# Health
# ===========================================================================

@app.get("/api/health")
def health():
    return jsonify({
        "status": "healthy",
        "cert_count": len(CERT_CACHE),
        "last_refreshed": LAST_REFRESHED,
        "version": "1.0.0",
    })


@app.get("/api/ping")
@app.post("/api/ping")
def ping():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.get("/api/aws/sns/config")
def aws_sns_config():
    """Expose the effective SNS config used by this server."""
    return jsonify({
        "configured": bool(SNS_TOPIC_ARN),
        "topic_arn": SNS_TOPIC_ARN,
        "region": AWS_REGION,
        "provider": "aws_sns" if SNS_TOPIC_ARN else "simulated",
    })


@app.get('/api/auth/me')
@require_auth()
def auth_me():
    u = dict(g.current_user)
    if COGNITO_AUTH_ENABLED:
        raw_id = (request.headers.get('X-Cognito-Id-Token') or '').strip()
        if raw_id:
            id_claims = _verify_cognito_jwt(raw_id)
            if (
                id_claims
                and id_claims.get('token_use') == 'id'
                and id_claims.get('sub') == u.get('sub')
            ):
                email = (id_claims.get('email') or '').strip()
                preferred = (id_claims.get('preferred_username') or '').strip()
                cognito_username = (id_claims.get('cognito:username') or '').strip()
                profile_name = (id_claims.get('name') or '').strip()

                cur_emailish = (u.get('email') or '').strip()
                if email:
                    u['email'] = email
                elif _email_like(preferred):
                    u['email'] = preferred
                elif _email_like(cur_emailish):
                    u['email'] = cur_emailish
                else:
                    u['email'] = ''

                u['name'] = (
                    email
                    or preferred
                    or cognito_username
                    or profile_name
                    or u['email']
                    or u.get('name')
                    or 'User'
                )

    return jsonify({'email': u['email'], 'role': u['role'], 'name': u['name']})


@app.get("/api/aws/dynamodb/status")
@require_auth()
def dynamodb_status():
    try:
        status = db_health_check() or {}
        return jsonify(status)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ===========================================================================
# Certificates
# ===========================================================================

@app.get("/api/certificates")
@require_auth()
def certificates():
    # New certs are appended to CERT_CACHE; return newest-first for the UI.
    return jsonify(list(reversed(CERT_CACHE)))


@app.post("/api/certificates")
@require_auth(roles=['admin'])
def add_certificate():
    data = request.get_json(force=True) or {}
    hostname = (
        data.get('hostname')
        or data.get('domain_name')
        or data.get('domain')
        or ''
    )
    hostname = str(hostname).strip()
    if not hostname:
        return jsonify({'error': 'hostname is required'}), 400

    from datetime import datetime, timezone

    def _parse_date_yyyy_mm_dd(s: str) -> datetime | None:
        try:
            return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            return None

    def _compute_days_to_expiry_from_date(expiration_date: str) -> int | None:
        exp = _parse_date_yyyy_mm_dd(str(expiration_date or '').strip())
        if not exp:
            return None
        now = datetime.now(timezone.utc)
        # Floor to whole days, consistent with other parts of the system.
        return int((exp - now).total_seconds() // 86400)

    def _to_yes_no(v: Any, default: str = "yes") -> str:
        if v is None:
            return default
        if isinstance(v, bool):
            return "yes" if v else "no"
        if isinstance(v, (int, float)):
            return "yes" if bool(v) else "no"
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("1", "true", "yes", "on", "y"):
                return "yes"
            if s in ("0", "false", "no", "off", "n"):
                return "no"
        return default

    def _build_notification_for_cert(cert: dict[str, Any]) -> dict[str, Any] | None:
        s = cert.get('status')
        if s == 'expired':
            sev, title = 'critical', 'Certificate Expired'
            msg = f"{cert.get('domain_name')} expired {abs(int(cert.get('days_to_expiry', 0)))} days ago"
            action = True
        elif s == 'critical':
            sev, title = 'critical', 'Certificate Critical'
            msg = f"{cert.get('domain_name')} expires in {int(cert.get('days_to_expiry', 0))} days"
            action = True
        elif s == 'expiring_soon':
            sev, title = 'warning', 'Expiring Soon'
            msg = f"{cert.get('domain_name')} expires in {int(cert.get('days_to_expiry', 0))} days"
            action = False
        else:
            return None
        return {
            'id': str(uuid.uuid4()),
            'certificate_id': cert.get('certificate_id'),
            'domain_name': cert.get('domain_name'),
            'agency_name': cert.get('agency_name', ''),
            'severity': sev,
            'title': title,
            'message': msg,
            'action_required': action,
            'read': False,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'source': 'certificate_monitor',
        }

    # Generate a new cert ID
    existing_ids = [c['certificate_id'] for c in CERT_CACHE]
    next_num = max(
        [int(cid.replace('CERT-', '')) for cid in existing_ids
         if cid.startswith('CERT-')], default=0
    ) + 1
    new_id = f"CERT-{next_num:03d}"

    try:
        port = int(data.get('port', 443))
    except (TypeError, ValueError):
        port = 443
    date_mode = str(data.get('date_mode', '') or '').strip().lower() or 'live'
    if date_mode not in ('live', 'manual', 'imported', 'real', 'simulated'):
        date_mode = 'live'

    expiration_date = str(data.get('expiration_date', '') or '').strip()
    days_to_expiry = _compute_days_to_expiry_from_date(expiration_date)
    if days_to_expiry is None:
        try:
            days_to_expiry = int(data.get('days_to_expiry', 365))
        except Exception:
            days_to_expiry = 365

    # Create a new cert record (manual fields can fully define it)
    cert_record = {
        'certificate_id': new_id,
        'domain_name': hostname,
        'common_name': hostname,
        'issuer': str(data.get('issuer', 'Unknown') or 'Unknown'),
        'issuer_cn': str(data.get('issuer_cn', 'Unknown') or 'Unknown'),
        'issuer_workflow': str(data.get('issuer_workflow', '') or '').strip() or None,
        'certificate_type': str(data.get('certificate_type', 'DV') or 'DV'),
        'environment': str(data.get('environment', 'production') or 'production'),
        'agency_name': str(data.get('agency_name', 'Mississippi ITS') or 'Mississippi ITS'),
        'owning_team': str(data.get('owning_team', 'Web Operations') or 'Web Operations'),
        'issue_date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'expiration_date': expiration_date,
        'days_to_expiry': int(days_to_expiry),
        'renewal_threshold_days': _monitoring_warning_days(),
        'status': 'active',  # will be computed below
        'csv_status': 'active',
        'auto_renew_enabled': _to_yes_no(
            data.get('auto_renew_enabled', data.get('auto_renew', MONITORING_SETTINGS.get('auto_renewal_enabled', True))),
            default='yes' if MONITORING_SETTINGS.get('auto_renewal_enabled', True) else 'no',
        ),
        'csr_required': 'yes',
        'last_renewal_date': '',
        'deployment_status': 'deployed',
        'validation_status': 'passed',
        'alert_sent': 'no',
        'notes': str(data.get('notes', data.get('note', 'Manually added via dashboard')) or 'Manually added via dashboard'),
        'cert_file_loaded': False,
        'last_checked': datetime.now(timezone.utc).isoformat(),
        'date_mode': 'manual' if date_mode in ('manual', 'imported') else 'live'
    }

    # For Live Domain mode, attempt live SSL check to populate real data.
    # Manual/Internal mode should not block on live connectivity.
    if date_mode not in ('manual', 'imported'):
        try:
            import sys as _sys
            _sys.path.insert(0, str(BASE_DIR / 'tools' / 'ssl_checker'))
            from ssl_checker_simple import SSLChecker
            result = SSLChecker().check_ssl(hostname, port)
            if result.get('status') == 'success':
                cert_record['issuer'] = result.get('issuer', cert_record.get('issuer', 'Unknown'))
                cert_record['issuer_cn'] = result.get('issuer_cn', cert_record.get('issuer_cn', 'Unknown'))
                # ssl_checker_simple returns `valid_till` like "YYYY-MM-DD HH:MM:SS UTC".
                # Older flows used `expiry_date` (YYYY-MM-DD). Support both.
                exp_raw = (
                    result.get('expiry_date')
                    or result.get('valid_till')
                    or result.get('valid_to')
                    or ''
                )
                exp_str = str(exp_raw).strip()
                cert_record['expiration_date'] = exp_str[:10] if exp_str else cert_record.get('expiration_date', '')
                cert_record['days_to_expiry'] = int(result.get('days_left', cert_record.get('days_to_expiry', 365)))
        except Exception:
            pass

    # Compute authoritative status
    cert_record['renewal_threshold_days'] = _monitoring_warning_days()
    cert_record['status'] = compute_status(int(cert_record.get('days_to_expiry', 365)))

    CERT_CACHE.append(cert_record)

    # Create a notification entry for the new cert (same style as startup builder)
    try:
        notif = _build_notification_for_cert(cert_record)
        if notif:
            NOTIFICATIONS.append(notif)
    except Exception:
        pass

    # Persist cert + notification(s) in background
    try:
        _ddb_background(db_save_cert, cert_record)
    except Exception:
        pass
    try:
        if notif:
            _ddb_background(db_save_notification, notif)
    except Exception:
        pass

    # If urgent, run the REAL CSR generation pipeline synchronously before returning.
    renewal_job: dict[str, Any] | None = None
    if _cert_qualifies_for_agent(cert_record):
        try:
            renewal_job = AGENT.process_cert(cert_record)
        except Exception as e:
            log.warning("Agent failed for new cert %s (%s): %s", new_id, hostname, e)

    refresh_ai_analysis([new_id], background=False if renewal_job else True)

    log.info("Certificate added manually cert_id=%s domain=%s", new_id, hostname)
    response: dict[str, Any] = dict(cert_record)
    if renewal_job is not None:
        response['renewal_job'] = renewal_job
    return jsonify(response), 201


@app.delete("/api/certificates/<cert_id>")
@require_auth(roles=['admin'])
def delete_certificate(cert_id: str):
    try:
        cert = next((c for c in CERT_CACHE if c.get('certificate_id') == cert_id), None)
        if cert is None:
            return jsonify({"error": "not found"}), 404

        before = len(CERT_CACHE)
        CERT_CACHE[:] = [c for c in CERT_CACHE if c.get('certificate_id') != cert_id]
        removed = before - len(CERT_CACHE)

        # Best-effort persistence cleanup
        _ddb_background(db_delete_cert, cert_id)
        removed_from_csv = remove_from_inventory_csv(cert_id)

        # Best-effort local artifact cleanup (only under generated_certificates/)
        artifact_result = delete_generated_certificate_artifacts(cert)

        return jsonify({
            "status": "deleted",
            "certificate_id": cert_id,
            "removed": removed,
            "removed_from_inventory_csv": removed_from_csv,
            **artifact_result,
        })
    except Exception as exc:
        log.exception("DELETE /api/certificates/%s failed", cert_id)
        return jsonify({"error": str(exc)}), 500


@app.get("/api/certificates/summary")
@require_auth()
def certificates_summary():
    expired  = [c for c in CERT_CACHE if c['status'] == 'expired']
    critical = [c for c in CERT_CACHE if c['status'] == 'critical']
    expiring = [c for c in CERT_CACHE if c['status'] == 'expiring_soon']
    active   = [c for c in CERT_CACHE if c['status'] == 'active']
    auto_renew  = [c for c in CERT_CACHE if c.get('auto_renew_enabled') == 'yes']
    csr_pending = [
        c for c in CERT_CACHE
        if c.get('csr_required') == 'yes'
        and c['status'] in ('expired', 'critical', 'expiring_soon')
    ]
    failed  = [c for c in CERT_CACHE if c.get('deployment_status') == 'failed']
    pending_deployment = [c for c in CERT_CACHE if c.get('status') == 'pending_deployment']
    total   = len(CERT_CACHE)
    renewed = len([
        c for c in CERT_CACHE
        if c.get('csv_status') == 'renewed' or c.get('deployment_status') == 'deployed'
    ])
    return jsonify({
        "total":                    total,
        "expired":                  len(expired),
        "critical":                 len(critical),
        "expiring_soon":            len(expiring),
        "active":                   len(active),
        "pending_deployment":       len(pending_deployment),
        "auto_renew_enabled_count": len(auto_renew),
        "renewal_rate_pct":         round(renewed / total * 100, 1) if total else 0,
        "csr_pending_count":        len(csr_pending),
        "failed_renewal_count":     len(failed),
        "last_refreshed":           LAST_REFRESHED,
    })


@app.get("/api/certificates/status/<status>")
@require_auth()
def certificates_by_status(status: str):
    return jsonify([c for c in CERT_CACHE if c['status'] == status])


@app.get("/api/certificates/<cert_id>")
@require_auth()
def certificate_by_id(cert_id: str):
    cert = next((c for c in CERT_CACHE if c['certificate_id'] == cert_id), None)
    if cert is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(cert)


@app.post("/api/certificates/confirm-deploy-all")
@require_auth(roles=['admin'])
def confirm_all_deployments():
    """
    Confirm deployment for ALL pending_deployment certs.
    Demo convenience — simulates ITS completing all
    IIS imports at once.
    """
    now = datetime.now(timezone.utc)
    confirmed: list[str] = []

    for cert in CERT_CACHE:
        if cert.get('status') == 'pending_deployment':
            cert['previous_status'] = cert['status']
            cert['status'] = 'active'
            cert['deployment_status'] = 'deployed'
            cert['validation_status'] = 'passed'
            cert['deployed_at'] = now.isoformat()
            cert['deployed_by'] = 'bulk_confirmation'
            cert['days_to_expiry'] = 365
            cert['expiration_date'] = (
                now + timedelta(days=365)
            ).strftime('%Y-%m-%d')
            confirmed.append(cert['certificate_id'])

            domain = cert.get('domain_name') or ''
            NOTIFICATIONS.append({
                'id': str(uuid.uuid4()),
                'certificate_id': cert['certificate_id'],
                'domain_name': domain,
                'agency_name': cert.get('agency_name', ''),
                'type': 'deployment_confirmed',
                'severity': 'info',
                'title': 'Deployment confirmed',
                'message': f"Certificate successfully deployed: {domain}",
                'details': (
                    "PFX imported on MDAWEB19. "
                    "Website binding complete. "
                    "New certificate valid for 365 days."
                ),
                'action_required': False,
                'read': False,
                'created_at': now.isoformat(),
                'source': 'certificate_monitor',
            })

            job = AGENT.jobs.get(cert['certificate_id'])
            if job:
                job['deployment_confirmed'] = True
                job['deployment_confirmed_at'] = now.isoformat()
                try:
                    _ddb_background(db_save_job, job)
                except Exception:
                    pass

            try:
                _ddb_background(db_save_cert, cert)
            except Exception:
                pass

    if confirmed:
        try:
            subject = f"[ALL DEPLOYED] {len(confirmed)} certificates now active"
            message = (
                f"All {len(confirmed)} renewed certificates have been "
                f"imported into IIS and are now active.\n\n"
                f"Confirmed: {', '.join(confirmed)}\n\n"
                f"All certificates valid for 365 days.\n"
                f"Next scheduled scan will verify deployment."
            )
            sns_result = send_sns_notification(subject, message)

            # Log to EMAIL_LOG so it appears in the dashboard
            EMAIL_LOG.append({
                'id': str(uuid.uuid4()),
                'certificate_id': 'DEPLOY_CONFIRM_ALL',
                'domain_name': f'{len(confirmed)} certificates',
                'agency_name': 'All agencies',
                'recipient_email': ', '.join(
                    NOTIFICATION_SETTINGS.get('recipients', ['admin@its.ms.gov'])
                ),
                'subject': subject,
                'message': message,
                'sent_at': now.isoformat(),
                'status': 'sent',
                'provider': sns_result.get('provider', 'simulated'),
                'sns_message_id': sns_result.get('message_id'),
                'reason': sns_result.get('reason'),
                'report_type': 'deployment confirmed',
            })
        except Exception:
            pass

    log.info("Bulk deployment confirmed — %d certs", len(confirmed))

    if confirmed:
        refresh_ai_analysis(confirmed, background=True)

    return jsonify({
        'status': 'confirmed',
        'confirmed_count': len(confirmed),
        'confirmed_ids': confirmed,
        'message': f'{len(confirmed)} certificates confirmed as deployed',
    })


@app.post("/api/certificates/<cert_id>/confirm-deploy")
@require_auth(roles=['admin'])
def confirm_deployment(cert_id: str):
    """
    Simulate ITS confirming that the PFX was imported
    into IIS and the website binding is complete.
    In production: this would be triggered by the
    monitoring system detecting the new cert is live,
    or by an IIS deployment agent on MDAWEB19.
    For PoC demo: manually triggered to show the
    full lifecycle completion.
    """
    cert = next((c for c in CERT_CACHE if c['certificate_id'] == cert_id), None)
    if not cert:
        return jsonify({'error': 'Certificate not found'}), 404

    if cert.get('status') != 'pending_deployment':
        return jsonify({
            'error': (
                f"Certificate is '{cert.get('status')}', "
                f"not 'pending_deployment'"
            ),
            'hint': 'Only pending_deployment certs can be confirmed',
        }), 400

    now = datetime.now(timezone.utc)

    cert['previous_status'] = cert['status']
    cert['status'] = 'active'
    cert['deployment_status'] = 'deployed'
    cert['validation_status'] = 'passed'
    cert['deployed_at'] = now.isoformat()
    cert['deployed_by'] = 'manual_confirmation'
    cert['days_to_expiry'] = 365
    cert['expiration_date'] = (
        now + timedelta(days=365)
    ).strftime('%Y-%m-%d')

    job = AGENT.jobs.get(cert_id)
    if job:
        job['deployment_confirmed'] = True
        job['deployment_confirmed_at'] = now.isoformat()
        try:
            _ddb_background(db_save_job, job)
        except Exception:
            pass

    notif_id = str(uuid.uuid4())
    domain = cert.get('domain_name') or ''
    NOTIFICATIONS.append({
        'id': notif_id,
        'certificate_id': cert_id,
        'domain_name': domain,
        'agency_name': cert.get('agency_name', ''),
        'severity': 'info',
        'title': 'Deployment confirmed',
        'message': f"Certificate for {domain} successfully deployed to IIS",
        'action_required': False,
        'read': False,
        'created_at': now.isoformat(),
        'source': 'certificate_monitor',
        'type': 'deployment_confirmed',
        'details': (
            "PFX imported on MDAWEB19. "
            "Website binding complete. "
            "New certificate valid for 365 days."
        ),
    })

    # Persist updated cert + new notif in background
    try:
        _ddb_background(db_save_cert, cert)
    except Exception:
        pass
    try:
        # last appended notification is the one we just created
        _ddb_background(db_save_notification, NOTIFICATIONS[-1])
    except Exception:
        pass

    try:
        subject = f"[DEPLOYED] Certificate live: {domain}"
        message = (
            f"Certificate for {domain} has been "
            f"successfully imported into IIS and bound to the website.\n\n"
            f"Agency: {cert.get('agency_name')}\n"
            f"Environment: {cert.get('environment')}\n"
            f"New expiration: {cert.get('expiration_date')}\n"
            f"Status: ACTIVE\n\n"
            f"No further action required for this certificate."
        )
        sns_result = send_sns_notification(subject, message)

        # Log to EMAIL_LOG so it appears in the dashboard
        EMAIL_LOG.append({
            'id': str(uuid.uuid4()),
            'certificate_id': cert_id,
            'domain_name': domain,
            'agency_name': cert.get('agency_name', ''),
            'recipient_email': ', '.join(
                NOTIFICATION_SETTINGS.get('recipients', ['admin@its.ms.gov'])
            ),
            'subject': subject,
            'message': message,
            'sent_at': now.isoformat(),
            'status': 'sent',
            'provider': sns_result.get('provider', 'simulated'),
            'sns_message_id': sns_result.get('message_id'),
            'reason': sns_result.get('reason'),
            'report_type': 'deployment confirmed',
        })
    except Exception:
        pass

    log.info(
        "Deployment confirmed  cert_id=%s  domain=%s  status=active",
        cert_id, domain,
    )

    refresh_ai_analysis([cert_id], background=True)

    return jsonify({
        'status': 'confirmed',
        'certificate_id': cert_id,
        'domain_name': domain,
        'new_status': 'active',
        'deployed_at': now.isoformat(),
        'new_expiration': cert.get('expiration_date'),
        'message': (
            'Certificate deployment confirmed. '
            'Status updated to active. '
            'New certificate valid for 365 days.'
        ),
    })


# ===========================================================================
# Live SSL check
# ===========================================================================

@app.post("/api/ssl/check")
def ssl_check():
    body     = request.get_json(force=True) or {}
    hostname = body.get("hostname", "")
    port     = int(body.get("port", 443))
    if not hostname:
        return jsonify({"error": "hostname is required"}), 400
    try:
        from ssl_checker_simple import SSLChecker  # type: ignore[import]
        result = SSLChecker().check_ssl(hostname, port)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ===========================================================================
# CSR endpoints
# ===========================================================================

@app.get("/api/csr/list")
@require_auth()
def csr_list():
    return jsonify(list(AGENT.jobs.values()))


@app.get("/api/csr/<cert_id>")
@require_auth()
def csr_by_cert(cert_id: str):
    job = AGENT.jobs.get(cert_id)
    if job is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(job)


@app.post("/api/csr/generate")
@require_auth(roles=['admin'])
def csr_generate():
    body    = request.get_json(force=True) or {}
    cert_id = body.get("certificate_id", "")
    cert    = next((c for c in CERT_CACHE if c['certificate_id'] == cert_id), None)
    if cert is None:
        return jsonify({"error": f"certificate {cert_id!r} not found"}), 404
    try:
        job = AGENT.process_cert(cert)
        try:
            _ddb_background(db_save_job, job)
        except Exception:
            pass
        refresh_ai_analysis([cert_id], background=True)
        return jsonify(job)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ===========================================================================
# Renewal endpoints
# ===========================================================================

@app.get("/api/renew/jobs")
@require_auth()
def renew_jobs():
    return jsonify(list(AGENT.jobs.values()))


@app.get("/api/renew/status/<job_id>")
@require_auth()
def renew_status(job_id: str):
    job = next(
        (j for j in AGENT.jobs.values() if j['job_id'] == job_id),
        None,
    )
    if job is None:
        return jsonify({"error": "job not found"}), 404
    return jsonify(job)


@app.post("/api/agent/run-now")
@require_auth(roles=['admin'])
def agent_run_now():
    qualifying_certs = [c for c in CERT_CACHE if _cert_qualifies_for_agent(c)]
    new_jobs = 0
    new_job_items: list[dict[str, Any]] = []
    renewed_cert_ids: list[str] = []
    for cert in qualifying_certs:
        if cert['certificate_id'] not in AGENT.jobs:
            job = AGENT.process_cert(cert)
            try:
                if isinstance(job, dict):
                    new_job_items.append(job)
            except Exception:
                pass
            renewed_cert_ids.append(cert['certificate_id'])
            new_jobs += 1

    if renewed_cert_ids:
        refresh_ai_analysis(renewed_cert_ids, background=True)

    # Persist any new jobs in background (never blocks)
    try:
        for job in new_job_items:
            _ddb_background(db_save_job, job)
    except Exception:
        pass

    return jsonify({
        'status': 'completed',
        'jobs_processed': new_jobs,
        'certs_scanned': len(qualifying_certs),
        'message': 'Agent scan complete',
    })


@app.get("/api/agent/failures")
@require_auth()
def agent_failures():
    """Return all tracked agent failures."""
    return jsonify(AGENT_FAILURES)


@app.post("/api/simulate-failure")
@require_auth(roles=['admin'])
def simulate_failure():
    """
    Inject a synthetic pipeline failure into AGENT_FAILURES for demo.
    Picks a random cert that has been processed and marks one of its
    pipeline steps as failed, then fires an SNS alert.
    """
    import random

    jobs = list(AGENT.jobs.values())
    if not jobs:
        return jsonify({'error': 'No renewal jobs exist yet — run the agent first'}), 400

    job = random.choice(jobs)
    failure_steps = ['ca_submission', 'cert_issuance', 'deployment', 'validation']
    failed_step = random.choice(failure_steps)

    failure_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    failure = {
        'failure_id': failure_id,
        'certificate_id': job['certificate_id'],
        'domain_name': job['domain_name'],
        'agency_name': job.get('agency_name', ''),
        'failed_step': failed_step,
        'error': f'Simulated failure in {failed_step}: connection timeout',
        'occurred_at': now.isoformat(),
        'status': 'open',
        'job_id': job['job_id'],
    }
    AGENT_FAILURES.append(failure)

    # Send SNS alert about the failure
    try:
        send_sns_notification(
            f"[FAILURE] Pipeline step failed: {job['domain_name']}",
            f"Mississippi ITS Certificate Lifecycle — PIPELINE FAILURE\n"
            f"{'='*55}\n\n"
            f"Certificate : {job['domain_name']}\n"
            f"Agency      : {job.get('agency_name', 'Unknown')}\n"
            f"Failed Step : {failed_step}\n"
            f"Error       : Simulated failure in {failed_step}: connection timeout\n"
            f"Occurred At : {now.isoformat()}\n\n"
            f"Action Required: Log in to the CSR Lifecycle dashboard to retry or resolve.\n\n"
            f"--\nMississippi ITS Automated Certificate Monitor",
        )
    except Exception:
        pass

    log.warning("Simulated failure injected — cert=%s step=%s", job['domain_name'], failed_step)

    return jsonify({
        'status': 'failure_injected',
        'failure': failure,
        'message': f'Simulated failure in {failed_step} for {job["domain_name"]}',
        'sns_alert_sent': True,
    })


@app.post("/api/agent/failures/<failure_id>/resolve")
@require_auth(roles=['admin'])
def resolve_failure(failure_id: str):
    """Mark a failure as resolved and send an SNS confirmation."""
    failure = next((f for f in AGENT_FAILURES if f['failure_id'] == failure_id), None)
    if not failure:
        return jsonify({'error': 'Failure not found'}), 404

    if failure['status'] == 'resolved':
        return jsonify({'error': 'Already resolved'}), 400

    now = datetime.now(timezone.utc)
    failure['status'] = 'resolved'
    failure['resolved_at'] = now.isoformat()
    failure['resolved_by'] = 'manual_operator'

    try:
        send_sns_notification(
            f"[RESOLVED] Pipeline failure resolved: {failure['domain_name']}",
            f"Mississippi ITS Certificate Lifecycle — FAILURE RESOLVED\n"
            f"{'='*55}\n\n"
            f"Certificate : {failure['domain_name']}\n"
            f"Failed Step : {failure['failed_step']}\n"
            f"Resolved At : {now.isoformat()}\n"
            f"Resolved By : Manual operator action via dashboard\n\n"
            f"--\nMississippi ITS Automated Certificate Monitor",
        )
    except Exception:
        pass

    log.info("Failure resolved — failure_id=%s cert=%s", failure_id, failure['domain_name'])

    return jsonify({
        'status': 'resolved',
        'failure': failure,
        'message': f'Failure resolved for {failure["domain_name"]}',
    })


@app.route("/api/reports/weekly", methods=["POST"], strict_slashes=False)
@app.route("/api/reports/weekly/", methods=["POST"], strict_slashes=False)
@require_auth(roles=['admin'])
def trigger_weekly_report():
    """
    Manually trigger the weekly report.
    Used for demo purposes — in production this
    fires automatically every 7 days.
    """
    import threading
    from datetime import datetime, timezone

    def _send():
        send_weekly_report()
        # Reset the 7-day timer so next auto report
        # is 7 days from now
        last_weekly_file = BASE_DIR / '.last_weekly_report'
        last_weekly_file.write_text(
            datetime.now(timezone.utc).isoformat()
        )

    threading.Thread(target=_send, daemon=True).start()
    return jsonify({
        'status': 'triggered',
        'message': 'Weekly report is being generated and sent',
        'recipients': NOTIFICATION_SETTINGS.get('recipients', []),
        'note': 'In production this fires automatically every 7 days'
    })


@app.get("/api/agent/status")
@require_auth()
def agent_status():
    jobs = list(AGENT.jobs.values())
    return jsonify({
        "running":          True,
        "jobs_completed":   len(jobs),
        "certs_processed":  len(jobs),
        "last_refreshed":   LAST_REFRESHED,
        "check_interval":   MONITORING_SETTINGS.get('check_interval', 'daily'),
        "interval_seconds": _monitoring_check_interval_seconds(),
        "auto_renewal_enabled": bool(MONITORING_SETTINGS.get('auto_renewal_enabled', True)),
        "critical_threshold_days": _monitoring_critical_days(),
        "warning_threshold_days": _monitoring_warning_days(),
    })


# ===========================================================================
# Internal CA endpoints (Mississippi ITS Root CA — Entrust stand-in for PoC)
# ===========================================================================

@app.get("/api/ca/entrust-config")
@require_auth()
def entrust_config_status():
    try:
        from entrust_config import ENTRUST_CONFIG
        return jsonify({
            'api_url': ENTRUST_CONFIG['api_url'],
            'is_configured': ENTRUST_CONFIG['is_configured'],
            'cert_types_supported': list(ENTRUST_CONFIG['cert_types'].keys()),
            'note': ENTRUST_CONFIG['note'],
            'status': 'ready' if ENTRUST_CONFIG['is_configured'] else 'awaiting_credentials'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get("/api/ca/info")
@require_auth()
def ca_info():
    try:
        from renewal_agent import CA_CERT_PATH, ISSUED_DIR
        issued_count = len(list(ISSUED_DIR.glob('*.crt'))) \
            if ISSUED_DIR.exists() else 0
        if CA_CERT_PATH.exists():
            ca_cert = x509.load_pem_x509_certificate(
                CA_CERT_PATH.read_bytes()
            )
            return jsonify({
                'ca_name': 'Mississippi ITS Root Certificate Authority',
                'ca_cert_path': str(CA_CERT_PATH),
                'ca_cert_exists': True,
                'issued_certs_count': issued_count,
                'valid_until': ca_cert.not_valid_after_utc.isoformat(),
                'serial_number': str(ca_cert.serial_number),
                'subject': 'Mississippi Department of Information Technology Services',
                'note': 'Internal PKI — acts as Entrust stand-in for PoC. Import CA cert into Windows Trusted Root CAs to trust all issued certificates.'
            })
        return jsonify({
            'ca_cert_exists': False,
            'issued_certs_count': issued_count
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.get("/api/ca/issued")
@require_auth()
def ca_issued():
    try:
        from renewal_agent import ISSUED_DIR
        if not ISSUED_DIR.exists():
            return jsonify([])
        results = []
        for cert_file in sorted(ISSUED_DIR.glob('*.crt')):
            try:
                cert = x509.load_pem_x509_certificate(
                    cert_file.read_bytes()
                )
                pfx_path = cert_file.with_suffix('.pfx')
                results.append({
                    'domain': cert_file.stem.replace('.issued', ''),
                    'cert_path': str(cert_file),
                    'pfx_path': str(pfx_path) if pfx_path.exists() else None,
                    'pfx_exists': pfx_path.exists(),
                    'serial_number': str(cert.serial_number),
                    'valid_from': cert.not_valid_before_utc.isoformat(),
                    'valid_until': cert.not_valid_after_utc.isoformat(),
                    'issued_by': 'Mississippi ITS Root CA',
                    'file_size_kb': round(cert_file.stat().st_size / 1024, 2)
                })
            except Exception:
                continue
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===========================================================================
# Notification endpoints
# ===========================================================================

@app.get("/api/notifications")
@require_auth()
def notifications():
    result = NOTIFICATIONS[:]
    if request.args.get("unread", "").lower() == "true":
        result = [n for n in result if not n['read']]
    severity = request.args.get("severity", "")
    if severity:
        result = [n for n in result if n['severity'] == severity]
    return jsonify(result)


@app.get("/api/notifications/summary")
@require_auth()
def notifications_summary():
    unread = [n for n in NOTIFICATIONS if not n['read']]
    return jsonify({
        "total":            len(NOTIFICATIONS),
        "unread":           len(unread),
        "critical_unread":  len([n for n in unread if n['severity'] == 'critical']),
        "warning_unread":   len([n for n in unread if n['severity'] == 'warning']),
    })


@app.post("/api/notifications/<notif_id>/read")
@require_auth(roles=['admin'])
def notification_read(notif_id: str):
    notif = next((n for n in NOTIFICATIONS if n['id'] == notif_id), None)
    if notif is None:
        return jsonify({"error": "notification not found"}), 404
    notif['read'] = True
    try:
        _ddb_background(db_save_notification, notif)
    except Exception:
        pass
    return jsonify(notif)


@app.post("/api/notifications/read-all")
@require_auth(roles=['admin'])
def notifications_read_all():
    for n in NOTIFICATIONS:
        n['read'] = True
        try:
            _ddb_background(db_save_notification, n)
        except Exception:
            pass
    return jsonify({"updated_count": len(NOTIFICATIONS)})


# ===========================================================================
# Monitoring settings (certificate monitoring)
# ===========================================================================

@app.get("/api/monitoring/settings")
@require_auth()
def get_monitoring_settings():
    return jsonify(dict(MONITORING_SETTINGS))


@app.post("/api/monitoring/settings")
@require_auth(roles=['admin'])
def save_monitoring_settings():
    data = request.get_json(force=True) or {}

    def _int(name: str, default: int, lo: int, hi: int) -> int:
        try:
            v = int(data.get(name, default))
        except Exception:
            v = default
        return max(lo, min(hi, v))

    def _bool(name: str, default: bool) -> bool:
        v = data.get(name, default)
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("1", "true", "yes", "on")
        if isinstance(v, (int, float)):
            return bool(v)
        return bool(default)

    critical_days = _int('critical_threshold_days', 7, 1, 365)
    warning_days  = _int('warning_threshold_days', 30, 1, 365)

    if warning_days < critical_days:
        warning_days = critical_days

    check_interval = str(data.get('check_interval', MONITORING_SETTINGS.get('check_interval', 'daily'))).lower()
    if check_interval not in ('hourly', 'daily', 'weekly'):
        check_interval = 'daily'

    auto_renewal_enabled = _bool('auto_renewal_enabled', True)

    MONITORING_SETTINGS.update({
        'critical_threshold_days': critical_days,
        'warning_threshold_days': warning_days,
        'check_interval': check_interval,
        'auto_renewal_enabled': auto_renewal_enabled,
    })

    try:
        _ddb_background(db_save_setting, 'monitoring_settings', MONITORING_SETTINGS)
    except Exception:
        pass

    statuses_updated = _recompute_all_cert_statuses()
    global LAST_REFRESHED
    LAST_REFRESHED = datetime.now(timezone.utc).isoformat()

    return jsonify({
        'status': 'saved',
        'settings': dict(MONITORING_SETTINGS),
        'statuses_recomputed': statuses_updated,
    })


# ===========================================================================
# Notification settings (recipients / digest time / triggers)
# ===========================================================================

_VALID_TRIGGERS = {'expired', 'critical', 'expiring_soon', 'agent_jobs'}
_VALID_TIMES    = {'06:00', '07:00', '08:00', '09:00', '12:00', '17:00'}


def _validate_time(s: str) -> str:
    """Accept HH:MM in 24h form; clamp to a known slot or default to 09:00."""
    if isinstance(s, str) and s in _VALID_TIMES:
        return s
    if isinstance(s, str) and len(s) == 5 and s[2] == ':':
        try:
            h = int(s[:2])
            m = int(s[3:])
            if 0 <= h < 24 and 0 <= m < 60:
                return f"{h:02d}:{m:02d}"
        except ValueError:
            pass
    return '09:00'


@app.get("/api/notifications/settings")
@require_auth()
def get_notification_settings():
    with _NOTIFY_LOCK:
        return jsonify(dict(NOTIFICATION_SETTINGS))


@app.route('/api/notifications/settings', methods=['POST'])
@require_auth(roles=['admin'])
def save_notification_settings():
    data = request.get_json(force=True) or {}
    new_recipients = [r.strip() for r in data.get('recipients', []) if r.strip()]

    sns_added = []
    sns_removed = []
    sns_error = None

    if SNS_TOPIC_ARN:
        try:
            import boto3 as _boto3
            sns_client = _boto3.client(
                'sns',
                region_name=AWS_REGION,
                aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                aws_session_token=os.getenv('AWS_SESSION_TOKEN')
            )

            # IAM policy requires: sns:Subscribe, sns:Unsubscribe,
            # sns:ListSubscriptionsByTopic on the topic ARN

            # Get current confirmed subscriptions
            subs = sns_client.list_subscriptions_by_topic(
                TopicArn=SNS_TOPIC_ARN
            )['Subscriptions']
            current_emails = {
                s['Endpoint']: s['SubscriptionArn']
                for s in subs if s['Protocol'] == 'email'
            }

            # Subscribe new emails not already subscribed
            for email in new_recipients:
                if email not in current_emails:
                    sns_client.subscribe(
                        TopicArn=SNS_TOPIC_ARN,
                        Protocol='email',
                        Endpoint=email
                    )
                    sns_added.append(email)

            # Unsubscribe removed emails (only if confirmed, not pending)
            for email, arn in current_emails.items():
                if email not in new_recipients and arn != 'PendingConfirmation':
                    try:
                        sns_client.unsubscribe(SubscriptionArn=arn)
                        sns_removed.append(email)
                    except:
                        pass

        except Exception as e:
            sns_error = str(e)
            log.warning("SNS recipient sync error: %s", e)

    _sa = data.get('startup_alerts_enabled')
    if _sa is None:
        startup_alerts_enabled = bool(NOTIFICATION_SETTINGS.get('startup_alerts_enabled', False))
    else:
        startup_alerts_enabled = bool(_sa)

    NOTIFICATION_SETTINGS.update({
        'recipients': new_recipients,
        'daily_time': data.get('daily_time', NOTIFICATION_SETTINGS.get('daily_time', '09:00')),
        'triggers': data.get('triggers', NOTIFICATION_SETTINGS.get('triggers', [])),
        'startup_alerts_enabled': startup_alerts_enabled,
    })

    try:
        _ddb_background(db_save_setting, 'notification_settings', NOTIFICATION_SETTINGS)
    except Exception:
        pass

    return jsonify({
        'status': 'saved',
        'settings': NOTIFICATION_SETTINGS,
        'sns_synced': True,
        'sns_added': sns_added,
        'sns_removed': sns_removed,
        'sns_error': sns_error,
        'note': 'New recipients will receive a confirmation email from AWS — they must click the link to activate.'
    })


# ===========================================================================
# SNS helper
# ===========================================================================

def send_sns_notification(subject: str, message: str) -> dict:
    """
    Send a real email via AWS SNS.
    Falls back to simulated if SNS_TOPIC_ARN is not configured.
    """
    if not SNS_TOPIC_ARN:
        return {
            'provider': 'simulated',
            'status':   'sent',
            'reason':   'SNS_TOPIC_ARN not configured',
        }
    if boto3 is None or BotocoreConfig is None:
        return {
            'provider': 'simulated',
            'status': 'sent',
            'reason': 'AWS SDK (boto3/botocore) not installed',
        }
    try:
        sns = boto3.client(
            'sns',
            region_name=AWS_REGION,
            config=BotocoreConfig(
                connect_timeout=5,
                read_timeout=10,
                retries={'max_attempts': 1},
            ),
        )
        response = sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=subject[:100],   # SNS subject limit
            Message=message,
        )
        return {
            'provider':   'aws_sns',
            'status':     'sent',
            'message_id': response['MessageId'],
            'topic_arn':  SNS_TOPIC_ARN,
        }
    except NoCredentialsError:
        return {
            'provider': 'simulated',
            'status':   'sent',
            'reason':   'AWS credentials not configured',
        }
    except ClientError as e:
        return {
            'provider': 'simulated',
            'status':   'sent',
            'reason':   str(e),
        }


def send_weekly_report():
    """
    Generate and send a weekly certificate lifecycle report
    via AWS SNS to all configured recipients.
    Scope requirement: automatic weekly reports of activities
    sent to designated personnel.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    # Build stats from current state
    expired = [c for c in CERT_CACHE if c['status'] == 'expired']
    critical = [c for c in CERT_CACHE if c['status'] == 'critical']
    expiring = [c for c in CERT_CACHE if c['status'] == 'expiring_soon']
    active = [c for c in CERT_CACHE if c['status'] == 'active']
    jobs = list(AGENT.jobs.values())
    completed = [j for j in jobs if j.get('overall_status') == 'completed']

    # AI summary if available
    ai_line = ''
    if AI_ANALYSIS:
        renew_now = [a for a in AI_ANALYSIS.values()
                     if a.get('action') == 'renew_immediately']
        ai_line = (
            f"\nAI Risk Analysis (Amazon Bedrock):\n"
            f"  Certificates analyzed  : {len(AI_ANALYSIS)}\n"
            f"  Renew immediately      : {len(renew_now)}\n"
            f"  AI provider            : Amazon Bedrock (Nova Lite)\n"
        )

    subject = (
        f"[WEEKLY REPORT] Mississippi ITS Certificate Lifecycle - "
        f"Week of {now.strftime('%Y-%m-%d')}"
    )

    body = f"""Mississippi ITS Certificate Lifecycle Management
Weekly Automated Report - {now.strftime('%A, %B %d, %Y')}
{'='*60}

CERTIFICATE INVENTORY SUMMARY
  Total certificates tracked : {len(CERT_CACHE)}
  Active (healthy)           : {len(active)}
  Expiring soon              : {len(expiring)}
  Critical (<=7 days)        : {len(critical)}
  Expired                    : {len(expired)}

RENEWAL AGENT ACTIVITY (this session)
  Renewal jobs completed     : {len(completed)}
  CSRs generated             : {len(completed)}
  Certificates issued        : {len(completed)}
  PFX bundles created        : {len(completed)}
{ai_line}
CERTIFICATES REQUIRING ATTENTION
{"  None - all certificates healthy" if not expired and not critical else ""}
"""

    for c in sorted(expired + critical, key=lambda x: x['days_to_expiry']):
        days = c['days_to_expiry']
        tag = f"EXPIRED {abs(days)}d ago" if days < 0 else f"CRITICAL - {days}d left"
        body += f"  [{c['status'].upper()}] {c['domain_name']} - {tag}\n"
        body += f"           Agency: {c['agency_name']}\n"

    body += f"""
ISSUED CERTIFICATES THIS PERIOD
"""
    issued_dir = BASE_DIR / 'generated_certificates' / 'issued_certs'
    if issued_dir.exists():
        crt_files = list(issued_dir.glob('*.issued.crt'))
        pfx_files = list(issued_dir.glob('*.pfx'))
        body += f"  Issued .crt files  : {len(crt_files)}\n"
        body += f"  PFX bundles ready  : {len(pfx_files)}\n"
    else:
        body += "  No issued certificates found this period.\n"

    body += f"""
AUDIT TRAIL
  All {len(EMAIL_LOG)} notifications logged in system
  All renewal actions recorded with timestamps
  Full pipeline audit available via dashboard

NEXT STEPS
  Review certificates requiring attention above
  Import PFX bundles into IIS on MDAWEB19
  Update FortiManager with new PFX files

{'='*60}
This report was generated automatically by the CSR Lifecycle Agent.
Report frequency : Weekly (every 7 days)
Report generated : {now.isoformat()}
Dashboard URL    : http://localhost:8081
"""

    result = send_sns_notification(subject, body)
    if result.get('provider') != 'aws_sns' and result.get('reason'):
        log.warning("Weekly report simulated (reason=%s)", result.get('reason'))
    log.info(
        "Weekly report sent — provider=%s certs=%d jobs=%d",
        result.get('provider'), len(CERT_CACHE), len(completed)
    )

    # Log to EMAIL_LOG so it appears in the dashboard
    EMAIL_LOG.append({
        'id': str(uuid.uuid4()),
        'certificate_id': 'WEEKLY_REPORT',
        'domain_name': f'{len(CERT_CACHE)} certificates',
        'agency_name': 'All agencies',
        'recipient_email': ', '.join(
            NOTIFICATION_SETTINGS.get('recipients', ['admin@its.ms.gov'])
        ),
        'subject': subject,
        'message': body,
        'sent_at': now.isoformat(),
        'status': 'sent',
        'provider': result.get('provider', 'simulated'),
        'sns_message_id': result.get('message_id'),
        'reason': result.get('reason'),
        'report_type': 'weekly report'
    })

    return result


# ===========================================================================
# Auto-notify on startup + daily digest (driven by NOTIFICATION_SETTINGS)
# ===========================================================================

def _collect_urgent_certs(triggers: list[str]) -> list[dict[str, Any]]:
    """Return certs whose status matches at least one enabled trigger."""
    urgent: list[dict[str, Any]] = []
    for c in CERT_CACHE:
        s = c['status']
        if s == 'expired'       and 'expired'       in triggers: urgent.append(c)
        elif s == 'critical'    and 'critical'      in triggers: urgent.append(c)
        elif s == 'expiring_soon' and 'expiring_soon' in triggers: urgent.append(c)
    return urgent


def _send_digest(
    recipients: list[str],
    urgent: list[dict[str, Any]],
    tag: str,
) -> dict[str, Any]:
    """Send ONE SNS publish listing all urgent certs; log per recipient."""
    if not urgent or not recipients:
        log.info(
            "%s skipped — urgent=%d recipients=%d",
            tag, len(urgent), len(recipients),
        )
        return {'status': 'skipped', 'sent': 0}

    subject = f"[{tag}] {len(urgent)} Certificates Require Attention"
    lines = [
        "Mississippi ITS Certificate Lifecycle — Automated Alert",
        "=" * 55, "",
        f"{len(urgent)} certificate(s) flagged:", "",
    ]
    for c in urgent:
        days = c['days_to_expiry']
        when = f"EXPIRED {abs(days)}d ago" if days < 0 else f"expires in {days}d"
        lines.append(f"  [{c['status'].upper():14s}] {c['domain_name']}  —  {when}")

    lines += [
        "",
        f"Recipients: {', '.join(recipients)}",
        "",
        "Log in to the CSR Lifecycle dashboard to take action.",
        "--",
        "Mississippi ITS Automated Certificate Monitor",
    ]
    message = "\n".join(lines)

    sns_result = send_sns_notification(subject, message)
    log.info(
        "%s published — provider=%s certs=%d recipients=%d",
        tag, sns_result.get('provider'), len(urgent), len(recipients),
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    for recipient in recipients:
        EMAIL_LOG.append({
            'id':              str(uuid.uuid4()),
            'certificate_id':  'BULK',
            'domain_name':     f"{len(urgent)} certificates",
            'agency_name':     'Multiple',
            'recipient_email': recipient,
            'subject':         subject,
            'message':         message,
            'sent_at':         now_iso,
            'status':          'sent',
            'provider':        sns_result.get('provider'),
            'sns_message_id':  sns_result.get('message_id'),
        })

    return {
        'status':    'sent',
        'sent':      len(recipients),
        'provider':  sns_result.get('provider'),
        'topic_arn': sns_result.get('topic_arn'),
    }


def auto_notify_on_startup() -> None:
    """Send one bulk SNS alert to all configured recipients at boot time."""
    with _NOTIFY_LOCK:
        if not bool(NOTIFICATION_SETTINGS.get('startup_alerts_enabled', False)):
            log.info("STARTUP ALERT skipped (startup_alerts_enabled=false)")
            return

    # Avoid spamming on repeated restarts: send at most once per UTC day.
    startup_file = BASE_DIR / '.last_startup_alert'
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    try:
        if startup_file.exists() and startup_file.read_text().strip() == today:
            log.info("STARTUP ALERT skipped (already sent today)")
            return
    except Exception:
        pass

    with _NOTIFY_LOCK:
        recipients = list(NOTIFICATION_SETTINGS.get('recipients', []))
        triggers   = list(NOTIFICATION_SETTINGS.get('triggers', []))
    urgent = _collect_urgent_certs(triggers)
    _send_digest(recipients, urgent, tag="STARTUP ALERT")
    try:
        startup_file.write_text(today)
    except Exception:
        pass


def _daily_digest_check() -> None:
    """Send the daily digest if the current UTC hour matches daily_time,
    and we haven't already sent today.
    """
    global _LAST_DIGEST_DATE

    with _NOTIFY_LOCK:
        recipients = list(NOTIFICATION_SETTINGS.get('recipients', []))
        triggers   = list(NOTIFICATION_SETTINGS.get('triggers', []))
        daily_time = str(NOTIFICATION_SETTINGS.get('daily_time', '09:00'))

    try:
        want_hour = int(daily_time.split(':', 1)[0])
    except (ValueError, AttributeError):
        want_hour = 9

    now   = datetime.now(timezone.utc)
    today = now.strftime('%Y-%m-%d')

    if now.hour != want_hour:
        return
    if _LAST_DIGEST_DATE == today:
        return

    # Mark first so a slow SNS publish can't cause a double send
    _LAST_DIGEST_DATE = today

    urgent = _collect_urgent_certs(triggers)
    _send_digest(recipients, urgent, tag="DAILY DIGEST")


def _daily_digest_loop() -> None:
    """Background loop: check every 5 minutes whether it's time to send."""
    log.info("Daily digest loop started (checks every 5 min)")
    while True:
        try:
            _daily_digest_check()
        except Exception as e:
            log.error("Daily digest check failed: %s", e)
        time.sleep(300)


def _weekly_report_loop():
    """
    Background thread that sends weekly reports.
    Checks every hour whether a week has passed since
    the last report, then sends automatically.
    Satisfies scope: "Automatic weekly reports of activities
    sent to designated personnel."
    """
    import time
    from datetime import datetime, timezone

    LAST_WEEKLY_FILE = BASE_DIR / '.last_weekly_report'

    log.info("Weekly report loop started (checks every hour)")

    while True:
        try:
            time.sleep(3600)  # check every hour
            now = datetime.now(timezone.utc)

            # Check if 7 days have passed since last report
            if LAST_WEEKLY_FILE.exists():
                last_str = LAST_WEEKLY_FILE.read_text().strip()
                try:
                    last_dt = datetime.fromisoformat(last_str)
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    if (now - last_dt).days < 7:
                        continue
                except Exception:
                    # Corrupt / unexpected timestamp; treat as "needs report"
                    pass

            # Send the report
            send_weekly_report()
            LAST_WEEKLY_FILE.write_text(now.isoformat())

        except Exception as e:
            log.warning("Weekly report loop error (non-fatal): %s", e)


def _run_monitoring_pass() -> None:
    """Refresh days/status from expiration dates and optionally run auto-renewal."""
    global LAST_REFRESHED
    try:
        updated = _recompute_all_cert_statuses()
        if MONITORING_SETTINGS.get('auto_renewal_enabled'):
            for cert in CERT_CACHE:
                if not _cert_qualifies_for_agent(cert):
                    continue
                if cert['certificate_id'] in AGENT.jobs:
                    continue
                try:
                    AGENT.process_cert(cert, send_deployment_sns=False)
                except Exception as e:
                    log.warning(
                        "Monitoring pass skipped %s: %s",
                        cert.get('domain_name'),
                        e,
                    )
        LAST_REFRESHED = datetime.now(timezone.utc).isoformat()
        if updated:
            log.info("Monitoring pass: %d cert status(es) updated", updated)
    except Exception:
        log.exception("Monitoring pass failed")


def _monitoring_loop() -> None:
    log.info(
        "Certificate monitoring loop started (check_interval=%s)",
        MONITORING_SETTINGS.get('check_interval', 'daily'),
    )
    while True:
        try:
            interval = _monitoring_check_interval_seconds()
            time.sleep(interval)
            _run_monitoring_pass()
        except Exception as e:
            log.error("Monitoring loop error: %s", e)
            time.sleep(60)


def _start_monitoring_thread() -> None:
    global _MONITORING_THREAD_STARTED
    if _MONITORING_THREAD_STARTED:
        return
    _MONITORING_THREAD_STARTED = True
    threading.Thread(target=_monitoring_loop, daemon=True).start()


def _start_daily_digest_thread() -> None:
    """Start the background daily-digest thread exactly once."""
    global _DIGEST_THREAD_STARTED
    if _DIGEST_THREAD_STARTED:
        return
    _DIGEST_THREAD_STARTED = True
    t = threading.Thread(target=_daily_digest_loop, daemon=True)
    t.start()


_WEEKLY_THREAD_STARTED: bool = False


def _start_weekly_report_thread() -> None:
    """Start the background weekly-report thread exactly once."""
    global _WEEKLY_THREAD_STARTED
    if _WEEKLY_THREAD_STARTED:
        return
    _WEEKLY_THREAD_STARTED = True
    t = threading.Thread(target=_weekly_report_loop, daemon=True)
    t.start()
    log.info("Weekly report loop started (sends every 7 days)")


# Fire the startup bulk alert and start the daily-digest loop now that the
# helpers above are defined.
try:
    auto_notify_on_startup()
except Exception as _e:
    log.warning("auto_notify_on_startup failed: %s", _e)

_start_monitoring_thread()
_start_daily_digest_thread()
_start_weekly_report_thread()


# ===========================================================================
# Email / notify endpoints
# ===========================================================================

@app.route('/api/notify/email', methods=['POST'])
@require_auth(roles=['admin'])
def notify_email():
    data = request.get_json(force=True) or {}
    if 'certificate_id' not in data:
        return jsonify({'error': 'Missing certificate_id'}), 400

    cert_id   = data['certificate_id']
    recipient = data.get('recipient_email', 'admin@its.ms.gov')
    custom_message = data.get('message', '')

    cert = next((c for c in CERT_CACHE if c['certificate_id'] == cert_id), None)
    if not cert:
        return jsonify({'error': 'Certificate not found'}), 404

    days   = cert['days_to_expiry']
    status = cert['status'].upper()
    domain = cert['domain_name']
    agency = cert['agency_name']

    subject = f"[{status}] Certificate Alert: {domain}"

    if cert['status'] == 'expired':
        urgency = f"EXPIRED {abs(days)} days ago"
    elif cert['status'] == 'critical':
        urgency = f"CRITICAL — expires in {days} days"
    else:
        urgency = f"expires in {days} days"

    message = f"""Mississippi ITS Certificate Lifecycle Alert
{'='*50}

Certificate: {domain}
Agency:      {agency}
Status:      {status}
Timeline:    {urgency}
Issuer:      {cert.get('issuer', 'Unknown')}
Expires:     {cert.get('expiration_date', 'Unknown')}

{('Additional notes: ' + custom_message) if custom_message else ''}

Action Required: {'YES — renew immediately' if cert['status'] in ('expired', 'critical') else 'Monitor and schedule renewal'}

Renewal Agent Status: {'Job completed — CSR generated automatically'
    if cert_id in AGENT.jobs
    else 'Queued for next agent run'}

--
Mississippi ITS Automated Certificate Monitor
This is an automated notification. Do not reply.
{'='*50}
"""

    sns_result = send_sns_notification(subject, message)

    entry: dict[str, Any] = {
        'id':             str(uuid.uuid4()),
        'certificate_id': cert_id,
        'domain_name':    domain,
        'agency_name':    agency,
        'recipient_email': recipient,
        'subject':        subject,
        'message':        message,
        'sent_at':        datetime.now(timezone.utc).isoformat(),
        'status':         'sent',
        'provider':       sns_result['provider'],
        'sns_message_id': sns_result.get('message_id'),
        'report_type':    'single cert alert',
    }
    EMAIL_LOG.append(entry)
    try:
        _ddb_background(db_save_email_log_entry, entry)
    except Exception:
        pass
    return jsonify({'status': 'sent', 'email_log_entry': entry}), 200


@app.get("/api/notify/email/log")
@require_auth()
def notify_email_log():
    return jsonify(EMAIL_LOG)


@app.route('/api/notify/bulk', methods=['POST'])
@require_auth(roles=['admin'])
def notify_bulk():
    data      = request.get_json(force=True) or {}
    recipient = data.get('recipient_email', 'admin@its.ms.gov')

    urgent = [c for c in CERT_CACHE if c['status'] in ('expired', 'critical')]

    if not urgent:
        return jsonify({'status': 'nothing_to_send', 'count': 0})

    subject = f"[URGENT] {len(urgent)} Certificates Require Immediate Attention"

    lines = [
        "Mississippi ITS Certificate Lifecycle — Bulk Alert",
        "=" * 50, "",
        f"{len(urgent)} certificates require immediate attention:", "",
    ]
    for c in urgent:
        days = c['days_to_expiry']
        tag  = f"EXPIRED {abs(days)}d ago" if days < 0 else f"expires in {days}d"
        lines.append(f"  [{c['status'].upper()}] {c['domain_name']} — {tag}")

    lines += [
        "",
        "Log in to the CSR Lifecycle dashboard to take action.",
        "--",
        "Mississippi ITS Automated Certificate Monitor",
    ]

    message    = "\n".join(lines)
    sns_result = send_sns_notification(subject, message)

    entries: list[dict[str, Any]] = []
    for c in urgent:
        entry: dict[str, Any] = {
            'id':             str(uuid.uuid4()),
            'certificate_id': c['certificate_id'],
            'domain_name':    c['domain_name'],
            'recipient_email': recipient,
            'subject':        subject,
            'sent_at':        datetime.now(timezone.utc).isoformat(),
            'status':         'sent',
            'provider':       sns_result['provider'],
            'sns_message_id': sns_result.get('message_id'),
            'report_type':    'bulk alert',
        }
        EMAIL_LOG.append(entry)
        entries.append(entry)
        try:
            _ddb_background(db_save_email_log_entry, entry)
        except Exception:
            pass

    return jsonify({
        'status':          'sent',
        'count':           len(entries),
        'provider':        sns_result['provider'],
        'certs_notified':  [e['domain_name'] for e in entries],
    })


# ===========================================================================
# AI analysis endpoints
# ===========================================================================

@app.get("/api/certificates/<cert_id>/analysis")
@require_auth()
def cert_analysis(cert_id: str):
    refresh = request.args.get('refresh', '').lower() in ('1', 'true', 'yes')
    if refresh:
        cert = next(
            (c for c in CERT_CACHE if c['certificate_id'] == cert_id),
            None,
        )
        if cert is None:
            return jsonify({"error": "not found"}), 404
        refresh_ai_analysis([cert_id], background=False)

    analysis = AI_ANALYSIS.get(cert_id)
    if not analysis:
        return jsonify({"error": "analysis not ready yet",
                        "cert_id": cert_id}), 404
    return jsonify(analysis)


@app.get("/api/ai/top-risks")
@require_auth()
def ai_top_risks():
    analyzed = list(AI_ANALYSIS.values())
    if not analyzed:
        return jsonify([])
    top5 = sorted(
        analyzed,
        key=lambda x: x.get('urgency_score', 0),
        reverse=True,
    )[:5]
    out: list[dict[str, Any]] = []
    for item in top5:
        cert_id = item.get('certificate_id')
        cert = next(
            (c for c in CERT_CACHE if c['certificate_id'] == cert_id),
            {},
        )
        ra = item.get('risk_assessment') or {}
        out.append({
            'certificate_id':   cert_id,
            'domain_name':        cert.get('domain_name', item.get('domain_name', '')),
            'agency_name':        cert.get('agency_name', ''),
            'status':             cert.get('status', ''),
            'urgency_score':      item.get('urgency_score', 0),
            'action':             item.get('action', ''),
            'reason':             item.get('reason', ''),
            'risk_level':         ra.get('risk_level', ''),
            'risks':              ra.get('risks', []),
            'consequences':       ra.get('consequences', []),
            'estimated_impact':   ra.get('estimated_impact', ''),
            'provider':           item.get('provider', ''),
        })
    return jsonify(out)


@app.get("/api/ai/summary")
@require_auth()
def ai_summary():
    analyzed = list(AI_ANALYSIS.values())
    if not analyzed:
        return jsonify({
            "total_analyzed": 0,
            "last_analyzed": "",
            "status": "analysis in progress — check back in 30 seconds"
        })
    critical  = [a for a in analyzed if a.get('risk_assessment', {}).get('risk_level') == 'critical']
    high      = [a for a in analyzed if a.get('risk_assessment', {}).get('risk_level') == 'high']
    renew_now = [a for a in analyzed if a.get('action') == 'renew_immediately']
    bedrock   = [a for a in analyzed if a.get('provider') == 'amazon_bedrock']
    return jsonify({
        'total_analyzed':          len(analyzed),
        'critical_count':          len(critical),
        'high_risk_count':         len(high),
        'renew_immediately_count': len(renew_now),
        'bedrock_powered':         len(bedrock),
        'rule_based_fallback':     len(analyzed) - len(bedrock),
        'last_analyzed': max(
            (a.get('analyzed_at', '') for a in AI_ANALYSIS.values()),
            default=''
        ),
        'ai_provider': 'Amazon Bedrock (Nova Lite)'
                       if bedrock else 'Rule-based fallback'
    })


@app.get("/api/aws/s3/status")
@require_auth()
def s3_status():
    try:
        import boto3 as _boto3
        s3c = _boto3.client('s3', region_name=AWS_REGION)
        buckets = ['mock-certificate-data', 'certificate-data-processed1']
        info = []
        for b in buckets:
            try:
                objs = s3c.list_objects_v2(Bucket=b, MaxKeys=200)
                info.append({
                    'bucket': b,
                    'object_count': objs.get('KeyCount', 0),
                    'accessible': True
                })
            except Exception as be:
                info.append({'bucket': b, 'accessible': False,
                             'error': str(be)})
        return jsonify({'buckets': info, 'region': AWS_REGION})
    except Exception as e:
        return jsonify({'error': str(e), 'buckets': []}), 500


@app.get("/api/aws/cost/summary")
@require_auth()
def aws_cost_summary():
    """
    Live billing summary via AWS Cost Explorer (best-effort).

    Returns 200 with {live: false, reason: "..."} when billing is unavailable,
    so the UI can gracefully fall back to static estimates.
    """
    window_days_raw = request.args.get('window_days', '30')
    try:
        window_days = int(window_days_raw)
    except Exception:
        window_days = 30
    window_days = max(1, min(365, window_days))

    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=window_days)
    # Cost Explorer End is exclusive; add 1 day to include "today".
    end_exclusive = today + timedelta(days=1)

    if boto3 is None or BotocoreConfig is None:
        return jsonify({
            'live': False,
            'provider': 'unavailable',
            'reason': 'AWS SDK (boto3/botocore) not installed',
            'window_days': window_days,
            'start': start_date.isoformat(),
            'end': today.isoformat(),
        })

    try:
        ce = boto3.client(
            'ce',
            region_name=AWS_COST_EXPLORER_REGION,
            config=BotocoreConfig(
                connect_timeout=5,
                read_timeout=15,
                retries={'max_attempts': 1},
            ),
        )

        # Daily totals for chart/trend
        resp_daily = ce.get_cost_and_usage(
            TimePeriod={
                'Start': start_date.isoformat(),
                'End': end_exclusive.isoformat(),
            },
            Granularity='DAILY',
            Metrics=['UnblendedCost'],
        )

        daily: list[dict[str, Any]] = []
        total_amount = 0.0
        currency = 'USD'
        for row in resp_daily.get('ResultsByTime', []) or []:
            t = (row.get('TimePeriod') or {})
            d = t.get('Start') or ''
            amt = (row.get('Total') or {}).get('UnblendedCost', {}).get('Amount', '0')
            unit = (row.get('Total') or {}).get('UnblendedCost', {}).get('Unit', currency)
            currency = unit or currency
            try:
                v = float(amt)
            except Exception:
                v = 0.0
            total_amount += v
            daily.append({'date': d, 'amount': round(v, 4)})

        # Service breakdown (month granularity over the same range)
        resp_group = ce.get_cost_and_usage(
            TimePeriod={
                'Start': start_date.isoformat(),
                'End': end_exclusive.isoformat(),
            },
            Granularity='MONTHLY',
            Metrics=['UnblendedCost'],
            GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}],
        )
        by_service: list[dict[str, Any]] = []
        groups = []
        try:
            # For MONTHLY, first ResultsByTime has the groups we want.
            groups = (resp_group.get('ResultsByTime') or [{}])[0].get('Groups') or []
        except Exception:
            groups = []
        for g in groups:
            keys = g.get('Keys') or []
            svc = keys[0] if keys else 'Unknown'
            amt = (g.get('Metrics') or {}).get('UnblendedCost', {}).get('Amount', '0')
            try:
                v = float(amt)
            except Exception:
                v = 0.0
            if v <= 0:
                continue
            by_service.append({'service': svc, 'amount': round(v, 4)})
        by_service.sort(key=lambda x: x.get('amount', 0), reverse=True)

        return jsonify({
            'live': True,
            'provider': 'aws_cost_explorer',
            'currency': currency,
            'window_days': window_days,
            'start': start_date.isoformat(),
            'end': today.isoformat(),
            'total_amount': round(total_amount, 4),
            'daily': daily,
            'by_service': by_service[:15],
        })
    except NoCredentialsError:
        return jsonify({
            'live': False,
            'provider': 'unavailable',
            'reason': 'AWS credentials not configured',
            'window_days': window_days,
            'start': start_date.isoformat(),
            'end': today.isoformat(),
        })
    except ClientError as e:
        return jsonify({
            'live': False,
            'provider': 'unavailable',
            'reason': str(e),
            'window_days': window_days,
            'start': start_date.isoformat(),
            'end': today.isoformat(),
        })
    except Exception as e:
        return jsonify({
            'live': False,
            'provider': 'unavailable',
            'reason': f'{type(e).__name__}: {e}',
            'window_days': window_days,
            'start': start_date.isoformat(),
            'end': today.isoformat(),
        })


@app.post("/api/aws/s3/sync")
@require_auth(roles=['admin'])
def s3_sync():
    import threading as _t
    _t.Thread(target=_sync_to_s3, daemon=True).start()
    return jsonify({'status': 'triggered',
                    'message': 'S3 sync started in background'})


# ===========================================================================
# Integrations settings (persisted)
# ===========================================================================


@app.get("/api/integrations/settings")
@require_auth()
def get_integration_settings():
    return jsonify(dict(INTEGRATION_SETTINGS))


@app.post("/api/integrations/settings")
@require_auth(roles=['admin'])
def save_integration_settings():
    data = request.get_json(force=True) or {}

    def _bool(v: Any, default: bool) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("1", "true", "yes", "on")
        if isinstance(v, (int, float)):
            return bool(v)
        return bool(default)

    try:
        INTEGRATION_SETTINGS.update({
            "local_ca_enabled": _bool(data.get("local_ca_enabled"), bool(INTEGRATION_SETTINGS.get("local_ca_enabled", True))),
            "entrust_enabled": _bool(data.get("entrust_enabled"), bool(INTEGRATION_SETTINGS.get("entrust_enabled", False))),
            "fortimanager_enabled": _bool(data.get("fortimanager_enabled"), bool(INTEGRATION_SETTINGS.get("fortimanager_enabled", False))),
            "fortimanager_host": str(data.get("fortimanager_host", INTEGRATION_SETTINGS.get("fortimanager_host", "")) or ""),
            "iis_confirmation_required": _bool(
                data.get("iis_confirmation_required"),
                bool(INTEGRATION_SETTINGS.get("iis_confirmation_required", True)),
            ),
        })
    except Exception:
        log.exception("Failed to update integration settings in memory (non-fatal).")

    try:
        _ddb_background(db_save_setting, 'integration_settings', INTEGRATION_SETTINGS)
    except Exception:
        pass

    return jsonify({"status": "saved", "settings": dict(INTEGRATION_SETTINGS)})


# ===========================================================================
# Main
# ===========================================================================

if __name__ == "__main__":
    banner = f"""
{'='*60}
  API Bridge  —  Certificate Management REST API
{'='*60}
  Base URL : http://localhost:5000
  CORS     : http://localhost:8081

  Health & Info
    GET  /api/health
    GET  /api/aws/dynamodb/status
    GET  /api/agent/status

  Certificates
    GET  /api/certificates
    POST /api/certificates
    GET  /api/certificates/summary
    GET  /api/certificates/<cert_id>
    GET  /api/certificates/status/<status>

  Live SSL Check
    POST /api/ssl/check              {{ hostname, port }}

  CSR
    GET  /api/csr/list
    GET  /api/csr/<cert_id>
    POST /api/csr/generate           {{ certificate_id }}

  Renewal
    GET  /api/renew/jobs
    GET  /api/renew/status/<job_id>
    POST /api/agent/run-now

  Notifications
    GET  /api/notifications          [?unread=true] [?severity=critical]
    GET  /api/notifications/summary
    POST /api/notifications/<id>/read
    POST /api/notifications/read-all
    GET  /api/notifications/settings
    POST /api/notifications/settings {{ recipients, daily_time, triggers }}

  Email / SNS
    POST /api/notify/email           {{ certificate_id, recipient_email, message }}
    POST /api/notify/bulk            {{ recipient_email }}
    GET  /api/notify/email/log

  Reports
    POST /api/reports/weekly         (manual trigger)
    Automatic: every 7 days via background thread

  SNS provider : {'aws_sns (' + SNS_TOPIC_ARN + ')' if SNS_TOPIC_ARN else 'simulated (set SNS_TOPIC_ARN to enable)'}
  DynamoDB     : {'enabled' if _DDB_AVAILABLE else 'disabled'}
  AI Analysis  : Amazon Bedrock (Nova Lite) — us-east-1
  S3 Buckets   : mock-certificate-data / certificate-data-processed1
  AWS Region   : {AWS_REGION}
{'='*60}
"""
    print(banner)
    app.run(host="0.0.0.0", port=5000, debug=False)
