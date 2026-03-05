# Google Ads Cost Sync Setup

## 1) Important: "API key" is not enough

For Google Ads API sync, you need:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (usually MCC, optional but recommended)

Google Ads API uses OAuth 2.0 + developer token.

## 2) Create Supabase table

Run SQL script in Supabase SQL editor:

- `supabase/ad_costs_daily.sql`

## 3) Configure GitHub Secrets

Set these repository secrets:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_ACCOUNTS_JSON`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `FX_RATES_JSON` (default: `{"CZK":1,"EUR":25.2,"HUF":0.063}`)

Example `GOOGLE_ADS_ACCOUNTS_JSON`:

```json
[
  { "market": "cz", "customerId": "1234567890" },
  { "market": "sk", "customerId": "2345678901" },
  { "market": "hu", "customerId": "3456789012" }
]
```

## 4) Run the workflow

Workflow file:

- `.github/workflows/sync-google-ads-costs.yml`

Runs every 4 hours and can also be started manually (`workflow_dispatch`).

## 5) Local manual run (optional)

```bash
node scripts/sync-google-ads-costs.mjs
```

Use env vars from step 3.
