from cert_actions import handle_immediate_renewal
from cert_actions import handle_scheduled_renewal
from cert_actions import handle_monitor
from bedrock_client import analyze_certificate
from s3_helper import read_cert, write_decision

def lambda_handler(event, context):
    cert_data = read_cert(event)
    decision  = analyze_certificate(cert_data)
    write_decision(cert_data, decision)

    if decision['action'] == 'renew_immediately':
        handle_immediate_renewal(cert_data, decision)
    elif decision['action'] == 'schedule_renewal':
        handle_scheduled_renewal(cert_data, decision)
    else:
        handle_monitor(cert_data, decision)
