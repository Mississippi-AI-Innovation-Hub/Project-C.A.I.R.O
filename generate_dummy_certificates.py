#!/usr/bin/env python3
"""
Generate dummy SSL/TLS certificates and save their metadata to a CSV file.

What this script does:
1. Creates a folder for generated certificates
2. Generates self-signed certificates with OpenSSL
3. Saves certificate metadata to certificate_inventory.csv

Usage examples:
    python generate_dummy_certificates.py
    python generate_dummy_certificates.py --count 20
    python generate_dummy_certificates.py --days-valid 365 --output-dir demo_certs
"""

from __future__ import annotations

import argparse
import csv
import random
import subprocess
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import List


AGENCIES = [
    ("Mississippi Development Authority", "WebOps"),
    ("Mississippi Department of Health", "Infra Team"),
    ("Mississippi Department of Revenue", "Security Team"),
    ("Mississippi Department of Education", "DevOps"),
    ("Mississippi Department of Transportation", "Platform Team"),
    ("Mississippi Department of Finance", "Engineering"),
    ("Mississippi Citizen Services", "Identity Team"),
    ("Mississippi Department of Labor", "QA Team"),
]

ISSUERS = [
    "Amazon Trust Services",
    "Let's Encrypt",
    "DigiCert",
    "GlobalSign",
    "Entrust",
]

CERTIFICATE_TYPES = ["DV", "OV", "EV", "wildcard", "internal"]
ENVIRONMENTS = ["production", "staging", "dev"]
STATUS_CHOICES = ["active", "expiring_soon", "expired", "pending_renewal", "failed", "renewed"]


@dataclass
class CertificateRecord:
    certificate_id: str
    domain_name: str
    common_name: str
    issuer: str
    certificate_type: str
    environment: str
    agency_name: str
    owning_team: str
    issue_date: str
    expiration_date: str
    days_to_expiry: int
    renewal_threshold_days: int
    status: str
    auto_renew_enabled: str
    csr_required: str
    last_renewal_date: str
    deployment_status: str
    validation_status: str
    serial_number: str
    fingerprint_sha256: str
    alert_sent: str
    notes: str
    certificate_path: str
    private_key_path: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate dummy certificates and save metadata to CSV."
    )
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Number of dummy certificates to generate (default: 10).",
    )
    parser.add_argument(
        "--days-valid",
        type=int,
        default=365,
        help="Validity period in days for the generated certificates (default: 365).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("generated_certificates"),
        help="Directory where certificates, keys, and CSV will be stored.",
    )
    parser.add_argument(
        "--state",
        default="Mississippi",
        help="State used in the certificate subject (default: Mississippi).",
    )
    parser.add_argument(
        "--city",
        default="Starkville",
        help="City used in the certificate subject (default: Starkville).",
    )
    return parser.parse_args()


def check_openssl() -> None:
    try:
        result = subprocess.run(
            ["openssl", "version"],
            capture_output=True,
            text=True,
            check=True,
        )
        print(f"Using {result.stdout.strip()}")
    except FileNotFoundError as exc:
        raise SystemExit(
            "OpenSSL is not installed or not in PATH. Install OpenSSL first."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"Could not run OpenSSL: {exc}") from exc


def make_domain(index: int, environment: str) -> str:
    service_names = [
        "portal",
        "services",
        "login",
        "api",
        "www",
        "citizen",
        "health",
        "transport",
        "education",
        "finance",
    ]
    service = random.choice(service_names)
    if environment == "production":
        return f"{service}.agency{index:02d}.ms.gov"
    return f"{service}.{environment}.agency{index:02d}.ms.gov"


def choose_status(expiration_date: date, threshold_days: int) -> str:
    days_left = (expiration_date - date.today()).days
    if days_left < 0:
        return "expired"
    if days_left <= threshold_days:
        return random.choice(["expiring_soon", "pending_renewal"])
    return random.choice(["active", "renewed"])


def deployment_status_for(status: str) -> str:
    mapping = {
        "active": "deployed",
        "renewed": "deployed",
        "expiring_soon": "deployed",
        "pending_renewal": "pending",
        "expired": "failed",
        "failed": "failed",
    }
    return mapping.get(status, "pending")


def validation_status_for(status: str) -> str:
    mapping = {
        "active": "passed",
        "renewed": "passed",
        "expiring_soon": "pending",
        "pending_renewal": "pending",
        "expired": "failed",
        "failed": "failed",
    }
    return mapping.get(status, "pending")


def note_for(status: str) -> str:
    notes = {
        "active": "Certificate is healthy.",
        "renewed": "Recently renewed successfully.",
        "expiring_soon": "Renewal should be triggered soon.",
        "pending_renewal": "CSR generated; waiting for deployment.",
        "expired": "Certificate expired before renewal.",
        "failed": "Renewal or deployment failed in testing.",
    }
    return notes.get(status, "")


def extract_serial(cert_path: Path) -> str:
    result = subprocess.run(
        ["openssl", "x509", "-in", str(cert_path), "-noout", "-serial"],
        capture_output=True,
        text=True,
        check=True,
    )
    line = result.stdout.strip()
    return line.split("=", 1)[1] if "=" in line else line


def extract_fingerprint(cert_path: Path) -> str:
    result = subprocess.run(
        ["openssl", "x509", "-in", str(cert_path), "-noout", "-fingerprint", "-sha256"],
        capture_output=True,
        text=True,
        check=True,
    )
    line = result.stdout.strip()
    return line.split("=", 1)[1] if "=" in line else line


def generate_certificate(
    common_name: str,
    org_name: str,
    output_key: Path,
    output_cert: Path,
    days_valid: int,
    state: str,
    city: str,
) -> None:
    subject = f"/C=US/ST={state}/L={city}/O={org_name}/OU=IT/CN={common_name}"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-nodes",
            "-days",
            str(days_valid),
            "-newkey",
            "rsa:2048",
            "-keyout",
            str(output_key),
            "-out",
            str(output_cert),
            "-subj",
            subject,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def build_record(index: int, cert_path: Path, key_path: Path, days_valid: int) -> CertificateRecord:
    agency_name, owning_team = random.choice(AGENCIES)
    issuer = random.choice(ISSUERS)
    certificate_type = random.choice(CERTIFICATE_TYPES)
    environment = random.choice(ENVIRONMENTS)
    domain_name = make_domain(index, environment)
    common_name = domain_name

    issue_date = date.today() - timedelta(days=random.randint(0, 320))
    threshold_days = random.choice([15, 30, 45, 60])

    # Create realistic expiry spread for different statuses in the dataset.
    expiry_pattern = random.choice([
        random.randint(-20, -1),   # expired
        random.randint(1, threshold_days),  # expiring soon
        random.randint(threshold_days + 1, days_valid),  # active
    ])
    expiration_date = date.today() + timedelta(days=expiry_pattern)

    status = choose_status(expiration_date, threshold_days)
    if random.random() < 0.12:
        status = "failed"

    auto_renew_enabled = random.choice(["yes", "no"])
    csr_required = random.choice(["yes", "no"])
    days_to_expiry = (expiration_date - date.today()).days

    last_renewal_date = issue_date if status != "renewed" else (date.today() - timedelta(days=random.randint(1, 30)))
    deployment_status = deployment_status_for(status)
    validation_status = validation_status_for(status)
    alert_sent = "yes" if status in {"expired", "expiring_soon", "pending_renewal", "failed"} else "no"

    serial_number = extract_serial(cert_path)
    fingerprint_sha256 = extract_fingerprint(cert_path)

    return CertificateRecord(
        certificate_id=f"CERT-{index:03d}",
        domain_name=domain_name,
        common_name=common_name,
        issuer=issuer,
        certificate_type=certificate_type,
        environment=environment,
        agency_name=agency_name,
        owning_team=owning_team,
        issue_date=issue_date.isoformat(),
        expiration_date=expiration_date.isoformat(),
        days_to_expiry=days_to_expiry,
        renewal_threshold_days=threshold_days,
        status=status,
        auto_renew_enabled=auto_renew_enabled,
        csr_required=csr_required,
        last_renewal_date=last_renewal_date.isoformat(),
        deployment_status=deployment_status,
        validation_status=validation_status,
        serial_number=serial_number,
        fingerprint_sha256=fingerprint_sha256,
        alert_sent=alert_sent,
        notes=note_for(status),
        certificate_path=str(cert_path),
        private_key_path=str(key_path),
    )


def write_csv(records: List[CertificateRecord], csv_path: Path) -> None:
    fieldnames = list(CertificateRecord.__annotations__.keys())
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(record.__dict__)


def main() -> None:
    args = parse_args()
    check_openssl()

    output_dir = args.output_dir
    certs_dir = output_dir / "certs"
    keys_dir = output_dir / "keys"
    output_dir.mkdir(parents=True, exist_ok=True)
    certs_dir.mkdir(parents=True, exist_ok=True)
    keys_dir.mkdir(parents=True, exist_ok=True)

    records: List[CertificateRecord] = []

    for i in range(1, args.count + 1):
        env = random.choice(ENVIRONMENTS)
        domain_name = make_domain(i, env)

        cert_path = certs_dir / f"{domain_name}.crt"
        key_path = keys_dir / f"{domain_name}.key"

        agency_name, _ = random.choice(AGENCIES)
        generate_certificate(
            common_name=domain_name,
            org_name=agency_name,
            output_key=key_path,
            output_cert=cert_path,
            days_valid=args.days_valid,
            state=args.state,
            city=args.city,
        )

        record = build_record(i, cert_path, key_path, args.days_valid)
        # Keep CSV domain aligned with the actual generated file names.
        record.domain_name = domain_name
        record.common_name = domain_name
        records.append(record)

    csv_path = output_dir / "certificate_inventory.csv"
    write_csv(records, csv_path)

    print(f"\nDone. Generated {len(records)} certificates.")
    print(f"CSV file: {csv_path}")
    print(f"Certificates folder: {certs_dir}")
    print(f"Private keys folder: {keys_dir}")


if __name__ == "__main__":
    main()
