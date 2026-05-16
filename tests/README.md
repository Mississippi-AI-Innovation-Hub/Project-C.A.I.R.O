# Tests

Automated test suite — planned for the next development phase.

## Current state

This PoC was validated manually. See `docs/testing.md` for the
complete test scenario table and PoC closeout results (May 5, 2026).

**Key results:**
- 15/15 certificates auto-renewed, 0 missed
- 20 Bedrock AI analyses in ~20 seconds
- 100% of actions logged to DynamoDB
- Fallback rule engine confirmed
- All SNS alert types delivered

## Manual smoke test

```bash
# Start the backend
python api_bridge.py &

# Basic health checks
curl http://localhost:5000/api/health
curl http://localhost:5000/api/certificates/summary
curl http://localhost:5000/api/notifications/summary
curl http://localhost:5000/api/agent/status

# Authenticated endpoint (requires Bearer token from Cognito)
curl http://localhost:5000/api/certificates \
  -H "Authorization: Bearer <your-token>"

# Test CSR generation (admin token required)
curl -X POST http://localhost:5000/api/csr/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"certificate_id": "CERT-006"}'
```

## Planned test coverage

| Area | Tests needed |
|------|--------------|
| Unit | `compute_status()` status ladder logic |
| Unit | `parse_cert_file()` PEM parsing edge cases |
| Unit | `db_load_manual_certs()` date_mode filter behavior |
| Integration | All REST endpoints via Flask test client |
| Integration | Cognito JWT verification + 401/403 responses |
| End-to-end | Inventory load → agent run → CSR file written |
| End-to-end | Bulk CSV import → DynamoDB persist → reload on restart |
