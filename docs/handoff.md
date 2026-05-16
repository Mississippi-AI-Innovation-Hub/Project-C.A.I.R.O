# Project handoff

**C.A.I.R.O** — Certificate Automated Intelligent Renewal Operations  
Mississippi AI Innovation Hub · PoC 2026

This document summarizes the repository for agency sponsors, Hub staff, and future maintainers.

---

## What this system does

Automated SSL/TLS certificate lifecycle management for Mississippi ITS / MDA: inventory, expiry monitoring, AI risk scoring (Amazon Bedrock), CSR generation, renewal pipeline, SNS alerts, and an operator dashboard with ITS deployment confirmation.

## How to run locally

See [setup.md](setup.md) and the root [README.md](../README.md).

1. `cp .env.example .env` — configure AWS, SNS, and Cognito as needed.
2. Backend: `python api_bridge.py` (port 5000).
3. Frontend: `npm install && npm run dev` (port 8081).

Without AWS credentials, the stack runs in simulated mode (rule-based AI scoring, local persistence fallbacks).

## Repository layout (high level)

| Area | Purpose |
|------|---------|
| `api_bridge.py` | Flask REST API |
| `renewal_agent.py` | 6-step renewal pipeline |
| `agents/agent_backend/` | Bedrock client, S3 helpers |
| `infra/` | DynamoDB store, IAM samples |
| `src/` | React dashboard (Vite + TypeScript) |
| `docs/` | Architecture, setup, testing, limitations |
| `generated_certificates/` | Synthetic demo inventory (keys/certs at runtime are gitignored) |

## Integrations

- **Amazon Bedrock** (Nova Lite) — certificate urgency / risk analysis
- **Amazon DynamoDB** — 5 tables (certs, notifications, jobs, settings, email log)
- **Amazon S3** — CSR, issued certs, PFX bundles
- **AWS SNS** — email alerts
- **AWS Cognito** — JWT auth with admin/operator RBAC

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` deploys the **frontend only**. The Flask API must be hosted separately for a live demo.

## Data and security

- All committed certificate data is **synthetic**.
- Never commit `.env`, `.env.local`, private keys (`.key`, `.pfx`), or runtime CSRs.
- See [data-notes.md](data-notes.md) and [limitations.md](limitations.md).

## PoC disclaimer

Not production-ready. See README and [limitations.md](limitations.md) for scope, gaps, and recommended next steps.

## Contributors

Nezha Amine, Cedric Roberson — Mississippi State University  
Faculty advisors: Shelly, Hollis
