# Ads Analytics Sync Setup

This repo has two marketing sync layers:

- legacy cost-only Google Ads sync: `scripts/sync-google-ads-costs.mjs`
- detailed Google Ads + Meta Ads sync: `scripts/sync-ads-analytics.mjs`

Use the detailed sync for diagnosing why average order value drops. It writes
read-only platform data into Supabase; it does not edit campaigns, bids, budgets,
ads, products, or audiences.

## 1) Required Access

Google Ads API:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- either direct OAuth: `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`
- or Base44 token broker: `GOOGLE_ADS_BASE44_APP_ID`, `GOOGLE_ADS_BASE44_ACCESS_TOKEN`, `GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (usually MCC, optional but recommended)
- `GOOGLE_ADS_ACCOUNTS_JSON`

Meta Ads:

- `META_ACCESS_TOKEN` with ads insights read access
- `META_ADS_ACCOUNTS_JSON`

If a Meta MCP is used to inspect or confirm accounts, keep the scheduled sync
server-side: pass the confirmed account IDs/token into env vars and write to
Supabase from the job, not from an interactive browser/MCP session.

## 2) Supabase Tables

Run these SQL scripts in Supabase SQL editor:

- `supabase/ad_costs_daily.sql` for the old cost-only table
- `supabase/ad_marketing_analytics.sql` for the detailed model

The detailed schema creates:

- `ad_accounts`
- `ad_campaigns`
- `ad_groups`
- `ad_ads`
- `ad_metrics_daily`
- `ad_raw_insights`
- `ad_sync_runs`
- `marketing_daily_summary`
- `marketing_campaign_daily_summary`

Detailed dimensions such as search term, product, device, audience, geo and
placement are stored in `ad_metrics_daily.dimensions` and the full source row is
kept in `ad_raw_insights`.

## 3) Configure Secrets

Set these GitHub/Vercel/server secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_BASE44_APP_ID`
- `GOOGLE_ADS_BASE44_ACCESS_TOKEN`
- `GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_ACCOUNTS_JSON`
- `META_ACCESS_TOKEN`
- `META_ADS_ACCOUNTS_JSON`

Optional:

- `ADS_SYNC_PROVIDERS` default `google_ads,meta_ads`
- `GOOGLE_ADS_API_VERSION` default `v23`
- `GOOGLE_ADS_DETAIL_LEVELS` default `campaign,device,search_term,shopping_product,asset_group`
- `META_GRAPH_API_VERSION` default `v24.0`
- `META_ADS_DETAIL_LEVELS` default `campaign,adset,ad,audience,geo,placement`
- `FX_RATES_JSON` default `{"CZK":1,"EUR":25.2,"HUF":0.063,"RON":5.1}`

Recommended `GOOGLE_ADS_ACCOUNTS_JSON`:

```json
[
  { "market": "cz", "customerId": "784-198-5650", "accountName": "vyprodej-regalu.cz", "currency": "CZK", "enabled": true },
  { "market": "sk", "customerId": "257-933-8188", "accountName": "vypredaj-regalov.sk", "currency": "EUR", "enabled": true },
  { "market": "hu", "customerId": "196-153-9480", "accountName": "polc-kiarusitas.hu", "currency": "HUF", "enabled": true },
  { "market": "sk", "customerId": "176-019-1298", "accountName": "vypredaj-regalov.sk - starý účet", "currency": "EUR", "enabled": false },
  { "market": "ro", "customerId": "471-804-3625", "accountName": "lichidare-rafturi.ro", "currency": "RON", "enabled": true, "activeFrom": "2026-03-01" }
]
```

Recommended `META_ADS_ACCOUNTS_JSON` shape:

```json
[
  { "market": "cz", "accountId": "act_123", "accountName": "Meta CZ", "currency": "CZK", "enabled": true },
  { "market": "sk", "accountId": "act_456", "accountName": "Meta SK", "currency": "EUR", "enabled": true },
  { "market": "hu", "accountId": "act_789", "accountName": "Meta HU", "currency": "HUF", "enabled": true },
  { "market": "ro", "accountId": "act_101", "accountName": "Meta RO", "currency": "RON", "enabled": true }
]
```

## 4) Run Locally

```bash
set -a; source .env.ads; set +a
npm run sync:ads-analytics
```

Google only:

```bash
npm run sync:ads-analytics:google
```

Meta only:

```bash
npm run sync:ads-analytics:meta
```

CZ today:

```bash
npm run sync:ads-analytics:cz-today
```

## 5) Scheduled Sync

Workflow:

- `.github/workflows/sync-ads-analytics.yml`

Recommended cadence:

- every 4 hours for the last 14 days, because attribution and conversion values
  can settle late
- manual backfill via `workflow_dispatch` with `SYNC_FROM_DATE` / `SYNC_TO_DATE`
- the workflow skips providers whose secrets are not filled yet, so Google can
  run before Meta is connected

## 6) What This Lets Us Diagnose

For Google Ads:

- campaign AOV/value per conversion
- Shopping product AOV and conversion value
- search terms that spend but bring no value
- device split
- Performance Max asset group split

For Meta Ads:

- campaign/adset/ad AOV and purchase value
- age/gender split
- country split
- publisher/platform/placement split

In `orders.regalmaster.cz`, the next UI step should compare platform metrics
with real Supabase orders by date and market: spend, real revenue, gross profit,
gross profit after ad spend, platform ROAS and real ROAS.
