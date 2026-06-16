-- Role based access rollout proposal for orders.regalmaster.cz.
-- Review and apply deliberately; this file intentionally replaces broad
-- "authenticated can read everything" policies with module-aware checks.

create table if not exists public.app_user_access (
  email text primary key,
  role text not null check (role in ('owner', 'team', 'logistics_only', 'none')),
  modules text[] not null default '{}'::text[],
  can_upload_import_documents boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.app_user_access_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.email = lower(trim(new.email));
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_user_access_set_updated_at on public.app_user_access;
create trigger app_user_access_set_updated_at
before insert or update on public.app_user_access
for each row execute function public.app_user_access_set_updated_at();

alter table public.app_user_access enable row level security;

revoke all on public.app_user_access from anon;
revoke all on public.app_user_access from authenticated;
grant select on public.app_user_access to authenticated;

drop policy if exists "app_user_access_self_read" on public.app_user_access;
create policy "app_user_access_self_read"
on public.app_user_access
for select
to authenticated
using (email = lower(auth.jwt() ->> 'email'));

insert into public.app_user_access (email, role, modules, can_upload_import_documents)
values
  (
    'michal.baturko@regalmaster.cz',
    'owner',
    array['heatmap','margin','tempo','geo','b2b','products','import-logistics','ads','pokec','finance'],
    true
  ),
  (
    'kristyna.vencel@regalmaster.cz',
    'team',
    array['heatmap','margin','tempo','geo','b2b','ads','finance'],
    false
  ),
  (
    'jan.olbert@regalmaster.cz',
    'team',
    array['heatmap','margin','tempo','geo','b2b','ads','finance'],
    false
  )
on conflict (email) do update set
  role = excluded.role,
  modules = excluded.modules,
  can_upload_import_documents = excluded.can_upload_import_documents,
  active = true;

-- Add Alex when the final email is known. Upload remains false unless explicitly changed:
-- insert into public.app_user_access (email, role, modules, can_upload_import_documents)
-- values ('alex@example.regalmaster.cz', 'logistics_only', array['import-logistics'], false)
-- on conflict (email) do update set role = excluded.role, modules = excluded.modules, can_upload_import_documents = excluded.can_upload_import_documents, active = true;

create or replace function public.app_has_module(module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_access aua
    where aua.email = lower(auth.jwt() ->> 'email')
      and aua.active
      and module_key = any(aua.modules)
  );
$$;

create or replace function public.app_has_any_module(module_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_access aua
    where aua.email = lower(auth.jwt() ->> 'email')
      and aua.active
      and aua.modules && module_keys
  );
$$;

create or replace function public.app_can_upload_import_documents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_access aua
    where aua.email = lower(auth.jwt() ->> 'email')
      and aua.active
      and aua.can_upload_import_documents
  );
$$;

grant execute on function public.app_has_module(text) to authenticated;
grant execute on function public.app_has_any_module(text[]) to authenticated;
grant execute on function public.app_can_upload_import_documents() to authenticated;

-- Dashboard/order data. This blocks logistics_only from direct Supabase reads.
alter table if exists public.orders enable row level security;
drop policy if exists "orders_read_authenticated" on public.orders;
drop policy if exists "orders_read_dashboard_modules" on public.orders;
create policy "orders_read_dashboard_modules"
on public.orders
for select
to authenticated
using (public.app_has_any_module(array['heatmap','margin','tempo','geo','b2b','products','ads','finance','pokec']));

alter table if exists public.order_items enable row level security;
drop policy if exists "order_items_read_authenticated" on public.order_items;
drop policy if exists "order_items_read_dashboard_modules" on public.order_items;
create policy "order_items_read_dashboard_modules"
on public.order_items
for select
to authenticated
using (public.app_has_any_module(array['heatmap','margin','tempo','geo','b2b','products','ads','finance','pokec']));

-- Ads data.
drop policy if exists "ad_costs_daily_read_authenticated" on public.ad_costs_daily;
create policy "ad_costs_daily_read_ads_module"
on public.ad_costs_daily
for select to authenticated
using (public.app_has_module('ads'));

drop policy if exists "ad_accounts_read_authenticated" on public.ad_accounts;
create policy "ad_accounts_read_ads_module" on public.ad_accounts
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_campaigns_read_authenticated" on public.ad_campaigns;
create policy "ad_campaigns_read_ads_module" on public.ad_campaigns
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_groups_read_authenticated" on public.ad_groups;
create policy "ad_groups_read_ads_module" on public.ad_groups
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_ads_read_authenticated" on public.ad_ads;
create policy "ad_ads_read_ads_module" on public.ad_ads
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_metrics_daily_read_authenticated" on public.ad_metrics_daily;
create policy "ad_metrics_daily_read_ads_module" on public.ad_metrics_daily
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_raw_insights_read_authenticated" on public.ad_raw_insights;
create policy "ad_raw_insights_read_ads_module" on public.ad_raw_insights
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_sync_runs_read_authenticated" on public.ad_sync_runs;
create policy "ad_sync_runs_read_ads_module" on public.ad_sync_runs
for select to authenticated using (public.app_has_module('ads'));

drop policy if exists "ad_landing_pages_daily_read_authenticated" on public.ad_landing_pages_daily;
create policy "ad_landing_pages_daily_read_ads_module" on public.ad_landing_pages_daily
for select to authenticated using (public.app_has_module('ads'));

alter view if exists public.marketing_daily_summary set (security_invoker = true);
alter view if exists public.marketing_campaign_daily_summary set (security_invoker = true);
alter view if exists public.marketing_business_daily_total set (security_invoker = true);
alter view if exists public.marketing_business_provider_daily_summary set (security_invoker = true);
alter view if exists public.ad_landing_page_daily_summary set (security_invoker = true);
alter view if exists public.ad_landing_page_period_type_summary set (security_invoker = true);
alter view if exists public.ad_landing_page_period_url_summary set (security_invoker = true);
alter view if exists public.ad_landing_page_period_url_base_summary set (security_invoker = true);

-- Finance state.
drop policy if exists "finance_state_read_allowed_users" on public.finance_state;
create policy "finance_state_read_finance_module"
on public.finance_state
for select to authenticated
using (public.app_has_module('finance'));

drop policy if exists "finance_state_insert_allowed_users" on public.finance_state;
create policy "finance_state_insert_finance_module"
on public.finance_state
for insert to authenticated
with check (public.app_has_module('finance'));

drop policy if exists "finance_state_update_allowed_users" on public.finance_state;
create policy "finance_state_update_finance_module"
on public.finance_state
for update to authenticated
using (public.app_has_module('finance'))
with check (public.app_has_module('finance'));

-- Import logistics read access.
drop policy if exists "import_suppliers_read_authenticated" on public.import_suppliers;
create policy "import_suppliers_read_import_module"
on public.import_suppliers for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_product_master_read_authenticated" on public.import_product_master;
create policy "import_product_master_read_import_module"
on public.import_product_master for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_orders_read_authenticated" on public.import_orders;
create policy "import_orders_read_import_module"
on public.import_orders for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_order_shipments_read_authenticated" on public.import_order_shipments;
create policy "import_order_shipments_read_import_module"
on public.import_order_shipments for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_order_lines_read_authenticated" on public.import_order_lines;
create policy "import_order_lines_read_import_module"
on public.import_order_lines for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_product_matches_read_authenticated" on public.import_product_matches;
create policy "import_product_matches_read_import_module"
on public.import_product_matches for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_order_documents_read_authenticated" on public.import_order_documents;
create policy "import_order_documents_read_import_module"
on public.import_order_documents for select to authenticated using (public.app_has_module('import-logistics'));

drop policy if exists "import_order_costs_read_authenticated" on public.import_order_costs;
create policy "import_order_costs_read_import_module"
on public.import_order_costs for select to authenticated using (public.app_has_module('import-logistics'));

alter view if exists public.import_orders_on_the_way set (security_invoker = true);
alter view if exists public.import_order_lines_detail set (security_invoker = true);
alter view if exists public.import_logistics_order_overview set (security_invoker = true);
alter view if exists public.import_logistics_sku_risk set (security_invoker = true);
alter view if exists public.import_logistics_landed_cost_changes set (security_invoker = true);
alter view if exists public.import_logistics_match_gaps set (security_invoker = true);
alter view if exists public.import_logistics_document_coverage set (security_invoker = true);

-- Product catalog costs/stock are needed by margin/products/import logistics.
drop policy if exists "upgates_purchase_prices_read_authenticated" on public.upgates_product_purchase_prices_daily;
create policy "upgates_purchase_prices_read_allowed_modules"
on public.upgates_product_purchase_prices_daily
for select to authenticated
using (public.app_has_any_module(array['margin','products','import-logistics','pokec']));

drop policy if exists "upgates_product_stock_read_authenticated" on public.upgates_product_stock_daily;
create policy "upgates_product_stock_read_allowed_modules"
on public.upgates_product_stock_daily
for select to authenticated
using (public.app_has_any_module(array['products','import-logistics','pokec']));

alter view if exists public.upgates_product_purchase_prices_current set (security_invoker = true);
alter view if exists public.upgates_product_stock_current set (security_invoker = true);

-- AI/Pokec knowledge.
drop policy if exists "ai_business_contexts_read_authenticated" on public.ai_business_contexts;
create policy "ai_business_contexts_read_pokec_module" on public.ai_business_contexts
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_playbooks_read_authenticated" on public.ai_playbooks;
create policy "ai_playbooks_read_pokec_module" on public.ai_playbooks
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_data_sources_read_authenticated" on public.ai_data_sources;
create policy "ai_data_sources_read_pokec_module" on public.ai_data_sources
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_examples_read_authenticated" on public.ai_examples;
create policy "ai_examples_read_pokec_module" on public.ai_examples
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_memories_read_authenticated" on public.ai_memories;
create policy "ai_memories_read_pokec_module" on public.ai_memories
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_memory_candidates_read_authenticated" on public.ai_memory_candidates;
create policy "ai_memory_candidates_read_pokec_module" on public.ai_memory_candidates
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_memory_candidates_insert_authenticated" on public.ai_memory_candidates;
create policy "ai_memory_candidates_insert_pokec_module" on public.ai_memory_candidates
for insert to authenticated
with check (public.app_has_module('pokec') and review_status = 'pending');

drop policy if exists "ai_meeting_notes_read_authenticated" on public.ai_meeting_notes;
create policy "ai_meeting_notes_read_pokec_module" on public.ai_meeting_notes
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_experiments_read_authenticated" on public.ai_experiments;
create policy "ai_experiments_read_pokec_module" on public.ai_experiments
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_open_questions_read_authenticated" on public.ai_open_questions;
create policy "ai_open_questions_read_pokec_module" on public.ai_open_questions
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_data_quality_issues_read_authenticated" on public.ai_data_quality_issues;
create policy "ai_data_quality_issues_read_pokec_module" on public.ai_data_quality_issues
for select to authenticated using (public.app_has_module('pokec'));

drop policy if exists "ai_competitor_observations_read_authenticated" on public.ai_competitor_observations;
create policy "ai_competitor_observations_read_pokec_module" on public.ai_competitor_observations
for select to authenticated using (public.app_has_module('pokec'));
