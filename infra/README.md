# Infrastructure

AWS infrastructure configuration for C.A.I.R.O.

## dynamodb_store.py

Active DynamoDB persistence layer. Wired into `api_bridge.py` for
reads on startup and writes after every certificate add or update.

**Tables (all active in PoC, us-east-1):**

| Table | Partition key | Purpose |
|-------|-------------|---------|
| `cert-lifecycle-certificates` | `certificate_id` | Certificate inventory |
| `cert-lifecycle-notifications` | `id` | Alert history |
| `cert-lifecycle-email-log` | `id` | Email audit trail |
| `cert-lifecycle-agent-jobs` | `certificate_id` | Pipeline job state |
| `cert-lifecycle-settings` | `setting_key` | Notification preferences |

**Startup merge behavior:**
1. CSV inventory loads first (always)
2. DynamoDB scans for records where `date_mode IN [manual, imported, live]`
3. Any DynamoDB record whose `certificate_id` is not already in the CSV
   list is appended to the in-memory cache
4. If DynamoDB is unreachable, only the CSV inventory loads (graceful fallback)

**Why `date_mode` matters:** Certificates added via the Live Domain tab
are stored with `date_mode: live` so they are included in the DynamoDB
reload on restart. Certificates in the CSV use `date_mode: simulated`.

## iam/

IAM policy definitions for the AWS services used by C.A.I.R.O.
Covers least-privilege permissions for:
- SNS: publish to the certificate alerts topic
- S3: read/write to both certificate data buckets
- Bedrock: invoke the Nova Lite model
- DynamoDB: read/write to all five tables

## S3 buckets (active)

| Bucket | Contents |
|--------|----------|
| `mock-certificate-data` | Certificate inventory sync |
| `certificate-data-processed1` | CSR files, issued certs, PFX bundles |

Files are written to local disk first (`generated_certificates/`),
then synced to S3 via a background thread in `agents/agent_backend/s3_helper.py`.

**Next phase:** In production, the local write step would be eliminated.
The renewal agent would write directly to S3 using the AWS SDK, with
private keys encrypted at rest using AWS KMS. ITS would retrieve PFX
bundles via pre-signed URLs rather than from local disk.
