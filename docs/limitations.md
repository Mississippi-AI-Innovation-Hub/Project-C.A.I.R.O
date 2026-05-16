# Limitations and Disclaimer

## Disclaimer

This repository contains code and supporting materials developed as part of a Mississippi
Artificial Intelligence Innovation Hub Proof of Concept project. The contents are provided
for prototype demonstration purposes. They are **not production-ready** and include simplified
workflows, incomplete security guardrails, placeholder integrations, and reduced controls
appropriate only for a Proof-of-Concept environment.

**This code should not be used with production data or in production environments without
additional architecture, security, privacy, testing, and stakeholder review.**

## Known Limitations

### Security
- AWS Cognito authentication is implemented with JWT verification and admin/operator role-based access control (RBAC)
- SSO and MFA integration with the Mississippi state identity provider is planned for production
- Private keys are stored in Amazon S3 — production deployment requires AWS KMS or HSM-backed encryption per agency security policy
- All service-to-service authentication uses IAM roles — no hardcoded credentials in codebase

### Data Persistence
- DynamoDB is **active and wired** in this PoC (5 tables: certificates, notifications, email-log, agent-jobs, settings)
- S3 is **active** for CSR files, issued certs, and PFX bundles
- NOTIFICATION_SETTINGS in-memory fallback is used only if DynamoDB is unreachable

### Renewal Workflow
- CA submission (step 3) makes a real HTTP POST to Entrust when ENTRUST_USERNAME and ENTRUST_API_KEY are configured; falls back to internal CA automatically on any failure
- Certificate issuance (step 4) uses real signing — internal Mississippi ITS Root CA produces a trusted .crt and PFX bundle (PFX requires CA_PFX_PASSWORD to be set)
- Post-deployment validation (step 6) is a file-existence check only — live TLS probe not yet implemented
- CSR generation (step 2) uses real RSA-2048 / SHA-256 cryptography
- PFX bundle creation is implemented and stored in S3
- Step 5 (deployment) requires human ITS confirmation in the dashboard before the audit trail closes

### Monitoring
- The renewal agent runs at startup and on-demand only; no scheduled polling in production mode
- Live SSL checks work against real public hosts but rate-limiting is not implemented

### Frontend
- i18n (internationalization) is a stub — `t('key')` returns the key literally
- Bulk CSV certificate import is implemented as a UI prototype — the modal accepts a CSV file, parses it client-side, and submits each row individually to the backend. Full server-side validation, duplicate detection, and error recovery are planned for the next iteration.
- The "Import from CA (Entrust .CER)" tab was removed. In the automated C.A.I.R.O pipeline, certificates are renewed without manual CA file import. A future production version could re-add this tab with real PEM/DER file parsing for hybrid workflows.

### AWS
- Amazon Bedrock analysis requires credentials for `us-east-1`; falls back to rule-based logic
- S3 sync is best-effort and non-blocking; failures are logged as warnings
- SNS startup bulk alert is disabled by default (`startup_alerts_enabled: false`)

## Out of Scope (per PoC definition)

- Production deployment or any live agency environment
- Live Entrust CA API integration is implemented — production use requires ENTRUST_USERNAME and ENTRUST_API_KEY credentials in .env
- Public-facing access
- Certifications for federal or non-Mississippi state entities
- Multi-region deployment (us-east-1 only)
- SSO / MFA authentication
- KMS or HSM-backed private key encryption
- Autonomous behavior outside defined automation policies
