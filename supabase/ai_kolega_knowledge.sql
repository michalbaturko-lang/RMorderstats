-- Knowledge layer for the Regal Master "Pokec" AI colleague.
-- This schema stores business context, playbooks, examples, memories and eval
-- fixtures. It is intentionally separate from operational business data.
--
-- Safety model:
-- - Existing business data is never mutated here.
-- - AI-facing runtime should use read-only selects for approved knowledge.
-- - New memories are first written only as candidates for human review.

create table if not exists public.ai_business_contexts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  body text not null,
  topic text not null,
  market text,
  confidence text not null default 'confirmed',
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  trigger_patterns jsonb not null default '[]'::jsonb,
  required_tools jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  must_not_skip jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_data_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  label text not null,
  system_name text not null,
  tables_or_views jsonb not null default '[]'::jsonb,
  freshness_requirement text,
  can_answer jsonb not null default '[]'::jsonb,
  known_limits jsonb not null default '[]'::jsonb,
  allowed_operations jsonb not null default '["select"]'::jsonb,
  mutation_allowed boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_examples (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  trigger_patterns jsonb not null default '[]'::jsonb,
  expected_behavior jsonb not null default '[]'::jsonb,
  required_playbooks jsonb not null default '[]'::jsonb,
  good_answer text,
  bad_answer text,
  must_include jsonb not null default '[]'::jsonb,
  must_not_claim_without_evidence jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null,
  title text not null,
  body text not null,
  topic text,
  market text,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null default 'medium',
  source text,
  occurred_at timestamptz,
  status text not null default 'active',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_memory_candidates (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null,
  title text not null,
  body text not null,
  topic text,
  market text,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null default 'medium',
  source_conversation_id text,
  proposed_by text,
  review_status text not null default 'pending',
  reviewer text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  title text not null,
  summary text not null,
  decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  follow_up_topics jsonb not null default '[]'::jsonb,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_experiments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  hypothesis text not null,
  markets jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  start_date date,
  end_date date,
  status text not null default 'planned',
  result_summary text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_open_questions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  topic text,
  market text,
  priority text not null default 'medium',
  status text not null default 'open',
  needed_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_key text not null,
  severity text not null default 'warning',
  body text not null,
  affected_period jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_competitor_observations (
  id uuid primary key default gen_random_uuid(),
  market text,
  competitor text not null,
  title text not null,
  body text not null,
  observed_at timestamptz not null,
  source_url text,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null default 'medium',
  created_at timestamptz not null default now()
);

create index if not exists ai_business_contexts_topic_idx on public.ai_business_contexts (topic, status);
create index if not exists ai_playbooks_status_idx on public.ai_playbooks (status);
create index if not exists ai_examples_status_idx on public.ai_examples (status);
create index if not exists ai_memories_topic_idx on public.ai_memories (topic, market, status);
create index if not exists ai_memories_created_at_idx on public.ai_memories (created_at desc);
create index if not exists ai_memory_candidates_status_idx on public.ai_memory_candidates (review_status, created_at desc);
create index if not exists ai_meeting_notes_date_idx on public.ai_meeting_notes (meeting_date desc);
create index if not exists ai_open_questions_status_idx on public.ai_open_questions (status, priority);
create index if not exists ai_data_quality_issues_status_idx on public.ai_data_quality_issues (status, source_key);
create index if not exists ai_competitor_observations_lookup_idx on public.ai_competitor_observations (market, competitor, observed_at desc);

alter table public.ai_business_contexts enable row level security;
alter table public.ai_playbooks enable row level security;
alter table public.ai_data_sources enable row level security;
alter table public.ai_examples enable row level security;
alter table public.ai_memories enable row level security;
alter table public.ai_memory_candidates enable row level security;
alter table public.ai_meeting_notes enable row level security;
alter table public.ai_experiments enable row level security;
alter table public.ai_open_questions enable row level security;
alter table public.ai_data_quality_issues enable row level security;
alter table public.ai_competitor_observations enable row level security;

drop policy if exists "ai_business_contexts_read_authenticated" on public.ai_business_contexts;
create policy "ai_business_contexts_read_authenticated" on public.ai_business_contexts
for select to authenticated using (true);

drop policy if exists "ai_playbooks_read_authenticated" on public.ai_playbooks;
create policy "ai_playbooks_read_authenticated" on public.ai_playbooks
for select to authenticated using (true);

drop policy if exists "ai_data_sources_read_authenticated" on public.ai_data_sources;
create policy "ai_data_sources_read_authenticated" on public.ai_data_sources
for select to authenticated using (true);

drop policy if exists "ai_examples_read_authenticated" on public.ai_examples;
create policy "ai_examples_read_authenticated" on public.ai_examples
for select to authenticated using (true);

drop policy if exists "ai_memories_read_authenticated" on public.ai_memories;
create policy "ai_memories_read_authenticated" on public.ai_memories
for select to authenticated using (true);

drop policy if exists "ai_memory_candidates_read_authenticated" on public.ai_memory_candidates;
create policy "ai_memory_candidates_read_authenticated" on public.ai_memory_candidates
for select to authenticated using (true);

drop policy if exists "ai_memory_candidates_insert_authenticated" on public.ai_memory_candidates;
create policy "ai_memory_candidates_insert_authenticated" on public.ai_memory_candidates
for insert to authenticated with check (review_status = 'pending');

drop policy if exists "ai_meeting_notes_read_authenticated" on public.ai_meeting_notes;
create policy "ai_meeting_notes_read_authenticated" on public.ai_meeting_notes
for select to authenticated using (true);

drop policy if exists "ai_experiments_read_authenticated" on public.ai_experiments;
create policy "ai_experiments_read_authenticated" on public.ai_experiments
for select to authenticated using (true);

drop policy if exists "ai_open_questions_read_authenticated" on public.ai_open_questions;
create policy "ai_open_questions_read_authenticated" on public.ai_open_questions
for select to authenticated using (true);

drop policy if exists "ai_data_quality_issues_read_authenticated" on public.ai_data_quality_issues;
create policy "ai_data_quality_issues_read_authenticated" on public.ai_data_quality_issues
for select to authenticated using (true);

drop policy if exists "ai_competitor_observations_read_authenticated" on public.ai_competitor_observations;
create policy "ai_competitor_observations_read_authenticated" on public.ai_competitor_observations
for select to authenticated using (true);

grant select on
  public.ai_business_contexts,
  public.ai_playbooks,
  public.ai_data_sources,
  public.ai_examples,
  public.ai_memories,
  public.ai_memory_candidates,
  public.ai_meeting_notes,
  public.ai_experiments,
  public.ai_open_questions,
  public.ai_data_quality_issues,
  public.ai_competitor_observations
to authenticated;

grant insert on public.ai_memory_candidates to authenticated;
