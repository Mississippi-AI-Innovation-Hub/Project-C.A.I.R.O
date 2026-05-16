import boto3
import json
import os
from dotenv import load_dotenv
load_dotenv()

_session_token = os.getenv('AWS_SESSION_TOKEN')
_bedrock_kwargs = {
    'region_name': 'us-east-1',
    'aws_access_key_id': os.getenv('AWS_ACCESS_KEY_ID'),
    'aws_secret_access_key': os.getenv('AWS_SECRET_ACCESS_KEY'),
}
if _session_token:
    _bedrock_kwargs['aws_session_token'] = _session_token

bedrock_client = boto3.client('bedrock-runtime', **_bedrock_kwargs)

def analyze_certificate(cert_data: dict, changes: dict = None) -> dict:

    change_section = ""
    if changes:
        change_section = f"""
DETECTED ORGANIZATIONAL CHANGES (these require immediate certificate renewal):
- City Changed:            {changes.get('city_changed', False)} 
  Previous City:           {changes.get('previous_city', 'N/A')}
- Domain Changed:          {changes.get('domain_changed', False)}
  Previous Domain:         {changes.get('previous_domain', 'N/A')}
- Department Name Changed: {changes.get('dept_name_changed', False)}
  Previous Dept Name:      {changes.get('previous_dept_name', 'N/A')}
"""

    prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a certificate renewal API. You only output raw JSON. 
You never output text, headers, explanations, or markdown.
Your entire response must be a single JSON object starting with {{ and ending with }}.
<|eot_id|><|start_header_id|>user<|end_header_id|>
Analyze this certificate and return ONLY a JSON object matching this exact structure:

{{
  "urgency_score": 95,
  "action": "renew_immediately",
  "generate_csr": true,
  "reason": "Certificate expires in 20 days",
  "recommended_validity_days": 365,
  "risk_assessment": {{
    "risk_level": "critical",
    "risk_score": 90,
    "risks": ["risk one", "risk two"],
    "consequences": ["consequence one", "consequence two"],
    "estimated_impact": "High"
  }},
  "change_tracking": {{
    "city_changed": false,
    "domain_changed": false,
    "dept_name_changed": false,
    "requires_reissue": false,
    "change_reason": "No changes detected"
  }}
}}

URGENCY RULES:
1. Any organizational change detected → urgency 95-100 + renew_immediately
2. Domain change detected             → urgency 95-100 + renew_immediately
3. 0-30 days remaining                → urgency 80-94  + renew_immediately
4. 31-60 days remaining               → urgency 50-79  + schedule_renewal
5. 60+ days remaining + no changes    → urgency 0-49   + monitor

RISK RULES:
- critical (80-100): expired, domain mismatch, org change, or < 15 days
- high     (60-79):  15-30 days or dept name change
- medium   (40-59):  31-60 days or city change
- low      (0-39):   60+ days, no changes

Certificate:
- Common Name:      {cert_data['common_name']}
- Domain:           {cert_data['domain_name']}
- Days to Expiry:   {cert_data['days_to_expiry']}
- Expiration Date:  {cert_data['expiration_date']}
- Agency:           {cert_data.get('agency_name', 'Unknown')}
- Environment:      {cert_data.get('environment', 'production')}
- Cert Type:        {cert_data.get('certificate_type', 'DV')}
- Status:           {cert_data.get('status', 'unknown')}
- Auto Renew:       {cert_data.get('auto_renew_enabled', 'no')}
- CSR Required:     {cert_data.get('csr_required', 'yes')}
- State:            {cert_data.get('state', 'Mississippi')}
- City:             {cert_data.get('city', 'Starkville')}
{change_section}
<|eot_id|><|start_header_id|>assistant<|end_header_id|>
    {{"""

    try:
        print("Sending request to Bedrock...")

        response = bedrock_client.invoke_model(
            modelId='amazon.nova-lite-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": prompt}]
                    }
                ],
                "inferenceConfig": {
                    "maxTokens": 1024,
                    "temperature": 0.01
                }
            })
        )

        result   = json.loads(response['body'].read())
        output   = result.get('output', {})
        message  = output.get('message', {})
        content  = message.get('content', [{}])
        raw_text = content[0].get('text', '').strip() if content else ''

        print("=== NOVA LITE OUTPUT ===")
        print(raw_text[:600])
        print("========================")

        # Add back the opening brace we used to prime the response
        return parse_model_response(raw_text)

    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {str(e)}")
        raise


def parse_model_response(text: str) -> dict:
    text  = text.replace('```json', '').replace('```', '').strip()
    start = text.find('{')
    end   = text.rfind('}') + 1

    if start == -1 or end == 0:
        print("ERROR: No JSON found in response")
        return default_response()

    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError as e:
        print(f"ERROR parsing JSON: {e}")
        return default_response()


def default_response() -> dict:
    return {
        "urgency_score": 50,
        "action": "monitor",
        "generate_csr": False,
        "reason": "Could not parse model response",
        "risk_assessment": {
            "risk_level":       "unknown",
            "risk_score":       50,
            "risks":            ["Unable to assess"],
            "consequences":     ["Manual review required"],
            "estimated_impact": "Unknown"
        },
        "change_tracking": {
            "city_changed":      False,
            "domain_changed":    False,
            "dept_name_changed": False,
            "requires_reissue":  False,
            "change_reason":     "Could not parse model response"
        }
    }