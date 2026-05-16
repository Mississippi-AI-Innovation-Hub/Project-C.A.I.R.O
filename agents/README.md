# Agents

AI agent components for C.A.I.R.O.

## agent_backend/

Amazon Bedrock integration and supporting agent utilities.

| File | Purpose |
|------|---------|
| `bedrock_client.py` | Calls Amazon Bedrock (Nova Lite) to analyze each certificate — returns urgency score (0–100), risk level, recommended action, and consequences of inaction |
| `cert_actions.py` | Certificate action helpers used by the agent pipeline |
| `s3_helper.py` | Uploads certificate inventory and renewal job data to S3 after each pipeline run |
| `lambda_function.py` | Lambda handler stub — packages the renewal agent for future EventBridge-triggered deployment |
| `generate_dummy_certificates_agent.py` | Agent-side certificate generation utility |

Bedrock falls back to a rule-based scoring engine automatically when
credentials are unavailable or the API call fails. The fallback produces
the same output format so the rest of the pipeline is unaffected.

## Entry point note

`renewal_agent.py` lives at the project root, not here. It uses
root-relative file paths to write CSR and key output to
`generated_certificates/` and must stay at the project root.
`api_bridge.py` imports it directly at startup.

## Agent boundaries (PoC)

- Agents operate only on synthetic certificate data
- CA submission (step 3) makes a real HTTP POST to Entrust when credentials are configured; falls back to internal CA automatically
- Certificate issuance (step 4) uses real signing via the internal Mississippi ITS Root CA
- Post-deployment validation (step 6) is a file-existence check — live TLS probe planned for production
- All agent actions are logged to DynamoDB with timestamps
- See `policies/automation-policies.md` for full policy constraints
