# AWS AI Innovation Hub — Dummy Certificate Generator

This project was created to support the **Automated CSR / Certificate Lifecycle Management** proof of concept. It generates **dummy self-signed certificates**, stores the certificate files and private keys in folders, and creates a **CSV inventory file** that can be used for testing certificate monitoring, renewal logic, dashboards, and workflow automation.

## Project purpose

The goal of this script is to simulate a certificate inventory for a PoC where we need to:

- keep track of domains and certificates
- monitor expiration dates
- flag certificates that are expiring soon
- simulate renewal workflows
- test certificate status tracking in a structured dataset

## Main script

The main script is:

`generate_dummy_certificates.py`

What it does:

1. checks that OpenSSL is available
2. creates output folders
3. generates self-signed `.crt` certificates
4. generates matching `.key` private keys
5. extracts certificate metadata such as serial number and SHA-256 fingerprint
6. writes all certificate information into a CSV file called `certificate_inventory.csv`

## Output structure

After running the script, the project creates:

```text
generated_certificates/
│
├── certs/
│   ├── *.crt
│
├── keys/
│   ├── *.key
│
└── certificate_inventory.csv
```

## Required packages

### Python packages

Install the dependencies from `requirements.txt`:

```text
cryptography>=42.0.0
pandas>=2.2.0
faker>=25.0.0
```

Install them with:

```bash
pip install -r requirements.txt
```

### System requirement

This script also requires **OpenSSL** to be installed and available in your terminal.

Test it with:

```bash
openssl version
```

If OpenSSL is not recognized, add it to your system `PATH` or use its full executable path.

## Virtual environment setup

Create and activate a virtual environment before installing packages.

### Windows PowerShell

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### macOS / Linux

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## How to run the script

Basic usage:

```bash
python generate_dummy_certificates.py
```

Generate 20 certificates:

```bash
python generate_dummy_certificates.py --count 20
```

Example with a custom output folder:

```bash
python generate_dummy_certificates.py --count 20 --output-dir demo_certs
```

## How certificate expiration works

This is an important point.

### Actual generated certificate validity

The real `.crt` files are created with OpenSSL using:

```bash
-days N
```

That means the generated certificate:

- becomes valid when it is created
- stays valid for `N` days
- expires `N` days later

For example, if the script is run with:

```bash
python generate_dummy_certificates.py --days-valid 365
```

then each generated certificate is valid for **365 days from the creation date**.

### CSV expiration dates

The CSV currently includes expiration-related fields such as:

- `expiration_date`
- `days_to_expiry`
- `renewal_threshold_days`
- `status`

These values are used to simulate lifecycle scenarios for the PoC, such as:

- `active`
- `expiring_soon`
- `expired`
- `pending_renewal`
- `failed`
- `renewed`

This means:

- the real certificate file has a real OpenSSL validity period
- the CSV may simulate different statuses for testing workflow logic

This is useful in a PoC because it allows testing monitoring and renewal behavior without needing all certificates to really expire.

## Important note about date consistency

At the current stage of the project:

- the **actual certificate file dates** come from OpenSSL
- the **CSV lifecycle fields** are partially simulated for demo and testing purposes

So the certificate shown by OpenSSL may have a different expiration date from the one stored in the CSV. This is intentional for testing.

If needed later, the script can be improved so the CSV reads the actual `Not After` date directly from the generated certificate.

## CSV file explanation

The file:

`generated_certificates/certificate_inventory.csv`

contains one row per certificate.

### Main columns

- `certificate_id` — unique ID for each certificate
- `domain_name` — domain linked to the certificate
- `common_name` — certificate common name
- `issuer` — issuing authority name used in the simulated inventory
- `certificate_type` — DV, OV, EV, wildcard, or internal
- `environment` — production, staging, or dev
- `agency_name` — agency linked to the certificate
- `owning_team` — team responsible for the certificate
- `issue_date` — certificate issue date in the dataset
- `expiration_date` — expiration date used in the dataset
- `days_to_expiry` — days remaining before expiration
- `renewal_threshold_days` — threshold used to trigger renewal
- `status` — lifecycle state
- `auto_renew_enabled` — whether auto-renew is enabled
- `csr_required` — whether CSR generation is needed
- `last_renewal_date` — last renewal recorded in the dataset
- `deployment_status` — deployment state
- `validation_status` — validation result
- `serial_number` — serial number extracted from the generated certificate
- `fingerprint_sha256` — SHA-256 fingerprint extracted from the generated certificate
- `alert_sent` — whether an alert was sent
- `notes` — notes describing the current condition
- `certificate_path` — path to the `.crt` file
- `private_key_path` — path to the `.key` file

## Example workflow

A typical usage flow is:

1. generate dummy certificates
2. generate the CSV inventory
3. read the CSV file in Python or a dashboard
4. detect certificates that are close to expiration
5. simulate renewal actions or notifications
6. update statuses and validation results

## How to inspect a generated certificate

You can inspect a generated certificate with OpenSSL:

```bash
openssl x509 -in ./generated_certificates/certs/portal.agency02.ms.gov.crt -text -noout
```

This shows:

- subject
- issuer
- serial number
- validity dates
- public key details
- extensions

## Notes for the PoC

This setup is useful for demonstrating:

- certificate inventory management
- expiration monitoring
- threshold-based alerts
- renewal status tracking
- deployment and validation states
- automation workflow simulation

It is not intended for production use. The generated certificates are **dummy self-signed certificates for testing only**.

## Future improvements

Possible next improvements include:

- generating CSR files as part of the workflow
- reading real expiration dates from the generated certificates into the CSV
- adding renewal trigger logic
- creating a dashboard for certificate status monitoring
- integrating with AWS services for automation and alerts
