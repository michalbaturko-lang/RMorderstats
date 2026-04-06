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

- `FX_RATES_JSON` (default: `{"CZK":1,"EUR":25.2,"HUF":0.063,"RON":5.1}`)

Recommended `GOOGLE_ADS_ACCOUNTS_JSON` for your current setup:

```json
[
  { "market": "cz", "customerId": "784-198-5650", "enabled": true },
  { "market": "sk", "customerId": "257-933-8188", "enabled": true },
  { "market": "hu", "customerId": "196-153-9480", "enabled": true },
  { "market": "sk", "customerId": "176-019-1298", "enabled": false },
  { "market": "ro", "customerId": "471-804-3625", "enabled": true, "activeFrom": "2026-03-01" }
]
```

Notes:

- `enabled: false` means the account is ignored by the sync.
- Romania should be backfilled from `2026-03-01` onward.
- For a one-time Romania-only backfill, run `npm run sync:ads-costs:ro-backfill`.
- If you want to run it manually, use `SYNC_FROM_DATE=2026-03-01 SYNC_MARKETS=ro`.
- You can also use `activeFrom` / `activeTo` per account if needed.

## 4) Run the workflow

Workflow file:

- `.github/workflows/sync-google-ads-costs.yml`

Runs every 4 hours and can also be started manually (`workflow_dispatch`).

## 5) Local manual run (optional)

```bash
node scripts/sync-google-ads-costs.mjs
```

Full sync for all four active markets:

```bash
npm run sync:ads-costs:all
```

Romania-only backfill:

```bash
npm run sync:ads-costs:ro-backfill
```

Use env vars from step 3.
