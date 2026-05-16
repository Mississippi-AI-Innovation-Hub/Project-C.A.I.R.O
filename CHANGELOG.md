# Changelog

All notable changes to this project are documented here.

## [1.0.0] — 2026-04-29 (PoC Final Release)

### Added
- Full certificate inventory system with 20-cert dummy dataset covering all lifecycle states
- Flask REST API (`api_bridge.py`) with 30+ endpoints for certificate management
- React + Vite frontend with 5 dashboard sections (Overview, Certificates, Alerts, Agent Activity, Settings)
- AI Renewal Agent with 6-step pipeline: detect → CSR generation → CA submission → issuance → deployment → validation
- Real RSA-2048 / SHA-256 CSR generation via Python `cryptography` library
- AWS SNS integration for email alerts (startup alerts, daily digest, per-cert, bulk)
- Amazon Bedrock (Nova Lite) AI risk analysis with rule-based fallback
- Weekly automated report generation and delivery
- Live TLS/SSL certificate checker against real public hosts
- Pipeline failure simulation and resolution workflow
- Internal Mississippi ITS Root CA (Entrust stand-in for PoC)
- S3 sync for inventory and renewal job data
- DynamoDB-compatible flat record schema (ready for persistence migration)
- Mobile-responsive UI with shadcn/ui component library

### Architecture
- Backend: Python 3 / Flask (port 5000)
- Frontend: React 18 / TypeScript / Vite (port 8081)
- Cloud: AWS SNS, Amazon Bedrock, S3
- Auth: AWS Cognito JWT + admin/operator RBAC implemented

### Known Limitations (PoC scope)
- DynamoDB: 5 tables active (certs, notifications, agent-jobs, settings, email-log)
- CA submission (step 3): real HTTP POST to Entrust when credentials configured; internal CA fallback otherwise
- Certificate issuance (step 4): real signing via internal Mississippi ITS Root CA; PFX bundle created when CA_PFX_PASSWORD is set
- Deployment (step 5): real SNS email with import checklist; IIS and FortiManager steps are manual ITS actions
- Post-deployment validation (step 6): file-existence check only; live TLS probe planned for production
- AWS credentials must be rotated before any production use
