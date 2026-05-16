# Workflows

Documents the automated certificate lifecycle orchestrated by C.A.I.R.O.

## Entry point

```bash
python api_bridge.py   # starts Flask on http://localhost:5000
```

`api_bridge.py` stays at the project root because it uses root-relative
paths for all certificate file operations.

## C.A.I.R.O 6-Step Pipeline

Each certificate that is `expired`, `critical`, or `expiring_soon`
is processed automatically through:

```
Step 1 — detect
  Record trigger reason, days_to_expiry, AI urgency score from Bedrock

Step 2 — csr_generation
  Generate real RSA-2048 / SHA-256 CSR + private key
  Write to generated_certificates/csrs/ and keys/
  Sync to S3 (background thread)

Step 3 — ca_submission
  POST CSR to Entrust cloud CA (real HTTP when credentials set)
  Entrust credentials: ENTRUST_USERNAME + ENTRUST_API_KEY in .env
  On 200/201: returns Entrust tracking ID and thumbprint
  On 4xx/5xx/timeout/no credentials: logs error and continues
  Step 4 always runs regardless of Entrust result

Step 4 — cert_issuance
  Receive issued certificate + create PFX bundle  [SIMULATED in PoC]
  Write to generated_certificates/issued_certs/
  Sync to S3 (background thread)

Step 5 — deployment
  Email ITS with PFX import checklist via AWS SNS
  ITS imports PFX into IIS on MDAWEB19
  ITS confirms in dashboard  ← only required human action

Step 6 — validation
  Post-deployment check  [SIMULATED in PoC]
  Audit trail closes on ITS confirmation in dashboard
```

Steps 1 and 2 use **real cryptography**.
Step 5 is **half-automated** — SNS sends a real email with the
import checklist; ITS manually imports into IIS and FortiManager.

**Step 3:** Real HTTP POST to Entrust when credentials are
configured; falls back to internal CA automatically.
**Step 4:** Real signing — internal Mississippi ITS Root CA
or Entrust-issued cert depending on step 3 outcome.
**Step 6:** File-existence check only — live TLS probe
against the deployed site is not yet implemented.

## Background threads (auto-start at boot)

| Thread | Interval | Purpose |
|--------|----------|---------|
| Daily digest loop | Checks every 5 min | Sends SNS digest at configured UTC time |
| Weekly report loop | Checks every hour | Sends full report every 7 days |

## Human approval checkpoint

Certificates move to `pending_deployment` after the pipeline runs.
ITS must confirm in the dashboard:

```
POST /api/certificates/<cert_id>/confirm-deploy   (single cert)
POST /api/certificates/confirm-deploy-all          (all pending)
```

Both endpoints require admin role.

## Exception handling

```bash
# Inject a simulated pipeline failure (for demo):
POST /api/simulate-failure

# Resolve a failure:
POST /api/agent/failures/<failure_id>/resolve
```

All failures fire an SNS alert immediately and pause automation
for that certificate until manually resolved.
