create extension if not exists pgcrypto;

create table if not exists public.companies (
  id text primary key check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  parent_id text references public.companies(id) on delete set null,
  featured boolean not null default false,
  bucket text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  status text not null default 'pending' check (status in ('pending', 'active', 'unsubscribed', 'suppressed')),
  token_version integer not null default 1 check (token_version > 0),
  consented_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_access_email_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_companies (
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscriber_id, company_id)
);

create table if not exists public.notification_scans (
  scan_id text primary key,
  role_count integer not null default 0,
  received_at timestamptz not null default now()
);

create table if not exists public.notification_roles (
  role_id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  company text not null,
  title text not null,
  location text not null default '',
  role_type text not null,
  disciplines jsonb not null default '[]'::jsonb,
  url text not null,
  posted_at date,
  date_seen date,
  first_scan_id text references public.notification_scans(scan_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  role_id text not null references public.notification_roles(role_id) on delete cascade,
  scan_id text references public.notification_scans(scan_id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed')),
  provider_id text,
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (subscriber_id, role_id)
);

create table if not exists public.email_events (
  event_id text primary key,
  event_type text not null,
  provider_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists subscription_companies_company_idx on public.subscription_companies(company_id, subscriber_id);
create index if not exists deliveries_provider_idx on public.notification_deliveries(provider_id) where provider_id is not null;
create index if not exists subscribers_status_idx on public.subscribers(status);

alter table public.companies enable row level security;
alter table public.subscribers enable row level security;
alter table public.subscription_companies enable row level security;
alter table public.notification_scans enable row level security;
alter table public.notification_roles enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.email_events enable row level security;

-- No client policies are intentionally created. Public and authenticated
-- browser clients cannot read email or subscription data; Edge Functions use
-- the service role after performing token and request validation.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscribers_set_updated_at on public.subscribers;
create trigger subscribers_set_updated_at before update on public.subscribers
for each row execute function public.set_updated_at();

drop trigger if exists roles_set_updated_at on public.notification_roles;
create trigger roles_set_updated_at before update on public.notification_roles
for each row execute function public.set_updated_at();

drop trigger if exists deliveries_set_updated_at on public.notification_deliveries;
create trigger deliveries_set_updated_at before update on public.notification_deliveries
for each row execute function public.set_updated_at();
