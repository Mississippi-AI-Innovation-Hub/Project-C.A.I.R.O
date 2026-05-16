# C.A.I.R.O — Project Closeout Documentation
*Mississippi AI Innovation Hub · Version 1.0 · May 2026*

## Project Information

| Field | Value |
|-------|-------|
| Project Title | C.A.I.R.O — Certificate Automated Intelligent Renewal Operations |
| Agency Partner | Mississippi Development Authority (MDA) / Mississippi ITS |
| Student Team | Nezha Amine, Cedric Roberson — Mississippi State University |
| Hub Project | CSR Certificate Renewal Automation |
| Faculty Advisors | Shelly, Hollis |
| Project Start | March 5, 2026 |
| Project End | May 5, 2026 |
| Closeout Date | May 11, 2026 |
| Demo Date | May 5, 2026 |

## Executive Summary

This Proof of Concept explored whether an AI-enabled approach could help the Mississippi
Development Authority address the issue of missing certificate renewals — a risk that grows
as the renewal lifecycle shortens to 47 days by 2028. The team developed and demonstrated
C.A.I.R.O, a fully automated certificate lifecycle management system with AI risk analysis
and an email notification pipeline. The PoC successfully demonstrated that SSL/TLS certificates
can be renewed and scanned for issues automatically with little to no human intervention.
Results indicate strong feasibility for future continuation.

## Scope Completed

- Centralized certificate inventory in DynamoDB (20 certs, 8 agencies)
- Daily monitoring script with configurable expiration thresholds
- Automated renewal pipeline: detection → RSA-2048 CSR → CA submission (simulated Entrust) → issuance → PFX bundle
- Amazon Bedrock AI integration (Nova Lite) — urgency scores and risk assessments for all certs
- Rule-based fallback engine for when Bedrock is unavailable
- SNS email alerting on every renewal event
- S3 storage for CSR files, private keys, issued certs, and PFX bundles
- Real-time dashboard: certificate status, alerts, agent activity, audit log
- ITS deployment confirmation workflow closing the audit trail automatically
- End-to-end testing: 15/15 certificates renewed, 0 missed renewals

## Scope Not Completed

| Item | Level | Reason |
|------|-------|--------|
| Live Entrust CA API | Partial | Requires production Entrust credentials and agency approval outside PoC scope |
| Multi-region deployment | Not completed | All services in us-east-1; multi-region is a production readiness concern |

## Out of Scope Boundaries Maintained

- No production deployment or production data operations
- No autonomous binding agency decisions — all deployments required ITS confirmation
- No public launch or unsupported external access
- No integrations beyond the approved AWS service stack

## Testing Results

| Metric | Target | Result |
|--------|--------|--------|
| Certificates auto-renewed | 15 test certs | 15/15 (100%) |
| Missed renewals | 0 | 0 |
| Bedrock analysis throughput | All certs | 20 certs in ~20 seconds |
| Audit log coverage | 100% | 100% — every action logged |
| Fallback engine | Seamless | Confirmed — renewals uninterrupted when Bedrock disabled |
| SNS delivery | All renewals | Confirmed — daily digest, weekly report, per-cert alerts verified |

## Known Issues and Limitations

- CA submission (step 3): Real HTTP POST to Entrust cloud CA when ENTRUST_USERNAME + ENTRUST_API_KEY are configured. Falls back to internal Mississippi ITS Root CA automatically. Production use requires Entrust account credentials.
- Single-region deployment: us-east-1 only; regional outage would halt monitoring
- Dashboard authentication: Cognito JWT + admin/operator RBAC implemented; state SSO/MFA integration planned for production
- Private key storage: RSA-2048 keys in S3; production requires KMS or HSM
- Certificate scope: optimized for IIS/Windows; Linux/Apache requires additional CSR templates

## Production Readiness Disclaimer

This project was completed as a Proof of Concept within a limited project period and
controlled development context. The resulting code, workflows, documentation, and artifacts
are intended to demonstrate feasibility. The solutions are not production ready by default
and should not be interpreted as a security hardened, policy approved, and operationally
supported implementation.

## Recommended Next Steps

| Next Step | Why Needed | Priority |
|-----------|-----------|---------|
| Integrate live Entrust CA API | Required before any production cert can be issued | High |
| Cybersecurity and privacy review | Private key handling, IAM scope, data classification | High |
| SSO and RBAC for dashboard | Production requires MFA and state identity provider integration | High |
| Expand inventory to all 8 agencies | PoC used representative test data only | Medium |
| KMS/HSM-backed private key storage | S3 storage insufficient for production per agency security policy | Medium |
| Multi-region failover architecture | Single us-east-1 region is a resilience risk | Medium |
| User acceptance testing with ITS admins | Validate dashboard workflow before broader pilot | Medium |
| Linux/Apache CSR template support | Current agent is IIS-optimized only | Low |
