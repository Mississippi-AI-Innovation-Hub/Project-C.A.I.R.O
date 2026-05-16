# Automation Policies

Policy constraints governing automated agent behavior in C.A.I.R.O.
These policies satisfy the PoC requirement for policy-constrained agents.

## Automated — no human approval required

| Action | Trigger | Component |
|--------|---------|-----------|
| Detect expiring certificate | days_to_expiry ≤ renewal_threshold | RenewalAgent |
| Generate CSR (RSA-2048) | status: expired / critical / expiring_soon | RenewalAgent |
| Sync output files to S3 | After each pipeline run | s3_helper |
| Send per-cert SNS alert | status change to critical or expired | api_bridge |
| Send daily digest | Scheduled UTC time (configurable) | Digest thread |
| Send weekly report | Every 7 days | Report thread |
| Run AI risk analysis | On cert load and new cert add | bedrock_client |
| Mark notification read | User action via dashboard | api_bridge |
| Run live SSL check | On-demand via dashboard or cert add | ssl_checker |

## Requires human confirmation (admin role)

| Action | Endpoint |
|--------|----------|
| Confirm certificate deployment (IIS import) | POST /api/certificates/<cert_id>/confirm-deploy |
| Confirm all pending deployments at once | POST /api/certificates/confirm-deploy-all |
| Resolve a flagged pipeline failure | POST /api/agent/failures/<failure_id>/resolve |
| Trigger manual agent scan | POST /api/agent/run-now |
| Send bulk SNS alert | POST /api/notify/bulk |
| Generate manual CSR | POST /api/csr/generate |

## Hard boundaries — agents never

- Contact any real Certificate Authority without human-configured credentials
- Modify firewall rules, DNS records, or load balancer configuration
- Store or transmit private keys to systems other than the configured S3 bucket
- Act on certificates outside the managed inventory
- Mark a certificate deployment complete without ITS confirmation

## Escalation policy

On pipeline failure:
1. Record failure in `AGENT_FAILURES` with timestamp and step name
2. Send SNS alert to all configured recipients immediately
3. Pause automation for that specific certificate
4. Await manual operator resolution via dashboard before retrying

## Access control (RBAC)

| Role | Can do |
|------|--------|
| Admin | All actions including confirm-deploy, agent run, bulk notify, CSR generate |
| Operator | Read-only — view certs, alerts, pipeline status; cannot trigger mutations |
| Unauthenticated | /api/health, /api/aws/sns/config, /api/ssl/check only |
