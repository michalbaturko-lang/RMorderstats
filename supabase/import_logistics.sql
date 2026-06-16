-- Import logistics for in-transit supplier orders.
--
-- First production slice: current import orders on the way only
-- (Čína 9, Čína 10, Čína 11, Čína 12, Čína 13).

create extension if not exists pgcrypto;

create table if not exists public.import_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_key text not null unique,
  supplier_code integer,
  display_name text not null,
  country text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_product_master (
  id uuid primary key default gen_random_uuid(),
  product_key text not null unique,
  rm_code text,
  ean text,
  title text,
  active_eshop boolean,
  weight_kg numeric(18, 6),
  old_code text,
  source_workbook text,
  source_sheet text not null,
  source_row integer,
  height_mm integer,
  width_mm integer,
  depth_mm integer,
  color text,
  shelf_count integer,
  capacity_kg integer,
  supplier_suffix integer,
  is_corner boolean not null default false,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists import_product_master_rm_code_idx
  on public.import_product_master (rm_code)
  where rm_code is not null and rm_code <> '';

create index if not exists import_product_master_ean_idx
  on public.import_product_master (ean)
  where ean is not null and ean <> '';

create index if not exists import_product_master_fallback_idx
  on public.import_product_master (height_mm, width_mm, depth_mm, shelf_count, supplier_suffix, color, is_corner);

create table if not exists public.import_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  supplier_order_code text,
  source_workbook text not null,
  source_sheet text not null,
  supplier_id uuid references public.import_suppliers(id),
  status text not null default 'navrh'
    check (status in ('navrh', 'objednano', 'shipped', 'v_pristavu', 'naskladneno')),
  ordered_date date,
  shipped_date date,
  eta_brno date,
  total_pcs numeric(18, 6),
  goods_description text,
  shelf_description text,
  audit_status text not null default 'needs_review',
  audit_summary jsonb not null default '{}'::jsonb,
  raw_overview_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_orders
  add column if not exists supplier_order_code text;

create index if not exists import_orders_status_eta_idx
  on public.import_orders (status, eta_brno);

create table if not exists public.import_order_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_key text not null unique,
  order_id uuid not null references public.import_orders(id) on delete cascade,
  shipment_ref text,
  kn_tracking_number text,
  bill_of_lading text,
  commercial_invoice_no text,
  supplier_order_codes text,
  container_no text,
  containers_text text,
  container_count integer check (container_count is null or container_count > 0),
  loading_method text check (loading_method is null or loading_method in ('palletized', 'floor_loaded', 'mixed', 'unknown')),
  palletized boolean,
  loading_summary text,
  loading_photo_count integer not null default 0 check (loading_photo_count >= 0),
  loading_photos jsonb not null default '[]'::jsonb,
  status text not null default 'navrh'
    check (status in ('navrh', 'objednano', 'shipped', 'v_pristavu', 'naskladneno')),
  ordered_date date,
  port_departure_date date,
  shipped_date date,
  eta_port date,
  eta_hamburg date,
  eta_brno date,
  tracking_url text,
  port_of_loading text,
  port_of_transshipment text,
  port_of_discharge text,
  vessel_name text,
  voyage_no text,
  allocated_quantity numeric(18, 6),
  allocated_amount numeric(18, 6),
  allocated_currency text,
  allocation_note text,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_order_shipments
  add column if not exists kn_tracking_number text,
  add column if not exists bill_of_lading text,
  add column if not exists commercial_invoice_no text,
  add column if not exists supplier_order_codes text,
  add column if not exists container_count integer,
  add column if not exists loading_method text,
  add column if not exists palletized boolean,
  add column if not exists loading_summary text,
  add column if not exists loading_photo_count integer not null default 0,
  add column if not exists loading_photos jsonb not null default '[]'::jsonb,
  add column if not exists port_departure_date date,
  add column if not exists eta_hamburg date,
  add column if not exists port_of_loading text,
  add column if not exists port_of_transshipment text,
  add column if not exists port_of_discharge text,
  add column if not exists vessel_name text,
  add column if not exists voyage_no text,
  add column if not exists allocated_quantity numeric(18, 6),
  add column if not exists allocated_amount numeric(18, 6),
  add column if not exists allocated_currency text,
  add column if not exists allocation_note text;

alter table public.import_order_shipments
  drop constraint if exists import_order_shipments_container_count_check,
  add constraint import_order_shipments_container_count_check
    check (container_count is null or container_count > 0),
  drop constraint if exists import_order_shipments_loading_method_check,
  add constraint import_order_shipments_loading_method_check
    check (loading_method is null or loading_method in ('palletized', 'floor_loaded', 'mixed', 'unknown')),
  drop constraint if exists import_order_shipments_loading_photo_count_check,
  add constraint import_order_shipments_loading_photo_count_check
    check (loading_photo_count >= 0);

create index if not exists import_order_shipments_order_idx
  on public.import_order_shipments (order_id, eta_brno);

create table if not exists public.import_order_lines (
  id uuid primary key default gen_random_uuid(),
  line_key text not null unique,
  order_id uuid not null references public.import_orders(id) on delete cascade,
  source_workbook text not null,
  source_sheet text not null,
  source_row integer not null,
  raw_row jsonb not null default '{}'::jsonb,
  spec text,
  rm_code text,
  ean text,
  product_master_id uuid references public.import_product_master(id),
  matched_rm_code text,
  matched_ean text,
  product_title text,
  quantity numeric(18, 6),
  unit_purchase_price numeric(18, 6),
  purchase_currency text,
  height_mm integer,
  width_mm integer,
  depth_mm integer,
  shelf_count integer,
  steel_thickness_mm numeric(8, 4),
  mdf_thickness_mm numeric(8, 4),
  finish text,
  color text,
  capacity text,
  supplier_suffix integer,
  is_corner boolean not null default false,
  match_method text,
  match_confidence numeric(5, 4),
  audit_status text not null default 'review',
  match_reason text,
  match_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_order_lines_order_idx
  on public.import_order_lines (order_id, source_row);

create index if not exists import_order_lines_product_idx
  on public.import_order_lines (product_master_id);

create index if not exists import_order_lines_status_idx
  on public.import_order_lines (audit_status, match_method);

create table if not exists public.import_product_matches (
  id uuid primary key default gen_random_uuid(),
  match_key text not null unique,
  order_line_id uuid not null references public.import_order_lines(id) on delete cascade,
  product_master_id uuid references public.import_product_master(id),
  match_method text not null,
  confidence numeric(5, 4) not null default 0,
  audit_status text not null default 'review',
  reason text,
  candidates jsonb not null default '[]'::jsonb,
  raw_match jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_product_matches_line_idx
  on public.import_product_matches (order_line_id);

create table if not exists public.import_order_documents (
  id uuid primary key default gen_random_uuid(),
  document_key text not null unique,
  order_id uuid not null references public.import_orders(id) on delete cascade,
  shipment_id uuid references public.import_order_shipments(id) on delete set null,
  uploaded_by uuid,
  storage_bucket text not null default 'import-documents',
  file_path text not null,
  file_name text not null,
  content_type text,
  document_type text not null default 'other'
    check (document_type in ('supplier_order', 'supplier_invoice', 'payment_proof', 'supplier_proforma', 'packing_list', 'forwarder_invoice', 'bl_tracking', 'loading_photo', 'other')),
  amount numeric(18, 6),
  currency text,
  document_date date,
  notes text,
  extraction_status text not null default 'not_parsed'
    check (extraction_status in ('not_parsed', 'pending', 'parsed', 'failed')),
  extracted_json jsonb not null default '{}'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_order_documents
  add column if not exists shipment_id uuid references public.import_order_shipments(id) on delete set null;

alter table public.import_order_documents
  drop constraint if exists import_order_documents_document_type_check,
  add constraint import_order_documents_document_type_check
    check (document_type in ('supplier_order', 'supplier_invoice', 'payment_proof', 'supplier_proforma', 'packing_list', 'forwarder_invoice', 'bl_tracking', 'loading_photo', 'other'));

create index if not exists import_order_documents_order_idx
  on public.import_order_documents (order_id, document_type, document_date desc);

create index if not exists import_order_documents_shipment_idx
  on public.import_order_documents (shipment_id, document_type);

create table if not exists public.import_order_costs (
  id uuid primary key default gen_random_uuid(),
  cost_key text not null unique,
  order_id uuid not null references public.import_orders(id) on delete cascade,
  document_id uuid references public.import_order_documents(id) on delete set null,
  cost_type text not null default 'freight'
    check (cost_type in ('goods', 'freight', 'forwarder', 'storage', 'other')),
  amount numeric(18, 6) not null,
  currency text not null default 'CZK',
  amount_czk numeric(18, 6),
  allocation_method text not null default 'by_product_value'
    check (allocation_method in ('by_product_value', 'manual', 'none')),
  notes text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_order_costs_order_idx
  on public.import_order_costs (order_id, cost_type);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-documents',
  'import-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.apple.numbers',
    'application/x-iwork-numbers-sffnumbers',
    'text/csv',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop view if exists public.import_orders_on_the_way;

create or replace view public.import_orders_on_the_way
with (security_invoker = true) as
select
  o.id,
  o.order_code,
  o.supplier_order_code,
  o.source_workbook,
  o.source_sheet,
  o.status,
  o.ordered_date,
  coalesce(
    min(coalesce(sh.port_departure_date, sh.shipped_date)) filter (where coalesce(sh.port_departure_date, sh.shipped_date) is not null),
    o.shipped_date
  ) as shipped_date,
  min(coalesce(sh.eta_port, sh.eta_hamburg)) filter (where coalesce(sh.eta_port, sh.eta_hamburg) is not null) as eta_port,
  coalesce(
    min(sh.eta_brno) filter (where sh.eta_brno is not null),
    o.eta_brno
  ) as eta_brno,
  o.total_pcs,
  o.goods_description,
  o.shelf_description,
  o.audit_status,
  o.audit_summary,
  s.display_name as supplier_name,
  s.supplier_code,
  count(distinct sh.id) as shipment_count,
  string_agg(distinct nullif(sh.containers_text, ''), ' / ') as containers,
  (
    select coalesce(sum(sh2.container_count), 0)::integer
    from public.import_order_shipments sh2
    where sh2.order_id = o.id
  ) as container_count,
  (
    select string_agg(
      distinct nullif(
        case when sh2.loading_method is not null then concat_ws(
            ': ',
            sh2.shipment_ref,
            case
              when sh2.loading_method = 'palletized' then 'na paletách'
              when sh2.loading_method = 'floor_loaded' then 'bez palet'
              when sh2.loading_method = 'mixed' then 'mix palet a volně loženého zboží'
              when sh2.loading_method = 'unknown' then 'naložení neznámé'
              else null
            end
          ) end,
        ''
      ),
      ' / '
    )
    from public.import_order_shipments sh2
    where sh2.order_id = o.id
  ) as container_loading,
  (
    select coalesce(sum(sh2.loading_photo_count), 0)::integer
    from public.import_order_shipments sh2
    where sh2.order_id = o.id
  ) as loading_photo_count,
  string_agg(distinct nullif(coalesce(sh.kn_tracking_number, sh.shipment_ref), ''), ', ') as kn_tracking_numbers,
  string_agg(distinct nullif(coalesce(sh.bill_of_lading, sh.kn_tracking_number), ''), ', ') as bill_of_lading_numbers,
  string_agg(distinct nullif(sh.commercial_invoice_no, ''), ', ') as commercial_invoice_numbers,
  count(distinct l.id) as line_count,
  count(distinct l.id) filter (where l.product_master_id is not null) as matched_line_count,
  count(distinct l.id) filter (where l.audit_status = 'review') as review_line_count,
  count(distinct l.id) filter (where l.quantity is null) as qty_unknown_line_count,
  count(distinct l.id) filter (where l.unit_purchase_price is null) as missing_price_line_count,
  count(distinct d.id) as document_count,
  round(
    case when count(distinct l.id) = 0 then 0
      else (count(distinct l.id) filter (where l.product_master_id is not null)::numeric / count(distinct l.id)::numeric) * 100
    end,
    2
  ) as matched_pct,
  (
    select sum(
      l2.quantity * l2.unit_purchase_price * case upper(coalesce(nullif(l2.purchase_currency, ''), 'CZK'))
        when 'CZK' then 1::numeric
        when 'EUR' then 24.258970358814352::numeric
        when 'USD' then 20.958::numeric
        when 'HUF' then 0.06822999099587825::numeric
        when 'RON' then 4.630859745682293::numeric
        else null::numeric
      end
    )
    from public.import_order_lines l2
    where l2.order_id = o.id
      and l2.quantity is not null
      and l2.unit_purchase_price is not null
  ) as goods_value_czk,
  (
    select coalesce(jsonb_object_agg(currency, total_amount), '{}'::jsonb)
    from (
      select
        upper(coalesce(nullif(l3.purchase_currency, ''), 'CZK')) as currency,
        sum(l3.quantity * l3.unit_purchase_price) as total_amount
      from public.import_order_lines l3
      where l3.order_id = o.id
        and l3.quantity is not null
        and l3.unit_purchase_price is not null
      group by upper(coalesce(nullif(l3.purchase_currency, ''), 'CZK'))
    ) currency_totals
  ) as goods_value_by_currency
from public.import_orders o
left join public.import_suppliers s on s.id = o.supplier_id
left join public.import_order_shipments sh on sh.order_id = o.id
left join public.import_order_lines l on l.order_id = o.id
left join public.import_order_documents d on d.order_id = o.id
where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu')
group by o.id, s.id;

create or replace view public.import_order_lines_detail
with (security_invoker = true) as
select
  l.*,
  o.order_code,
  o.eta_brno,
  o.status as order_status,
  pm.rm_code as master_rm_code,
  pm.ean as master_ean,
  pm.title as master_title,
  pm.active_eshop as master_active_eshop,
  pm.weight_kg as master_weight_kg,
  pm.old_code as master_old_code,
  pm.source_sheet as master_source_sheet,
  pm.source_row as master_source_row
from public.import_order_lines l
join public.import_orders o on o.id = l.order_id
left join public.import_product_master pm on pm.id = l.product_master_id
where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu');

drop view if exists public.import_logistics_order_overview;
drop view if exists public.import_logistics_document_coverage;

create or replace view public.import_logistics_document_coverage
with (security_invoker = true) as
select
  o.id as import_order_id,
  o.order_code as order_name,
  o.source_sheet,
  coalesce(bool_or(d.document_type = 'supplier_invoice'), false) as has_supplier_invoice,
  coalesce(bool_or(d.document_type = 'payment_proof'), false) as has_payment_proof,
  coalesce(bool_or(d.document_type = 'supplier_proforma'), false) as has_supplier_proforma,
  coalesce(bool_or(d.document_type = 'packing_list'), false) as has_packing_list,
  coalesce(bool_or(d.document_type = 'forwarder_invoice'), false) as has_kn_invoice,
  coalesce(bool_or(d.document_type = 'bl_tracking'), false) as has_bl_tracking,
  coalesce(bool_or(d.document_type = 'loading_photo'), false) as has_loading_photos,
  count(d.id) filter (where d.document_type = 'loading_photo') as loading_photo_count,
  array_remove(array[
    case when not coalesce(bool_or(d.document_type = 'supplier_order'), false) then 'supplier_order' end,
    case when not coalesce(bool_or(d.document_type = 'supplier_invoice'), false) then 'supplier_invoice' end,
    case when not coalesce(bool_or(d.document_type = 'payment_proof'), false) then 'payment_proof' end,
    case when not coalesce(bool_or(d.document_type = 'supplier_proforma'), false) then 'supplier_proforma' end,
    case when not coalesce(bool_or(d.document_type = 'packing_list'), false) then 'packing_list' end,
    case when not coalesce(bool_or(d.document_type = 'forwarder_invoice'), false) then 'kn_invoice' end,
    case when not coalesce(bool_or(d.document_type = 'bl_tracking'), false) then 'bl_tracking' end
  ]::text[], null) as missing_docs,
  case
    when count(d.id) filter (where d.document_type <> 'loading_photo') = 0 then 'no_documents'
    when bool_or(d.extraction_status = 'failed') filter (where d.document_type <> 'loading_photo') then 'failed'
    when bool_or(d.extraction_status in ('not_parsed', 'pending')) filter (where d.document_type <> 'loading_photo') then 'needs_parsing'
    else 'parsed'
  end as parsed_status,
  count(d.id) filter (where d.document_type <> 'loading_photo') as document_count,
  jsonb_object_agg(d.document_type, d.extraction_status) filter (where d.id is not null and d.document_type <> 'loading_photo') as extraction_status_by_type,
  max(d.created_at) as latest_document_uploaded_at,
  coalesce(bool_or(d.document_type = 'supplier_order'), false) as has_supplier_order
from public.import_orders o
left join public.import_order_documents d on d.order_id = o.id
where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu')
group by o.id;

drop view if exists public.import_logistics_order_overview;

create or replace view public.import_logistics_order_overview
with (security_invoker = true) as
with shipment_summary as (
  select
    order_id,
    count(*) as shipment_count,
    min(eta_port) filter (where eta_port is not null) as eta_port,
    min(eta_hamburg) filter (where eta_hamburg is not null) as eta_hamburg,
    min(eta_brno) filter (where eta_brno is not null) as eta_brno,
    min(coalesce(port_departure_date, shipped_date)) filter (where coalesce(port_departure_date, shipped_date) is not null) as shipped_date,
    string_agg(distinct nullif(container_no, ''), ', ') as container_numbers,
    string_agg(distinct nullif(containers_text, ''), ' / ') as containers_text,
    coalesce(sum(container_count), 0)::integer as container_count,
    string_agg(
      distinct nullif(
        case
          when loading_method = 'palletized' then 'na paletách'
          when loading_method = 'floor_loaded' then 'bez palet'
          when loading_method = 'mixed' then 'mix palet a volně loženého zboží'
          when loading_method = 'unknown' then 'naložení neznámé'
          else null
        end,
        ''
      ),
      ' / '
    ) as container_loading,
    coalesce(sum(loading_photo_count), 0)::integer as loading_photo_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'shipment_ref', shipment_ref,
          'containers_text', containers_text,
          'container_count', container_count,
          'loading_method', loading_method,
          'palletized', palletized,
          'loading_summary', loading_summary,
          'loading_photo_count', loading_photo_count
        )
        order by eta_brno nulls last, shipment_ref
      ) filter (where loading_method is not null or loading_summary is not null),
      '[]'::jsonb
    ) as container_loading_details,
    string_agg(distinct nullif(kn_tracking_number, ''), ', ') as kn_tracking_numbers,
    string_agg(distinct nullif(coalesce(bill_of_lading, kn_tracking_number), ''), ', ') as bill_of_lading_numbers,
    string_agg(distinct nullif(commercial_invoice_no, ''), ', ') as commercial_invoice_numbers,
    string_agg(distinct nullif(vessel_name, ''), ', ') as vessel_names,
    string_agg(distinct nullif(port_of_discharge, ''), ', ') as discharge_ports
  from public.import_order_shipments
  group by order_id
),
line_summary as (
  select
    order_id,
    count(*) as line_count,
    sum(quantity) filter (where quantity is not null) as total_qty,
    count(*) filter (where product_master_id is not null) as matched_line_count,
    count(*) filter (where audit_status = 'review' or product_master_id is null) as review_line_count,
    count(*) filter (where quantity is null) as qty_unknown_line_count,
    count(*) filter (where unit_purchase_price is null) as missing_price_line_count,
    round(
      case when count(*) = 0 then 0
        else (count(*) filter (where product_master_id is not null)::numeric / count(*)::numeric) * 100
      end,
      2
    ) as matched_pct
  from public.import_order_lines
  group by order_id
),
line_value_summary as (
  select
    order_id,
    sum(total_amount_czk) as goods_value_czk,
    coalesce(jsonb_object_agg(currency, total_amount), '{}'::jsonb) as goods_value_by_currency
  from (
    select
      order_id,
      upper(coalesce(nullif(purchase_currency, ''), 'CZK')) as currency,
      sum(quantity * unit_purchase_price) as total_amount,
      sum(
        quantity * unit_purchase_price * case upper(coalesce(nullif(purchase_currency, ''), 'CZK'))
          when 'CZK' then 1::numeric
          when 'EUR' then 24.258970358814352::numeric
          when 'USD' then 20.958::numeric
          when 'HUF' then 0.06822999099587825::numeric
          when 'RON' then 4.630859745682293::numeric
          else null::numeric
        end
      ) as total_amount_czk
    from public.import_order_lines
    where quantity is not null
      and unit_purchase_price is not null
    group by order_id, upper(coalesce(nullif(purchase_currency, ''), 'CZK'))
  ) currency_totals
  group by order_id
),
cost_summary as (
  select
    order_id,
    count(*) filter (where cost_type in ('freight', 'forwarder')) as freight_cost_count,
    sum(coalesce(amount_czk, case when upper(currency) = 'CZK' then amount end))
      filter (where cost_type in ('freight', 'forwarder')) as freight_cost_czk
  from public.import_order_costs
  group by order_id
)
select
  o.id as import_order_id,
  o.order_code as order_name,
  o.supplier_order_code,
  o.source_workbook,
  o.source_sheet,
  s.display_name as supplier,
  s.supplier_code,
  o.status,
  coalesce(sh.shipped_date, o.shipped_date) as shipped_date,
  coalesce(sh.eta_hamburg, sh.eta_port) as eta_port,
  sh.eta_hamburg,
  coalesce(sh.eta_brno, o.eta_brno) as eta_brno,
  coalesce(sh.container_numbers, sh.containers_text, '') as containers,
  coalesce(sh.container_count, 0) as container_count,
  coalesce(sh.container_loading, '') as container_loading,
  coalesce(sh.loading_photo_count, 0) as loading_photo_count,
  coalesce(sh.container_loading_details, '[]'::jsonb) as container_loading_details,
  coalesce(sh.kn_tracking_numbers, '') as kn_tracking_numbers,
  coalesce(sh.bill_of_lading_numbers, '') as bill_of_lading_numbers,
  coalesce(sh.commercial_invoice_numbers, '') as commercial_invoice_numbers,
  coalesce(sh.vessel_names, '') as vessel_names,
  coalesce(sh.discharge_ports, '') as discharge_ports,
  coalesce(sh.shipment_count, 0) as shipment_count,
  coalesce(o.total_pcs, ls.total_qty) as total_qty,
  lvs.goods_value_czk,
  coalesce(lvs.goods_value_by_currency, '{}'::jsonb) as goods_value_by_currency,
  coalesce(ls.line_count, 0) as line_count,
  coalesce(ls.matched_line_count, 0) as matched_line_count,
  coalesce(ls.review_line_count, 0) as review_line_count,
  coalesce(ls.qty_unknown_line_count, 0) as qty_unknown_line_count,
  coalesce(ls.missing_price_line_count, 0) as missing_prices,
  coalesce(ls.matched_pct, 0) as matched_pct,
  jsonb_build_object(
    'has_supplier_order', coalesce(dc.has_supplier_order, false),
    'has_supplier_invoice', coalesce(dc.has_supplier_invoice, false),
    'has_payment_proof', coalesce(dc.has_payment_proof, false),
    'has_supplier_proforma', coalesce(dc.has_supplier_proforma, false),
    'has_packing_list', coalesce(dc.has_packing_list, false),
    'has_kn_invoice', coalesce(dc.has_kn_invoice, false),
    'has_bl_tracking', coalesce(dc.has_bl_tracking, false),
    'has_loading_photos', coalesce(dc.has_loading_photos, false),
    'loading_photo_count', coalesce(dc.loading_photo_count, 0),
    'missing_docs', coalesce(to_jsonb(dc.missing_docs), '[]'::jsonb),
    'parsed_status', coalesce(dc.parsed_status, 'no_documents')
  ) as docs_coverage,
  coalesce(dc.missing_docs, array[]::text[]) as missing_docs,
  coalesce(cs.freight_cost_count, 0) as freight_cost_count,
  coalesce(cs.freight_cost_czk, 0) as freight_cost_czk,
  (coalesce(cs.freight_cost_count, 0) = 0) as missing_freight_cost,
  0::integer as risk_count,
  o.audit_status,
  o.audit_summary,
  o.updated_at
from public.import_orders o
left join public.import_suppliers s on s.id = o.supplier_id
left join shipment_summary sh on sh.order_id = o.id
left join line_summary ls on ls.order_id = o.id
left join line_value_summary lvs on lvs.order_id = o.id
left join cost_summary cs on cs.order_id = o.id
left join public.import_logistics_document_coverage dc on dc.import_order_id = o.id
where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu');

create or replace view public.import_logistics_match_gaps
with (security_invoker = true) as
select
  l.id as import_order_line_id,
  o.id as import_order_id,
  o.order_code as order_name,
  o.source_sheet,
  l.source_row,
  coalesce(nullif(l.spec, ''), l.raw_row ->> 'spec', l.raw_row ->> 'description', l.raw_row::text) as raw_spec,
  greatest(
    case when jsonb_typeof(l.match_candidates) = 'array' then jsonb_array_length(l.match_candidates) else 0 end,
    case when jsonb_typeof(pm.candidates) = 'array' then jsonb_array_length(pm.candidates) else 0 end
  ) as candidate_count,
  case
    when l.product_master_id is null then 'unmatched'
    when l.audit_status = 'review' then 'ambiguous'
    else l.audit_status
  end as match_status,
  coalesce(nullif(l.match_reason, ''), pm.reason, 'requires_review') as reason,
  coalesce(nullif(l.match_method, ''), pm.match_method, 'unknown') as match_method,
  l.match_confidence,
  coalesce(l.match_candidates, pm.candidates, '[]'::jsonb) as candidates,
  l.raw_row
from public.import_order_lines l
join public.import_orders o on o.id = l.order_id
left join lateral (
  select
    m.reason,
    m.match_method,
    m.candidates
  from public.import_product_matches m
  where m.order_line_id = l.id
  order by m.confidence desc nulls last, m.created_at desc
  limit 1
) pm on true
where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu')
  and (
    l.product_master_id is null
    or l.audit_status = 'review'
  );

drop view if exists public.import_logistics_landed_cost_changes;

create or replace view public.import_logistics_landed_cost_changes
with (security_invoker = true) as
with freight_by_order as (
  select
    order_id,
    sum(coalesce(amount_czk, case when upper(currency) = 'CZK' then amount end))
      filter (where cost_type in ('freight', 'forwarder')) as total_freight_czk,
    count(*) filter (where cost_type in ('freight', 'forwarder')) as freight_cost_count
  from public.import_order_costs
  group by order_id
),
line_raw as (
  select
    l.id as import_order_line_id,
    o.id as import_order_id,
    o.order_code as order_name,
    s.display_name as supplier,
    o.eta_brno,
    coalesce(nullif(l.matched_rm_code, ''), nullif(pm.rm_code, ''), nullif(l.rm_code, '')) as sku,
    coalesce(nullif(l.matched_ean, ''), nullif(pm.ean, ''), nullif(l.ean, '')) as ean,
    coalesce(nullif(l.product_title, ''), pm.title) as title,
    l.quantity,
    l.unit_purchase_price as import_unit_cost,
    upper(coalesce(nullif(l.purchase_currency, ''), 'CZK')) as purchase_currency,
    case upper(coalesce(nullif(l.purchase_currency, ''), 'CZK'))
      when 'CZK' then 1::numeric
      when 'EUR' then 24.258970358814352::numeric
      when 'USD' then 20.958::numeric
      when 'HUF' then 0.06822999099587825::numeric
      when 'RON' then 4.630859745682293::numeric
      else null::numeric
    end as purchase_fx_to_czk
  from public.import_order_lines l
  join public.import_orders o on o.id = l.order_id
  left join public.import_suppliers s on s.id = o.supplier_id
  left join public.import_product_master pm on pm.id = l.product_master_id
  where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu')
),
line_base as (
  select
    line_raw.*,
    case
      when import_unit_cost is not null and purchase_fx_to_czk is not null
        then import_unit_cost * purchase_fx_to_czk
    end as import_unit_cost_czk,
    coalesce(quantity, 0) * coalesce(
      case
        when import_unit_cost is not null and purchase_fx_to_czk is not null
          then import_unit_cost * purchase_fx_to_czk
      end,
      0
    ) as line_goods_value,
    sum(
      coalesce(quantity, 0) * coalesce(
        case
          when import_unit_cost is not null and purchase_fx_to_czk is not null
            then import_unit_cost * purchase_fx_to_czk
        end,
        0
      )
    ) over (partition by import_order_id) as total_goods_value
  from line_raw
)
select
  lb.import_order_line_id,
  lb.import_order_id,
  lb.order_name,
  lb.supplier,
  lb.eta_brno,
  lb.sku,
  lb.ean,
  coalesce(lb.title, up.title) as title,
  lb.quantity,
  up.market as current_upgates_market,
  up.currency as current_upgates_currency,
  coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end) as current_upgates_nc,
  lb.import_unit_cost,
  lb.purchase_currency,
  lb.purchase_fx_to_czk,
  lb.import_unit_cost_czk,
  fb.total_freight_czk as total_freight,
  case
    when lb.total_goods_value > 0 and lb.line_goods_value > 0 and fb.total_freight_czk is not null
      then fb.total_freight_czk * (lb.line_goods_value / lb.total_goods_value)
  end as allocated_freight,
  case
    when lb.total_goods_value > 0 and lb.line_goods_value > 0 and lb.quantity > 0 and fb.total_freight_czk is not null
      then (fb.total_freight_czk * (lb.line_goods_value / lb.total_goods_value)) / lb.quantity
  end as allocated_freight_per_unit,
  case
    when lb.import_unit_cost_czk is not null
      and coalesce(fb.freight_cost_count, 0) > 0
      and fb.total_freight_czk is not null
      then lb.import_unit_cost_czk + coalesce(
        case
          when lb.total_goods_value > 0 and lb.line_goods_value > 0 and lb.quantity > 0 and fb.total_freight_czk is not null
            then (fb.total_freight_czk * (lb.line_goods_value / lb.total_goods_value)) / lb.quantity
        end,
        0
      )
  end as landed_unit_cost,
  case
    when lb.import_unit_cost_czk is not null
      and coalesce(fb.freight_cost_count, 0) > 0
      and fb.total_freight_czk is not null
      and coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end) is not null
      then (
        lb.import_unit_cost_czk + coalesce(
          case
            when lb.total_goods_value > 0 and lb.line_goods_value > 0 and lb.quantity > 0 and fb.total_freight_czk is not null
              then (fb.total_freight_czk * (lb.line_goods_value / lb.total_goods_value)) / lb.quantity
          end,
          0
        )
      ) - coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end)
  end as delta_abs,
  case
    when lb.import_unit_cost_czk is not null
      and coalesce(fb.freight_cost_count, 0) > 0
      and fb.total_freight_czk is not null
      and coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end) > 0
      then (
        (
          lb.import_unit_cost_czk + coalesce(
            case
              when lb.total_goods_value > 0 and lb.line_goods_value > 0 and lb.quantity > 0 and fb.total_freight_czk is not null
                then (fb.total_freight_czk * (lb.line_goods_value / lb.total_goods_value)) / lb.quantity
            end,
            0
          )
        ) - coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end)
      ) / coalesce(up.purchase_price_czk, case when upper(up.currency) = 'CZK' then up.purchase_price_without_vat_native end) * 100
  end as delta_pct,
  (lb.import_unit_cost is null) as missing_import_price,
  (lb.import_unit_cost is not null and lb.import_unit_cost_czk is null) as missing_fx_rate,
  (coalesce(fb.freight_cost_count, 0) = 0) as missing_freight_cost
from line_base lb
left join freight_by_order fb on fb.order_id = lb.import_order_id
left join lateral (
  select
    p.product_code,
    p.market,
    p.currency,
    p.purchase_price_without_vat_native,
    p.purchase_price_czk,
    p.stock_quantity,
    p.title
  from public.upgates_product_purchase_prices_current p
  where lb.sku is not null
    and upper(p.product_code) = upper(lb.sku)
  order by case when p.market = 'cz' then 0 else 1 end, p.snapshot_date desc nulls last, p.fetched_at desc nulls last
  limit 1
) up on true;

create or replace view public.import_logistics_sku_risk
with (security_invoker = true) as
with shipment_eta as (
  select
    order_id,
    min(eta_brno) filter (where eta_brno is not null) as eta_brno
  from public.import_order_shipments
  group by order_id
),
inbound as (
  select
    coalesce(nullif(l.matched_rm_code, ''), nullif(pm.rm_code, ''), nullif(l.rm_code, '')) as sku,
    coalesce(nullif(l.matched_ean, ''), nullif(pm.ean, ''), nullif(l.ean, '')) as ean,
    coalesce(nullif(l.product_title, ''), pm.title) as title,
    sum(l.quantity) filter (where l.quantity is not null) as inbound_qty,
    min(coalesce(sh.eta_brno, o.eta_brno)) filter (where coalesce(sh.eta_brno, o.eta_brno) is not null) as nearest_eta,
    array_agg(distinct o.order_code order by o.order_code) as inbound_orders,
    count(*) filter (where l.quantity is null) as qty_unknown_line_count
  from public.import_order_lines l
  join public.import_orders o on o.id = l.order_id
  left join shipment_eta sh on sh.order_id = o.id
  left join public.import_product_master pm on pm.id = l.product_master_id
  where o.status in ('navrh', 'objednano', 'shipped', 'v_pristavu')
    and coalesce(nullif(l.matched_rm_code, ''), nullif(pm.rm_code, ''), nullif(l.rm_code, '')) is not null
  group by
    coalesce(nullif(l.matched_rm_code, ''), nullif(pm.rm_code, ''), nullif(l.rm_code, '')),
    coalesce(nullif(l.matched_ean, ''), nullif(pm.ean, ''), nullif(l.ean, '')),
    coalesce(nullif(l.product_title, ''), pm.title)
),
deduped_orders as (
  select *
  from (
    select
      o.*,
      row_number() over (
        partition by coalesce(o.raw_data ->> 'order_number', o.raw_data ->> 'number', o.id::text)
        order by o.order_date desc nulls last, o.created_at desc nulls last, o.id::text desc
      ) as row_number
    from public.orders o
  ) ranked
  where ranked.row_number = 1
),
clean_order_items as (
  select
    upper(coalesce(nullif(oi.product_code, ''), nullif(oi.sku, ''))) as sku,
    nullif(oi.ean, '') as ean,
    lower(coalesce(o.market, o.raw_data ->> 'language_id', 'unknown')) as market,
    o.order_date::date as order_date,
    coalesce(oi.quantity, 0) as quantity
  from deduped_orders o
  join public.order_items oi on oi.order_id = o.id
  where o.order_date is not null
    and o.order_date::date >= current_date - interval '30 days'
    and coalesce(upper(o.status), '') not like '%STORNO%'
    and coalesce(upper(o.status), '') not like '%SELHAL%'
    and coalesce(upper(o.raw_data ->> 'status'), '') not like '%STORNO%'
    and coalesce(upper(o.raw_data ->> 'status'), '') not like '%SELHAL%'
),
velocity as (
  select
    i.sku,
    round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.order_date >= current_date - interval '6 days'), 0) / 7.0, 4) as velocity_7d,
    round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.order_date >= current_date - interval '13 days'), 0) / 14.0, 4) as velocity_14d,
    round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.order_date >= current_date - interval '29 days'), 0) / 30.0, 4) as velocity_30d,
    jsonb_build_object(
      'cz', jsonb_build_object(
        'velocity_7d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'cz' and c.order_date >= current_date - interval '6 days'), 0) / 7.0, 4),
        'velocity_14d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'cz' and c.order_date >= current_date - interval '13 days'), 0) / 14.0, 4),
        'velocity_30d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'cz' and c.order_date >= current_date - interval '29 days'), 0) / 30.0, 4)
      ),
      'sk', jsonb_build_object(
        'velocity_7d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'sk' and c.order_date >= current_date - interval '6 days'), 0) / 7.0, 4),
        'velocity_14d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'sk' and c.order_date >= current_date - interval '13 days'), 0) / 14.0, 4),
        'velocity_30d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'sk' and c.order_date >= current_date - interval '29 days'), 0) / 30.0, 4)
      ),
      'hu', jsonb_build_object(
        'velocity_7d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'hu' and c.order_date >= current_date - interval '6 days'), 0) / 7.0, 4),
        'velocity_14d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'hu' and c.order_date >= current_date - interval '13 days'), 0) / 14.0, 4),
        'velocity_30d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'hu' and c.order_date >= current_date - interval '29 days'), 0) / 30.0, 4)
      ),
      'ro', jsonb_build_object(
        'velocity_7d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'ro' and c.order_date >= current_date - interval '6 days'), 0) / 7.0, 4),
        'velocity_14d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'ro' and c.order_date >= current_date - interval '13 days'), 0) / 14.0, 4),
        'velocity_30d', round(coalesce(sum(coalesce(c.quantity, 0)) filter (where c.market = 'ro' and c.order_date >= current_date - interval '29 days'), 0) / 30.0, 4)
      )
    ) as velocity_by_market
  from inbound i
  left join clean_order_items c
    on (
      c.sku = upper(i.sku)
      or (i.ean is not null and c.ean = i.ean)
    )
  group by i.sku
),
risk_base as (
  select
    i.sku,
    i.ean,
    coalesce(i.title, up.title) as title,
    up.stock_quantity as current_stock,
    i.inbound_qty,
    i.nearest_eta,
    i.inbound_orders,
    coalesce(v.velocity_7d, 0) as velocity_7d,
    coalesce(v.velocity_14d, 0) as velocity_14d,
    coalesce(v.velocity_30d, 0) as velocity_30d,
    coalesce(v.velocity_by_market, '{}'::jsonb) as velocity_by_market,
    i.qty_unknown_line_count,
    (up.stock_quantity is null) as missing_stock,
    (coalesce(v.velocity_7d, 0) = 0 and coalesce(v.velocity_14d, 0) = 0 and coalesce(v.velocity_30d, 0) = 0) as missing_velocity
  from inbound i
  left join velocity v on v.sku = i.sku
  left join lateral (
    select
      (max(p.stock_quantity) filter (where p.stock_quantity is not null))::numeric(18, 6) as stock_quantity,
      max(p.title) as title
    from public.upgates_product_stock_current p
    where upper(p.product_code) = upper(i.sku)
      or (i.ean is not null and p.ean = i.ean)
  ) up on true
)
select
  rb.sku,
  rb.ean,
  rb.title,
  rb.current_stock,
  rb.inbound_qty,
  rb.nearest_eta,
  rb.inbound_orders,
  rb.velocity_7d,
  rb.velocity_14d,
  rb.velocity_30d,
  rb.velocity_by_market,
  forecast.forecast_stockout_date,
  (forecast.forecast_stockout_date is not null and rb.nearest_eta is not null and forecast.forecast_stockout_date < rb.nearest_eta) as stockout_before_eta,
  rb.qty_unknown_line_count,
  rb.missing_stock,
  rb.missing_velocity
from risk_base rb
left join lateral (
  select min((current_date + (days.day_offset::integer))::date) as forecast_stockout_date
  from generate_series(0, 365) as days(day_offset)
  where rb.current_stock is not null
    and rb.nearest_eta is not null
    and coalesce(rb.inbound_qty, 0) > 0
    and rb.velocity_30d > 0
    and (
      rb.current_stock
      + case when rb.nearest_eta <= (current_date + (days.day_offset::integer))::date then rb.inbound_qty else 0 end
      - (
        select sum(rb.velocity_30d * power(1.2, demand_days.demand_day / 30.0))
        from generate_series(0, days.day_offset::integer) as demand_days(demand_day)
      )
    ) < 0
) forecast on true;

revoke all on public.import_suppliers from anon;
revoke all on public.import_product_master from anon;
revoke all on public.import_orders from anon;
revoke all on public.import_order_shipments from anon;
revoke all on public.import_order_lines from anon;
revoke all on public.import_product_matches from anon;
revoke all on public.import_order_documents from anon;
revoke all on public.import_order_costs from anon;
revoke all on public.import_orders_on_the_way from anon;
revoke all on public.import_order_lines_detail from anon;
revoke all on public.import_logistics_order_overview from anon;
revoke all on public.import_logistics_sku_risk from anon;
revoke all on public.import_logistics_landed_cost_changes from anon;
revoke all on public.import_logistics_match_gaps from anon;
revoke all on public.import_logistics_document_coverage from anon;

grant select on public.import_suppliers to authenticated;
grant select on public.import_product_master to authenticated;
grant select on public.import_orders to authenticated;
grant select on public.import_order_shipments to authenticated;
grant select on public.import_order_lines to authenticated;
grant select on public.import_product_matches to authenticated;
grant select on public.import_order_documents to authenticated;
grant select on public.import_order_costs to authenticated;
grant select on public.import_orders_on_the_way to authenticated;
grant select on public.import_order_lines_detail to authenticated;
grant select on public.import_logistics_order_overview to authenticated;
grant select on public.import_logistics_sku_risk to authenticated;
grant select on public.import_logistics_landed_cost_changes to authenticated;
grant select on public.import_logistics_match_gaps to authenticated;
grant select on public.import_logistics_document_coverage to authenticated;

alter table public.import_suppliers enable row level security;
alter table public.import_product_master enable row level security;
alter table public.import_orders enable row level security;
alter table public.import_order_shipments enable row level security;
alter table public.import_order_lines enable row level security;
alter table public.import_product_matches enable row level security;
alter table public.import_order_documents enable row level security;
alter table public.import_order_costs enable row level security;

drop policy if exists "import_suppliers_read_authenticated" on public.import_suppliers;
create policy "import_suppliers_read_authenticated"
  on public.import_suppliers for select to authenticated using (true);

drop policy if exists "import_product_master_read_authenticated" on public.import_product_master;
create policy "import_product_master_read_authenticated"
  on public.import_product_master for select to authenticated using (true);

drop policy if exists "import_orders_read_authenticated" on public.import_orders;
create policy "import_orders_read_authenticated"
  on public.import_orders for select to authenticated using (true);

drop policy if exists "import_order_shipments_read_authenticated" on public.import_order_shipments;
create policy "import_order_shipments_read_authenticated"
  on public.import_order_shipments for select to authenticated using (true);

drop policy if exists "import_order_lines_read_authenticated" on public.import_order_lines;
create policy "import_order_lines_read_authenticated"
  on public.import_order_lines for select to authenticated using (true);

drop policy if exists "import_product_matches_read_authenticated" on public.import_product_matches;
create policy "import_product_matches_read_authenticated"
  on public.import_product_matches for select to authenticated using (true);

drop policy if exists "import_order_documents_read_authenticated" on public.import_order_documents;
create policy "import_order_documents_read_authenticated"
  on public.import_order_documents for select to authenticated using (true);

drop policy if exists "import_order_costs_read_authenticated" on public.import_order_costs;
create policy "import_order_costs_read_authenticated"
  on public.import_order_costs for select to authenticated using (true);
