from pathlib import Path
from generate_dummy_certificates_agent import generate_certificate
import boto3
import json
from datetime import datetime
import tempfile
from pathlib import Path

s3_client = boto3.client('s3')
DESTINATION_BUCKET = 'certificate-data-processed1'




def handle_immediate_renewal(cert_data: dict, decision: dict):
    try:
        tmp_dir     = Path(tempfile.gettempdir())
        output_key  = tmp_dir / f"{cert_data['common_name']}.key"
        output_cert = tmp_dir / f"{cert_data['common_name']}.crt"

        generate_certificate(
            common_name = cert_data['common_name'],
            org_name    = cert_data.get('agency_name', 'My Organization'),
            output_key  = output_key,
            output_cert = output_cert,
            days_valid  = cert_data.get('days_valid', 365),
            state       = cert_data.get('state', 'Mississippi'),
            city        = cert_data.get('city', 'Starkville')
        )

        for file_path, s3_key in [
            (output_cert, f"certs/{cert_data['common_name']}.crt"),
            (output_key,  f"keys/{cert_data['common_name']}.key")
        ]:
            with open(file_path, 'rb') as f:
                s3_client.put_object(
                    Bucket=DESTINATION_BUCKET,
                    Key=s3_key,
                    Body=f.read()
                )
            print(f"Uploaded {s3_key} to {DESTINATION_BUCKET}")

        s3_client.put_object(
            Bucket=DESTINATION_BUCKET,
            Key=f"renewals/pending/{cert_data['common_name']}.json",
            Body=json.dumps({
                "common_name":   cert_data['common_name'],
                "agency_name":   cert_data.get('agency_name'),
                "urgency_score": decision['urgency_score'],
                "requested_at":  datetime.utcnow().isoformat(),
                "status":        "pending"
            })
        )
    except Exception as e:
        print(f"cert_actions S3 error (non-fatal): {e}")


def handle_scheduled_renewal(cert_data: dict, decision: dict):
    print(f"SCHEDULED: {cert_data['common_name']} — {cert_data['days_to_expiry']} days left")

    s3_client.put_object(
        Bucket=DESTINATION_BUCKET,
        Key=f"renewals/scheduled/{cert_data['common_name']}.json",
        Body=json.dumps({
            "common_name":      cert_data['common_name'],
            "days_to_expiry":   cert_data['days_to_expiry'],
            "renewal_deadline": decision.get('renewal_deadline'),
            "scheduled_at":     datetime.utcnow().isoformat()
        })
    )


def handle_monitor(cert_data: dict, decision: dict):
    print(f"MONITOR: {cert_data['common_name']} — {cert_data['days_to_expiry']} days left, no action needed")

    s3_client.put_object(
        Bucket=DESTINATION_BUCKET,
        Key=f"monitoring/{cert_data['common_name']}.json",
        Body=json.dumps({
            "common_name":    cert_data['common_name'],
            "days_to_expiry": cert_data['days_to_expiry'],
            "last_checked":   datetime.utcnow().isoformat(),
            "status":         "healthy"
        })
    )
