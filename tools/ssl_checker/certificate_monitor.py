#!/usr/bin/env python3
"""
Certificate Monitor (file-based, no database)
=============================================
Loads the local certificate inventory via renewal_agent helpers,
checks each hostname against the SSL API, and triggers the renewal
agent for expired / critical certificates.

No PostgreSQL, no psycopg2.  All state is held in memory and optionally
written to a JSON file for diagnostics.

Usage:
    python certificate_monitor.py
"""

import os
import time
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Any

import requests
import structlog
from dotenv import load_dotenv

load_dotenv(override=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class MonitorConfig:
    check_interval_minutes: int = 60
    api_base_url: str = "http://localhost:5000/api/ssl"
    batch_size: int = 50
    timeout_seconds: int = 30


def load_config() -> MonitorConfig:
    return MonitorConfig(
        check_interval_minutes=int(os.getenv('MONITOR_CHECK_INTERVAL', 60)),
        api_base_url=os.getenv('SSL_API_BASE_URL', 'http://localhost:5000/api/ssl'),
        batch_size=int(os.getenv('MONITOR_BATCH_SIZE', 50)),
        timeout_seconds=int(os.getenv('MONITOR_TIMEOUT', 30)),
    )


# ---------------------------------------------------------------------------
# Monitor
# ---------------------------------------------------------------------------

class CertificateMonitor:
    """
    Background certificate monitor — no database required.

    On each cycle it:
      1. Loads all certificates from the local inventory (via renewal_agent helpers).
      2. Calls the SSL check API for each hostname.
      3. Triggers the renewal agent for any cert whose status is
         'expired' or 'critical'.
    """

    def __init__(self, monitor_config: MonitorConfig):
        self.config = monitor_config
        self.stop_event = threading.Event()
        self.results: Dict[str, Any] = {}   # keyed by hostname
        self.last_run: str | None = None
        self.run_count: int = 0

    # ── lifecycle ────────────────────────────────────────────────────────────

    def start(self):
        thread = threading.Thread(target=self._run_loop, daemon=True)
        thread.start()
        logger.info("Certificate monitor started",
                    interval=self.config.check_interval_minutes)

    def stop(self):
        self.stop_event.set()
        logger.info("Certificate monitor stopping")

    # ── internal loop ────────────────────────────────────────────────────────

    def _run_loop(self):
        while not self.stop_event.is_set():
            self._check_all()
            self.last_run = datetime.now(timezone.utc).isoformat()
            self.run_count += 1
            # Sleep in 1-second ticks so stop_event is checked promptly
            for _ in range(self.config.check_interval_minutes * 60):
                if self.stop_event.is_set():
                    break
                time.sleep(1)

    def _check_all(self):
        """
        Load certs from local_cert_checker / renewal_agent, check each one
        via the SSL API, and trigger the renewal agent for expired/critical.
        """
        try:
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from renewal_agent import (
                load_inventory, build_record,
                DEFAULT_INVENTORY, DEFAULT_CERTS_DIR,
            )

            rows = load_inventory(DEFAULT_INVENTORY)
            records = [build_record(r, DEFAULT_CERTS_DIR) for r in rows]

            logger.info("Monitor scanning certificates", count=len(records))

            for cert in records:
                if self.stop_event.is_set():
                    break
                self._check_single(cert)
                time.sleep(1)

        except Exception as e:
            logger.error("Monitor scan failed", error=str(e))

    def _check_single(self, cert: dict):
        """
        Call the SSL check API for one certificate.
        Store the result and trigger renewal if the cert is expired/critical.
        """
        hostname = cert['domain_name']
        try:
            response = requests.post(
                f"{self.config.api_base_url}/check",
                json={'hostname': hostname, 'port': 443},
                timeout=self.config.timeout_seconds,
            )

            if response.status_code == 200:
                ssl_data = response.json()
                self.results[hostname] = {
                    'hostname':       hostname,
                    'certificate_id': cert['certificate_id'],
                    'status':         cert['status'],
                    'days_to_expiry': cert['days_to_expiry'],
                    'ssl_check':      ssl_data,
                    'last_checked':   datetime.now(timezone.utc).isoformat(),
                }

                if cert['status'] in ('expired', 'critical'):
                    self._trigger_renewal(cert)
            else:
                logger.warning("SSL API returned non-200",
                               hostname=hostname,
                               status_code=response.status_code)

        except requests.exceptions.Timeout:
            logger.warning("SSL check timed out", hostname=hostname)
        except requests.exceptions.RequestException as e:
            logger.warning("SSL check failed", hostname=hostname, error=str(e))

    def _trigger_renewal(self, cert: dict):
        """Invoke the renewal agent for a cert that needs renewal."""
        try:
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from renewal_agent import RenewalAgent

            agent = RenewalAgent()
            job = agent.process_cert(cert)
            logger.info("Renewal agent triggered by monitor",
                        cert_id=job['certificate_id'],
                        domain=job['domain_name'],
                        job_id=job['job_id'],
                        status=job['overall_status'])
        except Exception as e:
            logger.warning("Renewal agent could not run",
                           hostname=cert['domain_name'],
                           error=str(e))

    # ── status / diagnostics ─────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Return current monitor state — callable from api_bridge if needed."""
        return {
            'running':          not self.stop_event.is_set(),
            'last_run':         self.last_run,
            'run_count':        self.run_count,
            'certs_tracked':    len(self.results),
            'interval_minutes': self.config.check_interval_minutes,
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    config = load_config()
    monitor = CertificateMonitor(config)

    logger.info(
        "Starting Certificate Monitor (no database — file-based)",
        interval=config.check_interval_minutes,
        api_url=config.api_base_url,
    )

    monitor.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down monitor")
        monitor.stop()


if __name__ == '__main__':
    main()
