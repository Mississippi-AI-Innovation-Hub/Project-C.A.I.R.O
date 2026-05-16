# Local Certificate Checker

## What This Is

`local_cert_checker.py` is the **core monitoring engine** of the Proof of Concept for automated certificate lifecycle management.

It reads the certificate inventory CSV and the locally generated `.crt` files, extracts real cryptographic metadata from each cert, computes a lifecycle status for each one, and outputs a flat JSON structure that is ready to be written directly to **Amazon DynamoDB** — no changes to the record format needed.

No live network connections are made. No database is required to run it. Everything works from local files, which makes it runnable before AWS access is available.

---

## Where It Came From — Adapting the SSL Checker

The project already contained a separate folder called `tools/ssl_checker/`, built for a previous project. That project had two Python scripts:

| File | What it did |
|---|---|
| `ssl_checker_simple.py` | Flask API — connected to live domains via TLS socket, extracted cert metadata |
| `certificate_monitor.py` | Background service — polled a PostgreSQL database, called the Flask API, updated DB records |

Neither script could be used directly because:
- `ssl_checker_simple.py` requires a live TCP connection to a real host. The dummy domains (`www.dev.agency01.ms.gov`, etc.) do not exist on the internet.
- `certificate_monitor.py` is entirely tied to PostgreSQL via `psycopg2`. This project uses DynamoDB.

However, two things inside those scripts were directly reusable — only the data source needed to change. The table below shows exactly what was kept vs. what was replaced.

### Component-by-component comparison

| Component | Original (ssl checker) | Adapted (local_cert_checker.py) | Change |
|---|---|---|---|
| `get_cert_sans()` | Receives `x509` object from TLS socket | Receives `x509` object from PEM file | **None** — identical logic |
| `get_cert_info()` | Receives `x509` object from TLS socket | Renamed `parse_cert_file()`, receives `x509` object from PEM file | Minimal — source of object changed |
| `get_cert()` — network layer | Opens TCP socket → TLS handshake → `x509.load_der_x509_certificate()` | **Replaced** with `x509.load_pem_x509_certificate(cert_path.read_bytes())` | Full swap — one line |
| Status logic in `certificate_monitor.py` | Mapped API JSON fields to PostgreSQL column values (`'valid'`, `'warning'`, `'critical'`, `'expired'`) | Renamed `compute_status()`, accepts integer days directly, returns CSV-vocabulary labels | Minor refactor |
| `DatabaseManager` (PostgreSQL) | `psycopg2` — reads/writes `ssl_certificates` table | **Removed** — replaced by CSV reader + DynamoDB-ready dict builder | Full replacement |
| Monitoring loop | Thread polling a PostgreSQL table | **Not yet implemented** — planned for AWS Lambda trigger | Future work |

### The key one-line change

The entire network dependency in `ssl_checker_simple.py` boils down to how the `x509` certificate object is obtained:

```python
# Original — requires a live host, TLS handshake, network access:
cert_der = ssl_sock.getpeercert(binary_form=True)
cert = x509.load_der_x509_certificate(cert_der, default_backend())

# Adapted — reads a local PEM file, no network needed:
cert = x509.load_pem_x509_certificate(cert_path.read_bytes(), default_backend())
```

Everything that follows — field extraction, fingerprint calculation, SAN parsing, validity window math — is identical to the original `get_cert_info()` method because it all operates on the same `x509.Certificate` object type.

---

## How It Works — Step by Step

```
certificate_inventory.csv           generated_certificates/certs/*.crt
         |                                          |
         v                                          v
   load_inventory()                        parse_cert_file()
         |                                          |
         +------- build_record() ------------------+
                        |
                  compute_status()
                        |
                  DynamoDB-ready dict
                        |
              print_summary()  +  JSON output
```

### Step 1 — Load the inventory CSV

`load_inventory()` reads `generated_certificates/certificate_inventory.csv` into a list of row dicts. Each row represents one certificate with its simulated lifecycle metadata (agency, team, status, expiration date, thresholds, flags).

### Step 2 — Parse the real .crt file

`parse_cert_file()` loads the corresponding `.crt` file using the `cryptography` library and extracts:

- Common name, issuer (CN, O, OU, C)
- Serial number
- SHA-256 and SHA-1 fingerprints
- Signature algorithm and certificate version
- Subject Alternative Names (SANs)
- Real validity window (`not_valid_before`, `not_valid_after`)
- Real days remaining, hours remaining, minutes remaining
- Whether the cert is actually expired

If the file is missing or cannot be parsed, the record is still built using CSV data, and `cert_file_loaded` is set to `false`.

### Step 3 — Compute lifecycle status

`compute_status()` takes the number of days to expiry and the per-certificate renewal threshold and returns a status string:

| Condition | Status |
|---|---|
| `days_to_expiry < 0` | `expired` |
| `0 <= days_to_expiry <= 7` | `critical` |
| `7 < days_to_expiry <= threshold` | `expiring_soon` |
| `days_to_expiry > threshold` | `active` |

### Step 4 — Merge into a DynamoDB-ready record

`build_record()` merges the CSV row and the parsed cert data into a single flat dict. Every key is a future DynamoDB attribute name. Every value is a Python `str`, `int`, or `bool` — all DynamoDB-compatible scalar types.

### Step 5 — Output

A summary table is printed to the terminal. The full JSON payload is either written to a file (`--output`) or printed to stdout.

---

## Simulation Mode vs. Real Date Mode

The `.crt` files were generated recently with OpenSSL, so they all have valid, non-expired actual dates. But the inventory CSV was designed to simulate a realistic spread of lifecycle states — some expired, some expiring soon, some active.

The script supports two modes to handle this:

### Simulation mode (default)

```
python local_cert_checker.py
```

Status is computed from the `expiration_date` and `days_to_expiry` columns in the CSV. This lets you test all lifecycle scenarios (expired, critical, expiring_soon, active) even though the physical cert files are technically still valid. This is the correct mode for PoC testing.

### Real date mode

```
python local_cert_checker.py --use-real-dates
```

Status is computed from the actual `not_valid_after` date inside the `.crt` file. All certs will show as `active` because they were just generated. Use this to verify that the cryptographic parsing path is working correctly and that real cert dates are being read.

Both modes always populate the `real_valid_from`, `real_valid_till`, and `real_days_to_expiry` fields from the actual cert file, regardless of which mode is active. The only thing that changes between modes is what drives the `status` field and the `expiration_date` field in the output.

---

## DynamoDB Record Structure

Each output record is a flat dict that can be passed directly to `boto3`'s `put_item()` call. Example of a single record:

```json
{
  "certificate_id":          "CERT-006",
  "domain_name":             "portal.dev.agency06.ms.gov",
  "common_name":             "portal.dev.agency06.ms.gov",
  "certificate_type":        "EV",
  "environment":             "dev",
  "agency_name":             "Mississippi Department of Transportation",
  "owning_team":             "Platform Team",
  "issuer":                  "Amazon Trust Services",
  "issuer_cn":               "portal.dev.agency06.ms.gov",
  "issuer_o":                "Mississippi Department of Transportation",
  "issuer_c":                "US",
  "issue_date":              "2026-01-20",
  "expiration_date":         "2026-04-09",
  "days_to_expiry":          2,
  "renewal_threshold_days":  60,
  "status":                  "critical",
  "csv_status":              "expiring_soon",
  "auto_renew_enabled":      "no",
  "csr_required":            "yes",
  "last_renewal_date":       "2026-01-20",
  "deployment_status":       "deployed",
  "validation_status":       "pending",
  "alert_sent":              "yes",
  "notes":                   "Renewal should be triggered soon.",
  "cert_serial_number":      "...",
  "cert_fingerprint_sha256": "...",
  "cert_fingerprint_sha1":   "...",
  "cert_algorithm":          "sha256WithRSAEncryption",
  "cert_version":            2,
  "cert_sans":               "",
  "real_valid_from":         "2026-01-20 10:32:01 UTC",
  "real_valid_till":         "2027-01-20 10:32:01 UTC",
  "real_validity_days":      365,
  "real_days_to_expiry":     285,
  "real_cert_expired":       false,
  "expires_in_hours":        6840,
  "expires_in_minutes":      410400,
  "cert_file_loaded":        true,
  "last_checked":            "2026-04-09T15:00:00.000000+00:00",
  "date_mode":               "simulated"
}
```

### DynamoDB key design (planned)

| Key type | Attribute | Example value |
|---|---|---|
| Partition key | `certificate_id` | `CERT-006` |
| Sort key (optional) | `domain_name` | `portal.dev.agency06.ms.gov` |

When DynamoDB access is available, the integration is a thin wrapper:

```python
import boto3
dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
table = dynamodb.Table("CertificateInventory")

for record in records:
    table.put_item(Item=record)
```

No changes to the record structure are needed.

---

## How to Run

### Prerequisites

Make sure you are in the project virtual environment and dependencies are installed:

```bash
# From the aws_project directory
pip install -r requirements.txt
```

The only dependency this script needs (already in `requirements.txt`) is:

```
cryptography>=42.0.0
```

### Commands

Run with default settings — prints summary + full JSON to terminal:

```bash
python local_cert_checker.py
```

Save results to a file:

```bash
python local_cert_checker.py --output results.json
```

Filter to a specific status:

```bash
python local_cert_checker.py --filter-status expired
python local_cert_checker.py --filter-status critical
python local_cert_checker.py --filter-status expiring_soon --output expiring.json
```

Check real cert dates instead of simulated dates:

```bash
python local_cert_checker.py --use-real-dates
```

Use a different CSV or certs folder:

```bash
python local_cert_checker.py --inventory path/to/other.csv --certs-dir path/to/certs/
```

### Expected terminal output

```
======================================================================
  Certificate Inventory Summary  —  2026-04-09 15:00
======================================================================
  Total : 20
  ! expired              3
  ! critical             2
    expiring_soon        5
    active               10
======================================================================

[EXPIRED]
  CERT-005  portal.dev.agency05.ms.gov                      days= -16  file=ok
  CERT-010  login.dev.agency10.ms.gov                       days=  -2  file=ok
  CERT-014  www.staging.agency14.ms.gov                     days= -20  file=ok

[CRITICAL]
  CERT-006  portal.dev.agency06.ms.gov                      days=   2  file=ok
  CERT-011  education.dev.agency11.ms.gov                   days=   5  file=ok
...
```

---

## Files Involved

```
aws_project/
├── local_cert_checker.py               ← this script
├── docs/cert-checker.md                ← this file
├── requirements.txt                    ← cryptography>=42.0.0 (already present)
├── generate_dummy_certificates.py      ← generated the test data
├── docs/certificate-generator.md       ← explains the generator
└── generated_certificates/
    ├── certificate_inventory.csv       ← 20-row lifecycle inventory (input)
    ├── certs/
    │   └── *.crt                       ← real OpenSSL self-signed certs (input)
    └── keys/
        └── *.key                       ← private keys (not read by this script)

tools/ssl_checker/
├── ssl_checker_simple.py               ← original source for get_cert_info, get_cert_sans
└── certificate_monitor.py              ← original source for status logic and monitor loop
```

---

## Relationship to the Full System

This script is the **local simulation layer** of the broader pipeline:

```
[NOW — local PoC]
generate_dummy_certificates.py  →  certificate_inventory.csv + *.crt files
local_cert_checker.py           →  reads CSV + .crt files, outputs DynamoDB-ready JSON

[NEXT — AWS integration]
local_cert_checker.py (or Lambda version)  →  writes records to DynamoDB
AWS EventBridge / Lambda trigger           →  scheduled monitoring loop
Step Functions workflow                    →  CSR generation, renewal, deployment
SNS / SES                                  →  alerts for expiring/expired certs
```

The record format produced by `local_cert_checker.py` is already designed to be the DynamoDB item schema. When AWS access is available, the only additions needed are:

1. Replace `load_inventory()` + `parse_cert_file()` with reads from actual ACM or ITS certificate sources
2. Add a `boto3` `put_item()` call at the end of `build_record()`
3. Wrap the loop in a Lambda handler or EventBridge-triggered function

---

## Limitations (PoC scope)

- The `.crt` files are self-signed with no chain of trust. Real certificates would be issued by a CA (Amazon Trust Services, DigiCert, etc.).
- The simulated expiration dates in the CSV do not match the real cert dates. This is intentional — it lets us test all lifecycle states locally before AWS is available.
- CSR generation, renewal workflow, and deployment validation are not yet implemented. They are the next planned steps (Week 3–4 of the project timeline).
- No DynamoDB writes happen yet. The JSON output is the pre-integration artifact.
