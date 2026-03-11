-- Ceník nákupních cen (zdroj pravdy pro výpočet marže)
-- Kód produktu → nákupní cena BEZ DPH za 1 kus

create table if not exists public.buy_prices (
  product_code text primary key,
  price_without_vat numeric(12, 2) not null,
  updated_at timestamptz not null default now()
);

-- RLS: přihlášení i anon mohou číst a zapisovat
alter table public.buy_prices enable row level security;

drop policy if exists "buy_prices_read_authenticated" on public.buy_prices;
drop policy if exists "buy_prices_write_authenticated" on public.buy_prices;
drop policy if exists "buy_prices_select" on public.buy_prices;
drop policy if exists "buy_prices_insert" on public.buy_prices;
drop policy if exists "buy_prices_update" on public.buy_prices;
drop policy if exists "buy_prices_delete" on public.buy_prices;

create policy "buy_prices_select"
on public.buy_prices for select to authenticated, anon using (true);

create policy "buy_prices_insert"
on public.buy_prices for insert to authenticated, anon with check (true);

create policy "buy_prices_update"
on public.buy_prices for update to authenticated, anon using (true) with check (true);

create policy "buy_prices_delete"
on public.buy_prices for delete to authenticated, anon using (true);
