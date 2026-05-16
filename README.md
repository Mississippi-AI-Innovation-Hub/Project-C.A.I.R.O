# C.A.I.R.O
## Certificate Automated Intelligent Renewal Operations
**Mississippi AI Innovation Hub · Mississippi ITS / MDA · PoC 2026**

> **Disclaimer:** This repository contains code developed as part of a Mississippi
> Artificial Intelligence Innovation Hub Proof of Concept. The contents are for
> prototype demonstration purposes only and are not production-ready. Do not use
> with production data or in production environments without additional architecture,
> security, privacy, testing, and stakeholder review.

---

## Overview

C.A.I.R.O is an AI-powered agentic workflow system built for the Mississippi
Department of Information Technology Services (ITS) and Mississippi Development
Authority (MDA). It automates the full SSL/TLS certificate lifecycle — from
expiration detection through AI risk scoring, automated CSR generation,
certificate issuance, PFX bundling, and ITS deployment confirmation —
eliminating the previously manual, email-driven renewal process.

State agency websites currently require SSL/TLS certificates renewed approximately
every 47 days by 2028. Manual tracking via email and spreadsheets creates serious
risk of missed renewals, website outages, and public-facing security warnings.
C.A.I.R.O eliminates that risk through end-to-end automation with a single human
checkpoint: ITS confirms deployment before the audit trail closes.

## Agency Problem

Mississippi state agency websites rely on SSL/TLS certificates that must be
renewed regularly. The renewal timeline is contracting to approximately 47 days
by 2028. The current process — tracked through emails and spreadsheets across
multiple teams — creates compounding risk: missed renewals cause website outages
and public-facing security warnings that erode citizen trust in state services.

## PoC Scope and Demonstrated Capabilities

| Capability | Result |
|------------|--------|
| Automated certificate monitoring (20 certs, 8 agencies) | ✅ Demonstrated |
| Amazon Bedrock (Nova Lite) AI urgency scoring (0–100) + risk levels | ✅ 20 certs in ~20 seconds |
| Automated CSR generation (RSA-2048 / SHA-256) | ✅ Real cryptography |
| Simulated Entrust CA submission + PFX bundle creation | ✅ Demonstrated |
| 15/15 certificates auto-renewed, 0 missed renewals | ✅ Demonstrated |
| SNS email alerts (per-cert, daily digest, weekly report) | ✅ Live delivery confirmed |
| Rule-based fallback engine when Bedrock unavailable | ✅ Explicitly tested |
| Real-time dashboard — 5 sections + deployment confirmation | ✅ Demonstrated |
| AWS Cognito authentication with JWT + admin/operator RBAC | ✅ Implemented |
| DynamoDB persistence (5 tables: certs, notifications, jobs, settings, email log) | ✅ Active |
| S3 storage for CSR files, issued certs, and PFX bundles | ✅ Active |
| Bulk CSV certificate import via dashboard | ✅ Implemented |
| ITS deployment confirmation closing the audit trail | ✅ Demonstrated |

### What is real vs simulated

| Pipeline step | Status | Detail |
|---------------|--------|--------|
| Detect + AI scoring | ✅ Real | Live Bedrock analysis; rule-based fallback when unavailable |
| CSR generation (step 2) | ✅ Real crypto | RSA-2048 key + SHA-256 CSR written to disk and synced to S3 |
| CA submission (step 3) | ✅ Implemented | Real HTTP POST to Entrust cloud CA when ENTRUST_USERNAME + ENTRUST_API_KEY are set. Falls back to internal Mississippi ITS Root CA automatically on any failure or when credentials are absent. |
| Certificate issuance (step 4) | ✅ Real signing | Internal Mississippi ITS Root CA signs the CSR; real .crt and PFX bundle produced |
| Deployment notification (step 5) | ✅ Real | SNS email with import checklist sent to ITS; IIS and FortiManager steps are a human checklist |
| Post-deploy validation (step 6) | 🔲 Light check | File existence confirmed; live TLS probe against the deployed site not implemented |
| ITS deployment confirmation | ✅ Real | Admin confirms in dashboard; DynamoDB audit trail closes |
| AWS SNS alerts | ✅ Real | Live email delivery when SNS_TOPIC_ARN is configured |
| DynamoDB persistence | ✅ Real | 5 active tables; data survives restarts |
| S3 file storage | ✅ Real | CSR, issued cert, PFX bundles synced to both buckets |
| Cognito auth + RBAC | ✅ Real | JWT verification, admin/operator roles enforced on backend |
| Bedrock AI analysis | ✅ Real | Nova Lite model; urgency scores 0–100 with risk levels |

The main gaps before production use are: automated FortiManager/IIS
push (currently a human checklist), real post-deploy TLS validation
(step 6), KMS encryption for private keys, and enterprise SSO/MFA.

**Out of scope (PoC boundaries maintained):**
- No production deployment or real agency certificate data
- Entrust CA API implemented — production use requires ENTRUST_USERNAME and ENTRUST_API_KEY in .env
- No enterprise SSO or state identity provider MFA integration
- Single region only (us-east-1)
- No AWS KMS encryption for private keys (S3 storage only in PoC)

## Architecture Overview

```
Browser (port 8081)
  React 18 + TypeScript + Vite
  Cognito JWT → Authorization: Bearer
        ↕  HTTP / CORS
Flask REST API — api_bridge.py (port 5000)
  Cognito JWT verification + admin/operator RBAC
        │
        ├── RenewalAgent — renewal_agent.py
        │     Real RSA-2048 CSR → local disk → S3 sync
        │
        ├── AWS SNS ——————— email alerts
        ├── Amazon Bedrock — AI urgency scoring (Nova Lite)
        ├── Amazon S3 ———— CSR / issued certs / PFX bundles
        └── AWS DynamoDB — 5 tables (certs, notifications,
                           agent-jobs, settings, email-log)
```

Certificate inventory loads at startup: CSV first
(generated_certificates/certificate_inventory.csv), then
DynamoDB-persisted records merged in. Certificates added via
the dashboard are saved to DynamoDB and reload on restart.

See [docs/architecture.md](docs/architecture.md) for the full
architecture description including the 6-step pipeline and
renewal output storage.

## Repository Structure

```
C.A.I.R.O/
│
├── api_bridge.py                Flask REST API entry point (port 5000)
├── renewal_agent.py             6-step certificate renewal pipeline
├── generate_dummy_certificates.py  Synthetic cert + CSV inventory generator
│
├── agents/                      AI agent components
│   └── agent_backend/           Amazon Bedrock client, S3 helper,
│       bedrock_client.py        cert actions, Lambda function
│       cert_actions.py
│       s3_helper.py
│       lambda_function.py
│
├── tools/                       Certificate utility modules
│   ├── ssl_checker/             Live TLS certificate checker
│   ├── local_cert_checker.py    CLI checker — DynamoDB-ready JSON output
│   └── entrust_config.py        CA configuration stub
│
├── workflows/                   Pipeline documentation
├── policies/                    Automation policy constraints
│
├── infra/                       AWS infrastructure
│   ├── iam/                     IAM policies for SNS, S3, Bedrock, DynamoDB
│   └── dynamodb_store.py        DynamoDB persistence layer (active)
│
├── data/synthetic/              Reference copy of synthetic certificate inventory
├── tests/                       Planned automated test suite
├── docs/                        Project documentation
│   ├── architecture.md          System architecture + 6-step pipeline
│   ├── setup.md                 Installation and run instructions
│   ├── data-notes.md            Synthetic data description + live AWS stores
│   ├── limitations.md           Known limitations and disclaimer
│   ├── testing.md               Test scenarios and PoC closeout results
│   ├── auth-notes.md            Cognito JWT + RBAC implementation details
│   └── CLOSEOUT.md              Project closeout documentation
│
├── src/                         React 18 + TypeScript frontend (port 8081)
│   └── components/sections/     5 dashboard sections
│       ├── OverviewDashboard    Stat cards, AI risk panel, agent status
│       ├── SecurityView         Certificate table, Add/bulk import, live check
│       ├── AlertsView           Notifications, bulk email, mark-read
│       ├── AgentActivityView    Pipeline visualization, CSR file viewer
│       └── SettingsView         SNS config, recipients, email log, DynamoDB status
│
└── generated_certificates/      Runtime output (synthetic data for PoC)
    ├── certificate_inventory.csv  Primary inventory — loaded at startup
    ├── certs/*.crt               Self-signed dummy certificates
    ├── keys/                     Private keys (gitignored)
    ├── csrs/                     Generated CSR files (gitignored)
    └── issued_certs/             Issued certs + PFX bundles → synced to S3
```

## Setup

See [docs/setup.md](docs/setup.md) for complete installation instructions.

**Quick start:**
```bash
# 1. Clone and configure
git clone <repository-url>
cd <repository-folder>
cp .env.example .env
# Edit .env — add AWS credentials, SNS Topic ARN, Cognito config

# 2. Backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python generate_dummy_certificates.py --count 20   # first time only
python api_bridge.py                               # → http://localhost:5000

# 3. Frontend (new terminal)
npm install
npm run dev                                        # → http://localhost:8081

# 4. Open http://localhost:8081 and log in
# Roles are assigned via Cognito groups — not hardcoded:
# - Add a user to the "admin" Cognito group → gets admin role
# - Users not in "admin" group → get operator role (read-only)
# Create groups and assign users in AWS Console → Cognito →
# User Pools → your pool → Groups
# See docs/auth-notes.md for full setup instructions.
#
# Local dev without Cognito configured: all requests
# automatically get admin role (dev fallback mode)
```

### First run behavior

When api_bridge.py starts for the first time it automatically:
- Generates the Mississippi ITS Root CA certificate and key
  in generated_certificates/ca/ (gitignored)
- Processes all expiring/expired certificates through the
  renewal pipeline — expect 20-30 seconds of activity in
  the logs on startup, this is normal
- Sends a startup SNS alert if SNS_TOPIC_ARN is configured
  and startup_alerts_enabled is true in settings

The frontend and backend must both be running simultaneously.
Open two terminals — one for api_bridge.py, one for npm run dev.

## Configuration

Copy `.env.example` to `.env` and fill in your values.

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_ACCESS_KEY_ID` | For AWS features | SNS, Bedrock, DynamoDB, S3 |
| `AWS_SECRET_ACCESS_KEY` | For AWS features | SNS, Bedrock, DynamoDB, S3 |
| `AWS_REGION` | For AWS features | Default: `us-east-1` |
| `SNS_TOPIC_ARN` | For email alerts | Certificate lifecycle alerts |
| `COGNITO_USER_POOL_ID` | For real auth | Falls back to allow-all if empty |
| `COGNITO_APP_CLIENT_ID` | For real auth | Required with User Pool ID |
| `CA_PFX_PASSWORD` | For PFX export | Set to enable PKCS#12 PFX bundle generation after cert issuance. Required for IIS import by ITS. Store the password in Keeper. |
| `ENTRUST_USERNAME` | For Entrust CA | Real Entrust cloud CA submission in step 3. Falls back to internal CA if not set. |
| `ENTRUST_API_KEY` | For Entrust CA | Required with `ENTRUST_USERNAME` |

### Running without AWS credentials

The system runs fully in simulated mode with no AWS account:
- Bedrock → rule-based urgency scoring
- DynamoDB → in-memory only (data lost on restart)
- S3 → sync skipped silently
- SNS → alerts logged locally, no emails sent
- Cognito → auth disabled, every user gets admin role

All five dashboard sections remain functional in simulated mode.
This is the correct mode for local development and demos
without AWS access.

### Internal Certificate Authority

On first startup, C.A.I.R.O generates a self-signed root CA:
  generated_certificates/ca/mississippi_its_ca.crt
  generated_certificates/ca/mississippi_its_ca.key  (gitignored)

Certificates issued by the renewal pipeline are signed by this
internal CA. For ITS to trust these certs in a browser or IIS:
1. Export mississippi_its_ca.crt
2. Install it in Windows → Trusted Root Certification Authorities
3. Import the PFX bundle into IIS as usual

In production, this internal CA would be replaced by real
Entrust issuance once ENTRUST_USERNAME and ENTRUST_API_KEY
are configured.

Frontend variables go in `.env.local` (gitignored — see `.env.example`).

## Adding Certificates

The dashboard provides three ways to add certificates:

**Live Domain** — for public-facing websites. Enter a hostname and the
system performs a live TLS check to automatically populate issuer,
expiration date, and days remaining. The port you enter is used for
both the connection test and the backend save.

**Manual / Internal Domain** — for internal or private domains not
reachable externally. Enter all metadata by hand. No network call is made.

**Bulk Import (CSV)** — upload a CSV file to add multiple certificates
at once. Required columns: `domain_name`, `agency_name`, `expiration_date`.
Optional: `environment`, `certificate_type`, `issuer`, `owning_team`, `notes`.
A CSV template is available for download inside the modal.

## Data Notes

All data in this repository is synthetic. No real agency certificates,
private keys, or operational data are included.

The `generated_certificates/` folder contains 20 self-signed dummy
certificates generated by `generate_dummy_certificates.py`. These are
required for the PoC to start — the system loads this inventory at startup.

In production, this CSV-based bootstrap would be replaced by a live
DynamoDB scan connected to real certificate sources.

See [docs/data-notes.md](docs/data-notes.md) for the full data description
including the active DynamoDB tables and S3 buckets.

## Usage

After starting both the backend and frontend:

1. Open `http://localhost:8081` — you will be redirected to the login page
2. Sign in with your Cognito credentials (admin or operator role)
3. **Overview** — stat cards, AI risk intelligence panel, renewal agent status
4. **Certificates** — full inventory table, live SSL check, add/bulk import
5. **Alerts** — certificate lifecycle notifications, bulk email, mark-read
6. **Agent Activity** — per-cert pipeline visualization, CSR file viewer
7. **Settings** — SNS configuration, notification recipients, email audit log,
   DynamoDB table status, S3 sync

### Step 5 — deployment explained

After the renewal pipeline runs, ITS receives an SNS email with
an import checklist. The manual steps ITS performs are:
1. Download the PFX bundle from generated_certificates/issued_certs/
   or from the S3 bucket certificate-data-processed1
2. Import the PFX into IIS on MDAWEB19 using the PFX password
3. Update the website binding in IIS to use the new certificate
4. Update FortiManager with the new PFX for external access
   (FortiManager controls the Fortinet firewall/load balancer
   that terminates SSL for external traffic)
5. Click Confirm Deploy in the C.A.I.R.O dashboard

Step 5 is the only required human action in the pipeline.
The dashboard audit trail closes when ITS confirms.

To trigger a manual agent run: Overview → **Run Agent Now**

To confirm a deployment: Certificates table → **Confirm Deploy** on any
`Pending Deploy` certificate (admin only)

## Testing and Evaluation

See [docs/testing.md](docs/testing.md) for manual test scenarios and
full PoC closeout results.

**Summary results (May 5, 2026):**
- 15/15 certificates auto-renewed — 0 missed renewals
- 20 certificates analyzed by Bedrock in ~20 seconds
- 100% of pipeline actions logged to DynamoDB
- Fallback rule engine confirmed when Bedrock disabled
- All SNS alert types confirmed (per-cert, daily digest, weekly report)
- All 5 DynamoDB tables confirmed connected and persistent
- Both S3 buckets confirmed accessible with synced objects

## Limitations

See [docs/limitations.md](docs/limitations.md) for the full list.

Key limitations for this PoC:
- Entrust CA submission is simulated — production requires real API credentials
- Private keys stored in S3 only — production requires AWS KMS encryption
- Enterprise SSO and state identity provider MFA not integrated
- Single region (us-east-1) — no multi-region failover
- Audit/compliance report export is UI-only — backend export endpoint planned
- Bulk CSV import performs client-side validation only — no server-side
  deduplication or schema enforcement

## Disclaimer

This project was completed as a Proof of Concept within a limited project
period and controlled development context. The resulting code, workflows,
documentation, and artifacts are intended to demonstrate feasibility. The
solutions are not production ready by default and should not be interpreted
as a security hardened, policy approved, and operationally supported
implementation.

## License

MIT License — see [LICENSE](LICENSE)

## Contributors

- **Nezha Amine** — Cloud & Automation Engineering, Mississippi State University
- **Cedric Roberson** — AI Systems & Data Processing, Mississippi State University

*Faculty advisors: Shelly, Hollis*
*Mississippi AI Innovation Hub · Mississippi ITS / MDA*
*Project period: March 5 – May 5, 2026 · Demo: May 5, 2026 · Closeout: May 11, 2026*
