# Ads Analytics Sync Setup

This repo has two marketing sync layers:

- legacy cost-only Google Ads sync: `scripts/sync-google-ads-costs.mjs`
- detailed Google Ads + Meta Ads sync: `scripts/sync-ads-analytics.mjs`

Use the detailed sync for diagnosing why average order value drops. It writes
read-only platform data into Supabase; it does not edit campaigns, bids, budgets,
ads, products, or audiences.

Read-only rule: Google Ads scripts may call only reporting/search endpoints
(`googleAds:searchStream`). Meta Ads scripts may call the Graph API only via
GET-based account metadata and insights reads. They must not call any mutate,
POST, PATCH, PUT or DELETE endpoint for campaigns, budgets, ads, ad sets,
creatives, products or audiences. Both Ads workflows run
`npm run verify:ads-readonly` before syncing.

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
- `supabase/ad_business_analytics_views.sql` for reusable business views that
  join Ads spend with deduplicated non-cancelled order revenue and exact margin

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
- `order_business_daily_summary`
- `marketing_business_provider_daily_summary`
- `marketing_business_daily_total`

Detailed dimensions such as search term, product, device, audience, geo and
placement are stored in `ad_metrics_daily.dimensions` and the full source row is
kept in `ad_raw_insights`.

The business views use the same order hygiene as the dashboard and coverage
audit: deduplicate orders by order number/id, exclude `STORNO`, calculate product
revenue without VAT/shipping from `raw_data.products[].price_without_vat`, and
use exact gross profit only when every product in the order has `buy_price`.

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
- `GOOGLE_ADS_DETAIL_LEVELS` default `campaign,device,hour,ad_group,ad,keyword,search_term,shopping_product,asset_group,conversion_action`
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

Workflows:

- `.github/workflows/sync-ads-spend.yml`
  - every 15 minutes
  - lightweight `campaign` level only
  - refreshes the last 1 day by default
  - intended for current spend and country/market split
  - supports manual `from_date` / `to_date` backfills for historical spend,
    still at `campaign` level only
- `.github/workflows/sync-ads-analytics.yml`
  - once per day
  - deep detail levels
  - refreshes the last 3 days by default
  - intended for campaign diagnostics and analytical history
- `.github/workflows/check-ads-coverage.yml`
  - manual read-only audit
  - checks which Ads campaign rows are already in Supabase for a date range
  - prints spend, real revenue, PNO, real ROAS and gross profit after Ads by
    provider and market
  - uses the same order hygiene as the dashboard: deduplicate orders first,
    then remove cancelled/STORNO orders before revenue and margin comparison
- `.github/workflows/check-ads-business-views.yml`
  - manual read-only verifier for `supabase/ad_business_analytics_views.sql`
  - compares `order_business_daily_summary`,
    `marketing_business_provider_daily_summary` and
    `marketing_business_daily_total` against source `orders` and
    campaign-level `ad_metrics_daily`
  - run once with `require_views=0` before the SQL is applied if you only want
    a missing-view readiness check, then with `require_views=1` after applying
    the SQL to prove the views match the dashboard/audit calculations
- `.github/workflows/check-ads-sync-health.yml`
  - every 30 minutes, offset from the 15-minute spend sync
  - read-only health monitor for sync freshness and today's campaign rows
  - before `04:00 UTC`, monitors yesterday by default to avoid false alarms
    while same-day Ads rows are still warming up
  - defaults to `google_ads` and markets `cz,sk,hu,ro`; add `meta_ads` to
    `ADS_HEALTH_EXPECTED_PROVIDERS` after Meta secrets and first backfill exist
  - fails if the latest campaign sync is stale, failed, outside the monitored
    date, upserted no rows, or an expected provider/market has no campaign rows

Current Google Ads detail levels:

- `campaign`
- `device`
- `hour`
- `ad_group`
- `ad`
- `keyword`
- `search_term`
- `shopping_product`
- `asset_group`
- `conversion_action`

Quota discipline:

- do not run deep detail sync every 15 minutes
- use campaign-only sync for frequent spend refreshes
- run large historical detail backfills manually in chunks
- use `Sync Ads Spend` with `from_date` / `to_date` for safer historical spend
  backfills such as previous month or year-to-date
- if the developer token has Google Ads API Explorer Access, budget for 2,880
  operations/day and request Basic/Standard access before widening history or
  adding many more accounts

- manual backfill via `workflow_dispatch` with `from_date` / `to_date`
- the workflow skips providers whose secrets are not filled yet, so Google can
  run before Meta is connected

## 6) What This Lets Us Diagnose

For Google Ads:

- campaign AOV/value per conversion
- Shopping product AOV and conversion value
- search terms that spend but bring no value
- device split
- hourly split
- ad group / ad / keyword split
- conversion action split
- Performance Max asset group split

For Meta Ads:

- campaign/adset/ad AOV and purchase value
- age/gender split
- country split
- publisher/platform/placement split

In `orders.regalmaster.cz`, the next UI step should compare platform metrics
with real Supabase orders by date and market: spend, real revenue, gross profit,
gross profit after ad spend, platform ROAS and real ROAS.
