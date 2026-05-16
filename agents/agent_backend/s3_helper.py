import boto3, json

s3 = boto3.client('s3', region_name='us-east-1')
DESTINATION_BUCKET = 'certificate-data-processed1'

def read_cert(event) -> dict:
    """Read cert from S3 event trigger or pass-through if already a dict."""
    if isinstance(event, dict) and 'Records' in event:
        bucket = event['Records'][0]['s3']['bucket']['name']
        key    = event['Records'][0]['s3']['object']['key']
        obj    = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(obj['Body'].read())
    return event

def write_decision(cert_data, decision):
    s3.put_object(
        Bucket=DESTINATION_BUCKET,
        Key=f"decisions/{cert_data['hostname']}.json",
        Body=json.dumps({"cert": cert_data, "decision": decision})
    )

def upload_inventory(cert_list: list, bucket: str = 'mock-certificate-data'):
    """Upload full certificate inventory JSON to S3."""
    from datetime import datetime
    today = datetime.utcnow().strftime('%Y-%m-%d')
    s3.put_object(
        Bucket=bucket,
        Key=f"inventory/{today}/certificates.json",
        Body=json.dumps(cert_list, default=str),
        ContentType='application/json'
    )
    print(f"S3: uploaded inventory ({len(cert_list)} certs) to {bucket}")

def upload_renewal_jobs(jobs: list, bucket: str = 'certificate-data-processed1'):
    """Upload renewal jobs JSON to S3."""
    from datetime import datetime
    today = datetime.utcnow().strftime('%Y-%m-%d')
    s3.put_object(
        Bucket=bucket,
        Key=f"renewals/{today}/jobs.json",
        Body=json.dumps(jobs, default=str),
        ContentType='application/json'
    )
    print(f"S3: uploaded jobs ({len(jobs)} jobs) to {bucket}")
