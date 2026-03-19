create extension if not exists pgcrypto;

create table if not exists public.finance_state (
  user_email text primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_state_set_updated_at on public.finance_state;
create trigger finance_state_set_updated_at
before update on public.finance_state
for each row execute function public.set_updated_at_timestamp();

alter table public.finance_state enable row level security;

drop policy if exists "finance_state_read_allowed_users" on public.finance_state;
create policy "finance_state_read_allowed_users"
on public.finance_state
for select
to authenticated
using (
  auth.jwt() ->> 'email' in ('michal.baturko@regalmaster.cz', 'kristyna.vencel@regalmaster.cz')
);

drop policy if exists "finance_state_insert_allowed_users" on public.finance_state;
create policy "finance_state_insert_allowed_users"
on public.finance_state
for insert
to authenticated
with check (
  auth.jwt() ->> 'email' in ('michal.baturko@regalmaster.cz', 'kristyna.vencel@regalmaster.cz')
);

drop policy if exists "finance_state_update_allowed_users" on public.finance_state;
create policy "finance_state_update_allowed_users"
on public.finance_state
for update
to authenticated
using (
  auth.jwt() ->> 'email' in ('michal.baturko@regalmaster.cz', 'kristyna.vencel@regalmaster.cz')
)
with check (
  auth.jwt() ->> 'email' in ('michal.baturko@regalmaster.cz', 'kristyna.vencel@regalmaster.cz')
);
