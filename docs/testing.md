# Testing and Validation

## How the PoC was validated

All testing was performed in a local sandbox environment using synthetic data only.
No real agency systems, live certificates, or production infrastructure were used.

## Manual test scenarios covered

| Scenario | How to test | Expected result |
|----------|-------------|-----------------|
| Cert inventory loads | Start `api_bridge.py`, call `GET /api/certificates` | Returns 20 cert records |
| Status computation | Check certs with various `days_to_expiry` values | Correct status: expired / critical / expiring_soon / active |
| CSR generation | Call `POST /api/csr/generate` with a cert_id | `.csr` file written to `generated_certificates/csrs/` |
| 6-step pipeline | Call `GET /api/renew/jobs` after startup | All qualifying certs show completed pipeline steps |
| Live SSL check | Call `POST /api/ssl/check` with `hostname: "google.com"` | Returns live cert data |
| SNS simulated | Run without `SNS_TOPIC_ARN` set, trigger any alert | Response shows `provider: "simulated"` |
| Daily digest | Set `daily_time` to current UTC hour via Settings UI, wait 5 min | Email log shows digest entry |
| Critical banner | Visit dashboard with expired/critical certs present | Red banner visible at top of UI |
| Agent run-now | Click "Run Agent Now" in Overview section | Returns `jobs_processed` count |
| Failure simulation | Call `POST /api/simulate-failure` | Failure appears in Agent Activity section |

## Sample test command sequence

```bash
# 1. Start backend
python api_bridge.py

# 2. In a separate terminal, run quick smoke tests:
curl http://localhost:5000/api/health
curl http://localhost:5000/api/certificates/summary
curl http://localhost:5000/api/agent/status
curl http://localhost:5000/api/notifications/summary

# 3. Test CSR generation for CERT-006 (default test cert):
curl -X POST http://localhost:5000/api/csr/generate \
     -H "Content-Type: application/json" \
     -d '{"certificate_id": "CERT-006"}'

# 4. Verify CSR file was written:
ls generated_certificates/csrs/
```

## Validation results (PoC closeout — May 5, 2026)

| Metric | Target | Result |
|--------|--------|--------|
| Certificates auto-renewed | 15 test certs | 15/15 (100%) — zero missed renewals |
| AI analysis throughput | All certs analyzed | 20 certs in ~20 seconds via Amazon Bedrock Nova Lite |
| Audit log coverage | 100% of actions | 100% — every pipeline step logged to DynamoDB with timestamps |
| Fallback engine | Seamless Bedrock failover | Confirmed — renewals continued uninterrupted when Bedrock disabled |
| SNS email delivery | Alert on every renewal | Confirmed — daily digest, weekly report, and per-cert alerts all verified |
| Dashboard deployment confirmation | ITS confirms in UI | Confirmed — audit trail closes on ITS confirmation |
| DynamoDB persistence | Data survives restart | Confirmed — all 5 tables active and populated |
| S3 storage | CSR/PFX files stored | Confirmed — both S3 buckets accessible with objects synced |
