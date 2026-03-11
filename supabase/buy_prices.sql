-- Ceník nákupních cen (zdroj pravdy pro výpočet marže)
-- Kód produktu → nákupní cena BEZ DPH za 1 kus

create table if not exists public.buy_prices (
  product_code text primary key,
  price_without_vat numeric(12, 2) not null,
  updated_at timestamptz not null default now()
);

-- RLS: jen přihlášení uživatelé mohou číst a zapisovat
alter table public.buy_prices enable row level security;

drop policy if exists "buy_prices_read_authenticated" on public.buy_prices;
create policy "buy_prices_read_authenticated"
on public.buy_prices
for select
to authenticated
using (true);

drop policy if exists "buy_prices_write_authenticated" on public.buy_prices;
create policy "buy_prices_write_authenticated"
on public.buy_prices
for all
to authenticated
using (true)
with check (true);
