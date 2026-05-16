#!/usr/bin/env python3
"""
SSL Certificate Checker - Simple Version (No Swagger)
A simple service for checking SSL certificates
"""

import os
import socket
import json
import ssl
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from functools import wraps

from flask import Flask, request, jsonify
from flask_cors import CORS
import structlog
from dotenv import load_dotenv

try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
except ImportError:
    print('Please install required modules: pip install -r requirements.txt')
    exit(1)

# Load environment variables
load_dotenv(override=True)

# Configuration
class Config:
    """Application configuration."""
    PORT = int(os.getenv('PORT', 5000))
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    TIMEOUT = int(os.getenv('TIMEOUT', 5))

# Initialize Flask app
app = Flask(__name__)
app.config.from_object(Config)

# Enable CORS with explicit configuration
CORS(app, 
     resources={r"/api/*": {"origins": ["http://localhost:8081", "http://localhost:3000", "http://localhost:8080"]}},
     methods=["GET", "POST", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True)

# Configure logging
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

# Error handling decorator
def handle_errors(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error("API error", error=str(e), endpoint=request.endpoint)
            return jsonify({'error': 'Internal server error', 'details': str(e)}), 500
    return decorated_function

class SSLChecker:
    """Simple SSL Checker for certificate validation."""
    
    def get_cert(self, host, port, timeout=None):
        """Connection to the host with SSL certificate retrieval."""
        if timeout is None:
            timeout = Config.TIMEOUT
            
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        sock.settimeout(None)
        
        # Try different TLS versions in order of preference (newest to oldest)
        tls_versions = [
            (ssl.PROTOCOL_TLSv1_2, "TLS 1.2"),
            (ssl.PROTOCOL_TLSv1_1, "TLS 1.1"),
            (ssl.PROTOCOL_TLSv1, "TLS 1.0"),
        ]
        
        for tls_protocol, tls_version in tls_versions:
            try:
                # Create SSL context
                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

                # Wrap socket with SSL
                ssl_sock = context.wrap_socket(sock, server_hostname=host)
                ssl_sock.do_handshake()

                # Get certificate in DER format and convert to X509 object
                cert_der = ssl_sock.getpeercert(binary_form=True)
                cert = x509.load_der_x509_certificate(cert_der, default_backend())

                resolved_ip = socket.gethostbyname(host)
                ssl_sock.close()
                sock.close()
                return cert, resolved_ip, tls_version
            except (ssl.SSLError, ssl.CertificateError, OSError) as e:
                # If this TLS version fails, try the next one
                continue
            except Exception as e:
                # For other exceptions, try the next TLS version
                continue
        
        # If all TLS versions fail, raise the last exception
        raise ssl.SSLError("Failed to establish SSL connection with any supported TLS version")

    def get_cert_sans(self, x509cert):
        """Get Subject Alt Names from Certificate using cryptography library."""
        san = ''
        try:
            # Get the Subject Alternative Name extension
            san_extension = x509cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            if san_extension:
                san_names = san_extension.value
                # Convert all SAN types to strings
                san_list = []
                for name in san_names:
                    if hasattr(name, 'value'):
                        san_list.append(str(name.value))
                    else:
                        san_list.append(str(name))
                san = '; '.join(san_list)
        except x509.extensions.ExtensionNotFound:
            # No SAN extension found
            pass

        # replace commas to not break csv output
        san = san.replace(',', ';')
        return san

    def get_cert_info(self, host, cert, resolved_ip, tls_version=None):
        """Get all the information about cert and create a JSON response."""
        context = {}

        # Get subject information
        subject = cert.subject
        issuer = cert.issuer

        context['host'] = host
        context['resolved_ip'] = resolved_ip
        context['tls_version'] = tls_version
        context['timestamp'] = datetime.now(timezone.utc).isoformat()

        # Get common name from subject
        cn_attr = subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
        context['issued_to'] = cn_attr[0].value if cn_attr else 'N/A'

        # Get organization from subject
        o_attr = subject.get_attributes_for_oid(x509.NameOID.ORGANIZATION_NAME)
        context['issued_o'] = o_attr[0].value if o_attr else 'N/A'

        # Get issuer information
        issuer_c_attr = issuer.get_attributes_for_oid(x509.NameOID.COUNTRY_NAME)
        context['issuer_c'] = issuer_c_attr[0].value if issuer_c_attr else 'N/A'

        issuer_o_attr = issuer.get_attributes_for_oid(x509.NameOID.ORGANIZATION_NAME)
        context['issuer_o'] = issuer_o_attr[0].value if issuer_o_attr else 'N/A'

        issuer_ou_attr = issuer.get_attributes_for_oid(x509.NameOID.ORGANIZATIONAL_UNIT_NAME)
        context['issuer_ou'] = issuer_ou_attr[0].value if issuer_ou_attr else 'N/A'

        issuer_cn_attr = issuer.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
        context['issuer_cn'] = issuer_cn_attr[0].value if issuer_cn_attr else 'N/A'

        context['cert_sn'] = str(cert.serial_number)
        context['cert_sha1'] = cert.fingerprint(hashes.SHA1()).hex()
        context['cert_alg'] = cert.signature_algorithm_oid._name
        context['cert_ver'] = cert.version.value
        context['cert_sans'] = self.get_cert_sans(cert)
        context['cert_exp'] = cert.not_valid_after_utc < datetime.now(timezone.utc)
        context['cert_valid'] = not context['cert_exp']

        # Valid from (include time for precision)
        context['valid_from'] = cert.not_valid_before_utc.strftime('%Y-%m-%d %H:%M:%S UTC')

        # Valid till (include time for precision)
        context['valid_till'] = cert.not_valid_after_utc.strftime('%Y-%m-%d %H:%M:%S UTC')

        # Validity days
        context['validity_days'] = (cert.not_valid_after_utc - cert.not_valid_before_utc).days

        # Current time for calculations
        now = datetime.now(timezone.utc)
        
        # Time difference in seconds for precise calculation
        time_diff_seconds = (cert.not_valid_after_utc - now).total_seconds()
        
        # Validity in days from now (using total_seconds for precision)
        context['days_left'] = int(time_diff_seconds // 86400)  # 86400 seconds in a day

        # Valid days left (using total_seconds for precision, accounting for partial days)
        context['valid_days_to_expire'] = int(time_diff_seconds // 86400)
        
        # Add precise time information
        context['expires_in_hours'] = int(time_diff_seconds // 3600)
        context['expires_in_minutes'] = int(time_diff_seconds // 60)
        context['expires_in_seconds'] = int(time_diff_seconds)

        return context

    def filter_hostname(self, host):
        """Remove unused characters and split by address and port."""
        host = host.replace('http://', '').replace('https://', '').replace('/', '')
        port = 443
        if ':' in host:
            host, port = host.split(':')
        return host, port

    def check_ssl(self, host, port=443):
        """Check SSL certificate for a single host."""
        try:
            host, port = self.filter_hostname(host)
            
            cert, resolved_ip, tls_version = self.get_cert(host, port)
            context = self.get_cert_info(host, cert, resolved_ip, tls_version)
            context['tcp_port'] = int(port)
            context['status'] = 'success'
            
            return context
            
        except Exception as error:
            return {
                'host': host,
                'status': 'failed',
                'error': str(error),
                'timestamp': datetime.now(timezone.utc).isoformat()
            }

    def check_multiple_ssl(self, hostnames, port=443):
        """Check multiple SSL certificates."""
        results = []
        
        for hostname in hostnames:
            try:
                result = self.check_ssl(hostname, port)
                results.append(result)
            except Exception as e:
                results.append({
                    'host': hostname,
                    'status': 'failed',
                    'error': str(e),
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
        
        return results

# Initialize SSL Checker
ssl_checker = SSLChecker()

# Simple API endpoints without Swagger
@app.route('/api/ssl/check', methods=['POST', 'OPTIONS'])
@handle_errors
def check_ssl():
    """Check SSL certificate for a single host."""
    if request.method == 'OPTIONS':
        # Handle preflight request
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:8081')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
        return response, 200
    
    data = request.get_json()
    if not data or 'hostname' not in data:
        return jsonify({'error': 'Missing hostname parameter'}), 400
    
    hostname = data['hostname']
    port = data.get('port', 443)
    
    # Run SSL check
    result = ssl_checker.check_ssl(hostname, port)
    
    return jsonify(result), 200

@app.route('/api/ssl/check-multiple', methods=['POST', 'OPTIONS'])
@handle_errors
def check_multiple_ssl():
    """Check SSL certificates for multiple hosts."""
    if request.method == 'OPTIONS':
        # Handle preflight request
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:8081')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
        return response, 200
    
    data = request.get_json()
    if not data or 'hostnames' not in data:
        return jsonify({'error': 'Missing hostnames parameter'}), 400
    
    hostnames = data['hostnames']
    if not isinstance(hostnames, list) or len(hostnames) == 0:
        return jsonify({'error': 'hostnames must be a non-empty list'}), 400
    
    if len(hostnames) > 100:  # Limit batch size
        return jsonify({'error': 'Maximum 100 hostnames allowed per request'}), 400
    
    port = data.get('port', 443)
    
    # Run SSL checks
    results = ssl_checker.check_multiple_ssl(hostnames, port)
    
    return jsonify({
        'results': results,
        'total': len(results),
        'timestamp': datetime.now(timezone.utc).isoformat()
    }), 200

# Simple health check endpoint
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'service': 'SSL Certificate Checker'
    }), 200

# Global OPTIONS handler for CORS preflight requests
@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    """Handle OPTIONS requests for CORS preflight."""
    response = jsonify({'status': 'ok'})
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:8081')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response, 200

# Error handlers
@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    logger.error("Internal server error", error=str(error))
    return jsonify({'error': 'Internal server error'}), 500

# Main application entry point
if __name__ == '__main__':
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, Config.LOG_LEVEL),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger.info("Starting SSL Certificate Checker (Simple Version)", 
                port=Config.PORT, 
                debug=Config.DEBUG)
    
    print("🔒 SSL Certificate Checker (Simple) is starting...")
    print(f"🔒 API Base URL: http://localhost:{Config.PORT}/api")
    print("📋 Available endpoints:")
    print("   POST /api/ssl/check")
    print("   POST /api/ssl/check-multiple")
    print("   GET  /api/health")
    print("=" * 60)
    
    # Run the application
    app.run(host='0.0.0.0', port=Config.PORT, debug=Config.DEBUG)
