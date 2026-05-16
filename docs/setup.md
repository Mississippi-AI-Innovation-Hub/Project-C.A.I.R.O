# Setup and Deployment Instructions

## Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher
- npm 9 or higher
- OpenSSL (for dummy cert generation)
- An AWS account with SNS topic configured (optional — system works without it using simulated mode)

## 1. Clone and configure

```bash
git clone <repository-url>
cd <repository-folder>
cp .env.example .env
# Edit .env and fill in your AWS credentials and SNS Topic ARN
```

## 2. Backend setup

```bash
# Create and activate virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# First-time only: generate the dummy certificate inventory
python generate_dummy_certificates.py --count 20

# Start the Flask API
python api_bridge.py
# → Running on http://localhost:5000
```

## 3. Frontend setup

```bash
# In a new terminal (keep the Flask API running)
npm install

# Create frontend env file
cp .env.local .env.local   # already provided — no edits needed for local dev

# Start the Vite dev server
npm run dev
# → Running on http://localhost:8081
```

## 4. Verify the system is running

- Open http://localhost:8081 in your browser
- The Overview dashboard should show 20 certificates
- The header will show a red critical banner if any certs are expired or critical
- Check http://localhost:5000/api/health for API status

## 5. SNS email alerts (optional)

To enable real email alerts:
1. Create an SNS topic in AWS (email protocol)
2. Add subscribers (email addresses)
3. Set `SNS_TOPIC_ARN` in `.env`
4. Restart the Flask API

Without `SNS_TOPIC_ARN` set, all alerts are simulated (logged locally, no real emails sent).

## Known Setup Limitations

- The Vite dev server must run on port 8081 to match the Flask CORS whitelist
- Certificates added via the dashboard persist to DynamoDB and reload on restart. The base inventory always loads from generated_certificates/certificate_inventory.csv first; DynamoDB-saved certificates are merged in after. If DynamoDB is unreachable, only the CSV inventory loads.
- Amazon Bedrock AI analysis requires valid AWS credentials in `us-east-1`; without them, the system falls back to rule-based analysis automatically
