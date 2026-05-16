# Entrust API credentials are read from environment variables.
# ca_submit() in renewal_agent.py uses this config for the
# real HTTP call when ENTRUST_USERNAME and ENTRUST_API_KEY
# are set. Falls back to internal CA issuance if unavailable.

import os

ENTRUST_CONFIG = {
    'api_url': 'https://cloud.entrust.net/EntrustCloud/documentation/rest/v1',
    'auth_endpoint': '/authentication',
    'cert_endpoint': '/certificates',
    'revoke_endpoint': '/certificates/{thumbprint}/revocations',
    'credentials': {
        'username': os.getenv('ENTRUST_USERNAME', ''),
        'password': os.getenv('ENTRUST_PASSWORD', ''),
        'api_key': os.getenv('ENTRUST_API_KEY', '')
    },
    'cert_types': {
        'DV': 'STANDARD_SSL',
        'OV': 'ADVANTAGE_SSL',
        'EV': 'UC_SSL',
        'wildcard': 'WILDCARD_SSL'
    },
    'is_configured': bool(
        os.getenv('ENTRUST_USERNAME') and
        os.getenv('ENTRUST_API_KEY')
    ),
}
