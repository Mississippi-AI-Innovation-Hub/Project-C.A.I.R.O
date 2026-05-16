# Tools

Certificate utility modules used by the Flask API and renewal agent.

## ssl_checker/

Live TLS/SSL certificate checker.

- `ssl_checker_simple.py` — Connects to a host over TLS and extracts
  certificate metadata: expiry date, issuer, SANs, fingerprint, days
  remaining. Called by `POST /api/ssl/check` in the Flask API and by
  the Live Domain tab when adding certificates.
- `certificate_monitor.py` — PostgreSQL-based monitor from the original
  template. Not active in this PoC.

Note: this folder was previously named `ssl checker python/` (with a
space). Renamed to `tools/ssl_checker/` to fix import reliability and
bash compatibility.

## local_cert_checker.py

Standalone CLI tool for checking certificates from the local inventory.
Outputs DynamoDB-compatible JSON. Two modes:

- `--mode simulated` (default) — uses CSV expiration dates to exercise
  all lifecycle states (expired, critical, expiring_soon, active)
- `--mode real` — uses actual `.crt` file validity dates

```bash
python tools/local_cert_checker.py
python tools/local_cert_checker.py --mode real --cert-id CERT-006
python tools/local_cert_checker.py --filter-status expired --output results.json
```

## entrust_config.py

Configuration stub for the Entrust Certificate Authority API. In the PoC,
the internal Mississippi ITS Root CA acts as the Entrust stand-in. A
production integration would replace the stub values here with real
Entrust API credentials and endpoint configuration.
