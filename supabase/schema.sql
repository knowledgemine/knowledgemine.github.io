-- Khani Insights: accounts and hisab-kitab.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: it only creates what is missing.
--
-- Every table is protected by Row Level Security: a signed-in user can only read or change
-- rows of companies they are a member of. Owners and admins manage the company and its team.

-- ---------------------------------------------------------------- people and companies
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  pan text,
  address text,
  phone text,
  created_by uuid not null default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  email text,
  added_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_by uuid not null default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

-- licences a company follows (licence numbers as published by DMG)
create table if not exists public.company_licences (
  company_id uuid not null references public.companies on delete cascade,
  licence_no text not null,
  note text,
  added_at timestamptz not null default now(),
  primary key (company_id, licence_no)
);

-- ---------------------------------------------------------------- hisab-kitab
-- one row per licence, B.S. month (YYYY-MM) and mineral
create table if not exists public.production (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  licence_no text not null,
  bs_month text not null check (bs_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  mineral text not null,
  unit text not null check (unit in ('tonne', 'm3', 'kg', 'gram', 'm2')),
  produced numeric not null default 0 check (produced >= 0),
  taken_out numeric not null default 0 check (taken_out >= 0),      -- through the mine gate: royalty base (rule 21)
  sold_domestic numeric not null default 0 check (sold_domestic >= 0),
  sold_export numeric not null default 0 check (sold_export >= 0),
  sale_value numeric not null default 0 check (sale_value >= 0),    -- rupees
  royalty_rate numeric check (royalty_rate >= 0),                   -- rupees per unit used for this month
  note text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  unique (company_id, licence_no, bs_month, mineral)
);

create table if not exists public.royalty_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  licence_no text not null,
  bs_month text not null check (bs_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- month the royalty is for
  royalty numeric not null default 0 check (royalty >= 0),
  local_fee numeric not null default 0 check (local_fee >= 0),
  surcharge numeric not null default 0 check (surcharge >= 0),
  paid_on date not null,
  voucher_no text,
  voucher_submitted_on date,
  note text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  licence_no text,
  spent_on date not null,
  category text not null check (category in ('wages', 'fuel', 'machinery', 'explosives', 'transport',
    'fees_taxes', 'land_rent', 'environment', 'office', 'other')),
  amount numeric not null check (amount >= 0),
  note text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- renewals, annual reports, environmental approvals, extensions ...
create table if not exists public.filings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  licence_no text not null,
  kind text not null check (kind in ('renewal', 'annual_report', 'prospecting_report', 'env_study',
    'extension', 'other')),
  fiscal_year text,                       -- e.g. 2083/84
  done_on date not null,
  reference text,                         -- receipt / letter number
  note text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists production_company_month on public.production (company_id, bs_month);
create index if not exists royalty_company_month on public.royalty_payments (company_id, bs_month);
create index if not exists expenses_company_date on public.expenses (company_id, spent_on);
create index if not exists filings_company on public.filings (company_id, licence_no);

-- ---------------------------------------------------------------- helpers (run as table owner)
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = cid and user_id = auth.uid());
$$;

create or replace function public.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = cid and user_id = auth.uid()
                 and role in ('owner', 'admin'));
$$;

-- whoever creates a company becomes its owner
create or replace function public.add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into company_members (company_id, user_id, role, email)
  values (new.id, auth.uid(), 'owner', auth.jwt() ->> 'email')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists companies_add_owner on public.companies;
create trigger companies_add_owner after insert on public.companies
  for each row execute function public.add_owner();

-- a signed-in user joins every company that invited their (confirmed) email
create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or (auth.jwt() ->> 'email') is null then return 0; end if;
  insert into company_members (company_id, user_id, role, email)
  select company_id, auth.uid(), role, lower(email) from company_invites
  where lower(email) = lower(auth.jwt() ->> 'email')
  on conflict do nothing;
  get diagnostics n = row_count;
  delete from company_invites where lower(email) = lower(auth.jwt() ->> 'email');
  return n;
end $$;

revoke all on function public.accept_invites() from public, anon;
grant execute on function public.accept_invites() to authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.company_licences enable row level security;
alter table public.production enable row level security;
alter table public.royalty_payments enable row level security;
alter table public.expenses enable row level security;
alter table public.filings enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members read company" on public.companies;
create policy "members read company" on public.companies for select to authenticated
  using (public.is_member(id) or created_by = auth.uid());
drop policy if exists "anyone signed in creates company" on public.companies;
create policy "anyone signed in creates company" on public.companies for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists "admins edit company" on public.companies;
create policy "admins edit company" on public.companies for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
drop policy if exists "owner deletes company" on public.companies;
create policy "owner deletes company" on public.companies for delete to authenticated
  using (exists (select 1 from public.company_members m where m.company_id = companies.id
                 and m.user_id = auth.uid() and m.role = 'owner'));

drop policy if exists "members see team" on public.company_members;
create policy "members see team" on public.company_members for select to authenticated
  using (public.is_member(company_id));
drop policy if exists "admins change team" on public.company_members;
create policy "admins change team" on public.company_members for update to authenticated
  using (public.is_admin(company_id) and role <> 'owner') with check (public.is_admin(company_id) and role <> 'owner');
drop policy if exists "admins remove members or leave" on public.company_members;
create policy "admins remove members or leave" on public.company_members for delete to authenticated
  using ((public.is_admin(company_id) and role <> 'owner') or (user_id = auth.uid() and role <> 'owner'));

drop policy if exists "admins manage invites" on public.company_invites;
create policy "admins manage invites" on public.company_invites for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- company data: any member can read and write; deleting is for admins
do $$
declare t text;
begin
  foreach t in array array['company_licences', 'production', 'royalty_payments', 'expenses', 'filings'] loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(company_id))', t);
    execute format('drop policy if exists "members add" on public.%I', t);
    execute format('create policy "members add" on public.%I for insert to authenticated with check (public.is_member(company_id))', t);
    execute format('drop policy if exists "members edit" on public.%I', t);
    execute format('create policy "members edit" on public.%I for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id))', t);
    execute format('drop policy if exists "admins delete" on public.%I', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.is_admin(company_id))', t);
  end loop;
end $$;
