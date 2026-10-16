-- =====================================================================
--  Deep Skilling Training — Supabase schema
--  Run this ONCE in the Supabase SQL Editor of a fresh project.
--  It is idempotent enough to re-run safely during setup.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
--  1. ADMIN USERS  (authorization layer on top of Supabase Auth)
-- =====================================================================
create table if not exists public.admin_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "admin can read own admin row" on public.admin_users;
create policy "admin can read own admin row"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid());

-- Helper used by every policy / function that needs authorization.
create or replace function public.is_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users a where a.user_id = p_uid);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;


-- =====================================================================
--  2. MAINTENANCE STATE  (server-side lock — blocks registration during
--     delete + reindex, and blocks concurrent admin deletions)
-- =====================================================================
create table if not exists public.maintenance_state (
  id         boolean primary key default true,
  is_locked  boolean not null default false,
  reason     text,
  locked_at  timestamptz,
  locked_by  uuid,
  constraint maintenance_state_singleton check (id)
);

insert into public.maintenance_state (id, is_locked)
values (true, false)
on conflict (id) do nothing;

alter table public.maintenance_state enable row level security;
-- No policies: nothing may touch this table directly. Access is via
-- the SECURITY DEFINER functions below only.


-- =====================================================================
--  3. REGISTRATIONS
-- =====================================================================
create table if not exists public.registrations (
  id                          uuid primary key default gen_random_uuid(),
  serial_no                   integer not null,
  mafoi_id                    text    not null,

  -- Mobilization -----------------------------------------------------
  unique_id_type              text not null,
  id_proof                    text not null,
  first_name                  text not null,
  last_name                   text not null,
  date_of_birth               date not null,
  gender                      text not null,
  beneficiary_state           text not null,
  district                    text not null,
  contact_number              text not null,
  email                       text not null,
  ews_category                text not null,
  training_centre_preference  text not null,

  -- Enrolment --------------------------------------------------------
  last_completed_education    text not null,
  degree_specialization       text not null,
  marksheet_10th_document_path        text null,
  marksheet_10th_document_name        text null,
  marksheet_12th_document_path        text null,
  marksheet_12th_document_name        text null,
  marksheet_degree_document_path      text null,
  marksheet_degree_document_name      text null,
  marksheet_diploma_iti_document_path text null,
  marksheet_diploma_iti_document_name text null,
  annual_income               text not null,
  occupation                  text not null,
  institution_type            text null,
  ews_certificate_path        text not null,
  ews_certificate_name        text not null,
  domain_course               text not null,
  pwd_status                  text not null,
  pwd_certificate_path        text null,
  pwd_certificate_name        text null,
  parent_name                 text not null,
  alternative_contact_number  text not null,
  social_category             text not null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- ---- Value domains (server-side truth for every dropdown) --------
  constraint reg_unique_id_type_chk check (unique_id_type in (
    'Aadhaar Card','PAN Card','Electoral Card','Driving License','College ID',
    'School 10th / 12th Marksheet','10th Marksheet','12th Marksheet','Degree Marksheet')),
  constraint reg_gender_chk check (gender in (
    'Male','Female','Third Gender','Prefer Not to Say')),
  constraint reg_state_chk check (beneficiary_state = 'Andhra Pradesh'),
  constraint reg_ews_chk check (ews_category in ('Yes - 1','No - 2')),
  constraint reg_training_centre_chk check (training_centre_preference in (
    'Guntur, Andhra Pradesh','Vijayawada, Andhra Pradesh','Vizag, Andhra Pradesh')),
  constraint reg_education_chk check (last_completed_education in (
    '1-Not completed formal education','2-Completed 12th','3-Diploma/ITI',
    '4-Graduation','5-Post Graduation & above','6-None of the above')),
  constraint reg_degree_chk check (
    degree_specialization is not null and length(btrim(degree_specialization)) > 0),
  constraint reg_income_chk check (annual_income in (
    '1-Less than 99,999','2-1 to 2.99 Lakh','3-3 to 4.99 Lakh','4-5 to 7.99 Lakh','5-Above 8 Lakh')),
  constraint reg_occupation_chk check (occupation in (
    '1-Employed','2-Unemployed','3-Entrepreneur','4-Student','5-Unpaid work')),
  constraint reg_institution_chk check (institution_type is null or institution_type in (
    '1-School','2-University','3-ITI','4-NGO Centre','5-None')),
  constraint reg_domain_chk check (domain_course in (
    'Data Analytics','Artificial Intelligence','Cyber Security','BFSI')),
  constraint reg_pwd_chk check (pwd_status in ('Yes - 1','No - 2')),
  constraint reg_social_chk check (social_category in (
    'SC-1','ST-2','OBC-3','Gen-4','Prefer not to say-5','Others - 5')),

  -- ---- Format rules -------------------------------------------------
    constraint reg_id_proof_chk    check (id_proof ~ '^[A-Za-z0-9]+$'),
  constraint reg_contact_chk     check (contact_number ~ '^[0-9]{10}$'),
  constraint reg_alt_contact_chk check (alternative_contact_number ~ '^[0-9]{10}$'),
  constraint reg_email_chk       check (email ~ '^[a-z0-9]+([._%+-][a-z0-9]+)*@gmail\.com$'),
  constraint reg_first_name_chk  check (btrim(first_name) <> ''),
  constraint reg_last_name_chk   check (btrim(last_name)  <> ''),
  constraint reg_parent_name_chk check (parent_name ~ '^[^,]*[A-Za-z][^,]*,[^,]*[A-Za-z][^,]*$'),
  constraint reg_serial_chk      check (serial_no > 0),
  constraint reg_mafoi_chk       check (mafoi_id ~ '^AP-(VWD|GUN|VZG)-[0-9]{3,}$'),

  -- ---- Cross-field relationships (§11, §15, §7.8) -------------------
  constraint reg_state_district_chk check (
    beneficiary_state = 'Andhra Pradesh' and district in (
      'Alluri Sitharama Raju','Anakapalli','Anantapur','Annamayya','Bapatla','Chittoor','Dr. B.R. Ambedkar Konaseema','East Godavari','Eluru','Guntur','Kakinada','Krishna','Kurnool','Nandyal','NTR','Palnadu','Parvathipuram Manyam','Prakasam','Sri Sathya Sai','SPSR Nellore','Srikakulam','Tirupati','Visakhapatnam','Vizianagaram','West Godavari','YSR Kadapa')
  ),
  constraint reg_occupation_institution_chk check (
    (occupation =  '4-Student' and institution_type is not null) or
    (occupation <> '4-Student' and institution_type is null)
  ),
  constraint reg_pwd_certificate_chk check (
    (pwd_status = 'Yes - 1' and pwd_certificate_path is not null and pwd_certificate_name is not null) or
    (pwd_status = 'No - 2'  and pwd_certificate_path is null     and pwd_certificate_name is null)
  ),

  -- ---- Duplicate prevention (§41) ------------------------------------
  constraint reg_identity_unique unique (unique_id_type, id_proof),
  constraint reg_email_unique    unique (email)
);

-- serial_no is now the per-centre sequence number (1, 2, 3 ... within each
-- training centre), so it is unique per centre, not globally. mafoi_id holds
-- the full registration code (AP-VWD-001 ...) and is unique globally.
alter table public.registrations
  add constraint reg_centre_serial_unique unique (training_centre_preference, serial_no);
alter table public.registrations
  add constraint reg_mafoi_id_unique unique (mafoi_id);

create index if not exists registrations_serial_idx  on public.registrations (training_centre_preference, serial_no);
create index if not exists registrations_domain_idx  on public.registrations (domain_course);
create index if not exists registrations_created_idx on public.registrations (created_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists registrations_touch_updated_at on public.registrations;
create trigger registrations_touch_updated_at
  before update on public.registrations
  for each row execute function public.touch_updated_at();

-- Once assigned, a registration code (and the centre / serial it is built
-- from) can never change. To correct one by hand in the SQL editor, drop
-- this trigger first and recreate it afterwards.
create or replace function public.protect_registration_code()
returns trigger language plpgsql as $$
begin
  if new.mafoi_id is distinct from old.mafoi_id
     or new.serial_no is distinct from old.serial_no
     or new.training_centre_preference is distinct from old.training_centre_preference then
    raise exception 'REGISTRATION_CODE_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists registrations_protect_code on public.registrations;
create trigger registrations_protect_code
  before update on public.registrations
  for each row execute function public.protect_registration_code();

-- ---- Row Level Security ------------------------------------------------
alter table public.registrations enable row level security;

-- Students (anon) get NO policy at all: they cannot select, insert,
-- update or delete. All writes happen through the Edge Function using
-- the service role. Admins get read-only access.
drop policy if exists "admins read registrations" on public.registrations;
create policy "admins read registrations"
  on public.registrations for select
  to authenticated
  using (public.is_admin(auth.uid()));


-- =====================================================================
--  4. NAMING HELPERS  (single source of truth for file names)
-- =====================================================================
-- Per-centre counters. last_number only ever goes up, so a code that has
-- been issued is never issued again, even if that registration is deleted.
create table if not exists public.centre_counters (
  centre_name text primary key,
  centre_code text not null unique,
  last_number integer not null default 0 check (last_number >= 0)
);

insert into public.centre_counters (centre_name, centre_code) values
  ('Vijayawada, Andhra Pradesh', 'AP-VWD'),
  ('Guntur, Andhra Pradesh',     'AP-GUN'),
  ('Vizag, Andhra Pradesh',      'AP-VZG')
on conflict (centre_name) do nothing;

alter table public.centre_counters enable row level security;  -- no policies: no API access
revoke all on public.centre_counters from anon, authenticated;

-- AP-VWD + 7 -> AP-VWD-007.  Three digits minimum; 1000 and above are
-- written in full (lpad would truncate them, hence the CASE).
create or replace function public.registration_code(p_centre_code text, p_n integer)
returns text language sql immutable as $$
  select p_centre_code || '-' ||
         case when p_n < 1000 then lpad(p_n::text, 3, '0') else p_n::text end;
$$;

create or replace function public.sanitize_name_part(p_text text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9 ._-]', '', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function public.file_extension(p_name text)
returns text language sql immutable as $$
  select lower(coalesce(substring(p_name from '\.([A-Za-z0-9]+)$'), 'pdf'));
$$;

-- {RegistrationCode}_{Kind}_{First}_{Last}.{ext}   e.g. AP-VWD-001_10th MS_Ravi_Kumar.pdf
create or replace function public.document_filename(
  p_mafoi text, p_kind text, p_first text, p_last text, p_ext text)
returns text language sql immutable as $$
  select p_mafoi || '_' || p_kind || '_' ||
         public.sanitize_name_part(p_first) || '_' || public.sanitize_name_part(p_last) ||
         '.' || lower(p_ext);
$$;

create or replace function public.document_path(p_registration uuid, p_filename text)
returns text language sql immutable as $$
  select 'registrations/' || p_registration::text || '/' || p_filename;
$$;


-- =====================================================================
--  5. MAINTENANCE LOCK API
-- =====================================================================

-- Public / anon safe: lets the registration page show the banner.
create or replace function public.registration_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_locked', m.is_locked,
    'message', case when m.is_locked
                    then 'Updating registrations. Please wait...'
                    else 'Registration is available again.' end)
  from public.maintenance_state m where m.id;
$$;

revoke all on function public.registration_status() from public;
grant execute on function public.registration_status() to anon, authenticated, service_role;

-- Atomic compare-and-swap. Returns false when someone else holds the lock.
-- A lock older than 5 minutes is considered stale and may be taken over.
create or replace function public.acquire_maintenance_lock(p_reason text, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  update public.maintenance_state
     set is_locked = true,
         reason    = p_reason,
         locked_at = now(),
         locked_by = p_user
   where id
     and (is_locked = false or locked_at < now() - interval '5 minutes')
  returning true into v_ok;

  return coalesce(v_ok, false);
end $$;

create or replace function public.release_maintenance_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update public.maintenance_state
     set is_locked = false, reason = null, locked_at = null, locked_by = null
   where id;
$$;

revoke all on function public.acquire_maintenance_lock(text, uuid) from public, anon, authenticated;
revoke all on function public.release_maintenance_lock()          from public, anon, authenticated;
grant execute on function public.acquire_maintenance_lock(text, uuid) to service_role;
grant execute on function public.release_maintenance_lock()          to service_role;


-- =====================================================================
--  6. CREATE REGISTRATION  (atomic serial + Ma Foi ID allocation)
--     Called only by the `register` Edge Function (service role).
--     The whole body is one transaction guarded by an advisory lock,
--     so simultaneous submissions can never share a serial_no. (§21,§22,§67)
-- =====================================================================
create or replace function public.create_registration(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key   bigint := 771001;      -- shared by registration + reindex
  v_locked     boolean;
  v_dob        date;
  v_serial     integer;
  v_centre     text := p->>'training_centre_preference';
  v_centre_code text;
  v_mafoi      text;
  v_id         uuid := gen_random_uuid();
  v_first      text := btrim(coalesce(p->>'first_name', ''));
  v_last       text := btrim(coalesce(p->>'last_name', ''));
  v_occupation text := p->>'occupation';
  v_inst       text := nullif(btrim(coalesce(p->>'institution_type','')), '');
  v_pwd        text := p->>'pwd_status';
  v_10th_ext      text;
  v_12th_ext      text;
  v_degree_ext    text;
  v_diploma_ext   text;
  v_ews_ext    text := public.file_extension(coalesce(p->>'ews_ext','pdf'));
  v_pwd_ext    text := public.file_extension(coalesce(p->>'pwd_ext','pdf'));
  v_10th_name    text;
  v_12th_name    text;
  v_degree_name  text;
  v_diploma_name    text;
  v_diploma_storage text;
  v_ews_name   text;
  v_pwd_name   text;
begin
  -- Serialise against reindexing and against other registrations.
  perform pg_advisory_xact_lock(v_lock_key);

  select is_locked into v_locked from public.maintenance_state where id;
  if v_locked then
    raise exception 'MAINTENANCE_LOCK' using errcode = 'P0001';
  end if;

  -- ---- Age: 18 <= age <= 36 on the real birth date (§7.5) -----------
  v_dob := (p->>'date_of_birth')::date;
  if v_dob is null then
    raise exception 'VALIDATION_ERROR|date_of_birth|Please enter your date of birth.' using errcode = 'P0001';
  end if;
  if v_dob > (current_date - interval '18 years')::date
     or v_dob <= (current_date - interval '37 years')::date then
    raise exception 'VALIDATION_ERROR|date_of_birth|Beneficiary must be between 18 and 36 years of age.'
      using errcode = 'P0001';
  end if;

  -- ---- Conditional-field integrity (belt and braces on the CHECKs) --
  if v_occupation = '4-Student' and v_inst is null then
    raise exception 'VALIDATION_ERROR|institution_type|Please select the type of institution.' using errcode = 'P0001';
  end if;
  if v_occupation <> '4-Student' and v_inst is not null then
    raise exception 'VALIDATION_ERROR|institution_type|Institution applies only when Occupation is 4-Student.' using errcode = 'P0001';
  end if;
  if v_pwd = 'Yes - 1' and coalesce(p->>'pwd_ext','') = '' then
    raise exception 'VALIDATION_ERROR|pwd_certificate|Please upload the PWD certificate.' using errcode = 'P0001';
  end if;
  if v_pwd = 'No - 2' and coalesce(p->>'pwd_ext','') <> '' then
    raise exception 'VALIDATION_ERROR|pwd_certificate|A PWD certificate must not be attached when PWD is "No - 2".' using errcode = 'P0001';
  end if;

  -- ---- Duplicate check (friendly error before hitting the constraint)
  if exists (select 1 from public.registrations r
              where r.unique_id_type = p->>'unique_id_type'
                and r.id_proof       = p->>'id_proof') then
    raise exception 'DUPLICATE_REGISTRATION' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.registrations r where r.email = p->>'email') then
    raise exception 'DUPLICATE_REGISTRATION' using errcode = 'P0001';
  end if;

  -- ---- Atomic sequential allocation ---------------------------------
  -- Per-centre counter. The UPDATE takes a row lock on that centre's counter
  -- (on top of the advisory lock above), so two simultaneous registrations
  -- can never receive the same number. If this transaction later fails, the
  -- increment rolls back with it; numbers are never reused after a commit.
  update public.centre_counters
     set last_number = last_number + 1
   where centre_name = v_centre
   returning centre_code, last_number into v_centre_code, v_serial;

  if not found then
    raise exception 'VALIDATION_ERROR|training_centre_preference|Please select a valid training centre preference.'
      using errcode = 'P0001';
  end if;

  v_mafoi := public.registration_code(v_centre_code, v_serial);

  -- Each of the four marksheets is optional: only build a name/ext when one
  -- was actually staged. Empty string ("") from the Edge Function means
  -- "nothing uploaded" and must stay null throughout.
  v_10th_ext    := case when coalesce(p->>'marksheet_10th_ext','') = ''        then null else public.file_extension(p->>'marksheet_10th_ext') end;
  v_12th_ext    := case when coalesce(p->>'marksheet_12th_ext','') = ''        then null else public.file_extension(p->>'marksheet_12th_ext') end;
  v_degree_ext  := case when coalesce(p->>'marksheet_degree_ext','') = ''      then null else public.file_extension(p->>'marksheet_degree_ext') end;
  v_diploma_ext := case when coalesce(p->>'marksheet_diploma_iti_ext','') = '' then null else public.file_extension(p->>'marksheet_diploma_iti_ext') end;

  if v_10th_ext is not null then
    v_10th_name := public.document_filename(v_mafoi, '10th MS', v_first, v_last, v_10th_ext);
  end if;
  if v_12th_ext is not null then
    v_12th_name := public.document_filename(v_mafoi, '12th MS', v_first, v_last, v_12th_ext);
  end if;
  if v_degree_ext is not null then
    v_degree_name := public.document_filename(v_mafoi, 'Degree MS', v_first, v_last, v_degree_ext);
  end if;
  if v_diploma_ext is not null then
    -- Display name keeps the "/" the naming convention requires; the
    -- storage object key cannot contain "/", so it uses a safe stand-in.
    v_diploma_name    := public.document_filename(v_mafoi, 'Diploma/ITI MS', v_first, v_last, v_diploma_ext);
    v_diploma_storage := public.document_filename(v_mafoi, 'Diploma-ITI MS', v_first, v_last, v_diploma_ext);
  end if;

  v_ews_name := public.document_filename(v_mafoi, 'EWS Certificate', v_first, v_last, v_ews_ext);
  if v_pwd = 'Yes - 1' then
    v_pwd_name := public.document_filename(v_mafoi, 'PWD Certificate', v_first, v_last, v_pwd_ext);
  end if;

  insert into public.registrations (
    id, serial_no, mafoi_id,
    unique_id_type, id_proof, first_name, last_name, date_of_birth, gender,
    beneficiary_state, district, contact_number, email, ews_category,
    training_centre_preference,
    last_completed_education, degree_specialization,
    marksheet_10th_document_path, marksheet_10th_document_name,
    marksheet_12th_document_path, marksheet_12th_document_name,
    marksheet_degree_document_path, marksheet_degree_document_name,
    marksheet_diploma_iti_document_path, marksheet_diploma_iti_document_name,
    annual_income, occupation, institution_type,
    ews_certificate_path, ews_certificate_name,
    domain_course, pwd_status, pwd_certificate_path, pwd_certificate_name,
    parent_name, alternative_contact_number, social_category
  ) values (
    v_id, v_serial, v_mafoi,
    p->>'unique_id_type', p->>'id_proof', v_first, v_last, v_dob, p->>'gender',
    p->>'beneficiary_state', p->>'district', p->>'contact_number', p->>'email', p->>'ews_category',
    v_centre,
    p->>'last_completed_education', p->>'degree_specialization',
    case when v_10th_name is null then null else public.document_path(v_id, v_10th_name) end, v_10th_name,
    case when v_12th_name is null then null else public.document_path(v_id, v_12th_name) end, v_12th_name,
    case when v_degree_name is null then null else public.document_path(v_id, v_degree_name) end, v_degree_name,
    case when v_diploma_name is null then null else public.document_path(v_id, v_diploma_storage) end, v_diploma_name,
    p->>'annual_income', v_occupation, v_inst,
    public.document_path(v_id, v_ews_name), v_ews_name,
    p->>'domain_course', v_pwd,
    case when v_pwd = 'Yes - 1' then public.document_path(v_id, v_pwd_name) end, v_pwd_name,
    btrim(coalesce(p->>'parent_name','')), p->>'alternative_contact_number', p->>'social_category'
  );

  return jsonb_build_object(
    'id', v_id,
    'serial_no', v_serial,
    'mafoi_id', v_mafoi,
    'documents', jsonb_build_object(
      'marksheet_10th', case when v_10th_name is null then null
        else jsonb_build_object('name', v_10th_name, 'path', public.document_path(v_id, v_10th_name)) end,
      'marksheet_12th', case when v_12th_name is null then null
        else jsonb_build_object('name', v_12th_name, 'path', public.document_path(v_id, v_12th_name)) end,
      'marksheet_degree', case when v_degree_name is null then null
        else jsonb_build_object('name', v_degree_name, 'path', public.document_path(v_id, v_degree_name)) end,
      'marksheet_diploma_iti', case when v_diploma_name is null then null
        else jsonb_build_object('name', v_diploma_name, 'path', public.document_path(v_id, v_diploma_storage)) end,
      'ews', jsonb_build_object('name', v_ews_name, 'path', public.document_path(v_id, v_ews_name)),
      'pwd', case when v_pwd_name is null then null
        else jsonb_build_object('name', v_pwd_name, 'path', public.document_path(v_id, v_pwd_name)) end
    )
  );
exception
  when unique_violation then
    raise exception 'DUPLICATE_REGISTRATION' using errcode = 'P0001';
end $$;

revoke all on function public.create_registration(jsonb) from public, anon, authenticated;
grant execute on function public.create_registration(jsonb) to service_role;


-- =====================================================================
--  7. DELETE  (registration codes are permanent — nothing is renumbered)
--     Function names are unchanged so the Edge Functions keep working.
-- =====================================================================
create or replace function public.compute_reindex_plan(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target record;
  v_files  jsonb := '[]'::jsonb;
begin
  select * into v_target from public.registrations where id = p_id;
  if not found then
    raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_files := v_files || to_jsonb(v_target.marksheet_10th_document_path);
  v_files := v_files || to_jsonb(v_target.marksheet_12th_document_path);
  v_files := v_files || to_jsonb(v_target.marksheet_degree_document_path);
  v_files := v_files || to_jsonb(v_target.marksheet_diploma_iti_document_path);
  v_files := v_files || to_jsonb(v_target.ews_certificate_path);
  if v_target.pwd_certificate_path is not null then
    v_files := v_files || to_jsonb(v_target.pwd_certificate_path);
  end if;

  -- Registration codes are permanent, so no other student is renumbered and
  -- no Storage object needs renaming: 'rows' and 'renames' are always empty.
  return jsonb_build_object(
    'target', jsonb_build_object(
      'id', v_target.id,
      'mafoi_id', v_target.mafoi_id,
      'first_name', v_target.first_name,
      'last_name', v_target.last_name,
      'email', v_target.email,
      'files', v_files),
    'rows', '[]'::jsonb,
    'renames', '[]'::jsonb,
    'fingerprint', md5(p_id::text)
  );
end $$;

-- Deletes the registration. Kept under the old name so the Edge Functions
-- are unchanged. The counter is NOT decremented: a deleted code is never reused.
create or replace function public.apply_delete_reindex(p_id uuid, p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := 771001;
  v_count    integer;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  delete from public.registrations where id = p_id;
  if not found then
    raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.registrations;
  return jsonb_build_object('deleted', p_id, 'remaining', v_count, 'reindexed', 0);
end $$;

revoke all on function public.compute_reindex_plan(uuid)          from public, anon, authenticated;
revoke all on function public.apply_delete_reindex(uuid, text)    from public, anon, authenticated;
grant execute on function public.compute_reindex_plan(uuid)       to service_role;
grant execute on function public.apply_delete_reindex(uuid, text) to service_role;


-- =====================================================================
--  8. STORAGE BUCKET + POLICIES
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deep-skilling-documents', 'deep-skilling-documents', false, 10485760,
        array['application/pdf','image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf','image/jpeg'];

-- Admins may read objects (needed to mint signed URLs from the dashboard).
-- Everything else (insert / move / delete) is service-role only, which
-- bypasses RLS — so no policy is granted for those actions.
drop policy if exists "admins read deep skilling documents" on storage.objects;
create policy "admins read deep skilling documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'deep-skilling-documents' and public.is_admin(auth.uid()));


-- =====================================================================
--  9. GRANTS HYGIENE
--     Nothing in `public` should be reachable by anon except the
--     registration status function.
-- =====================================================================
revoke all on public.registrations   from anon;
revoke all on public.admin_users     from anon;
revoke all on public.maintenance_state from anon, authenticated;
grant select on public.registrations to authenticated;   -- still filtered by RLS
grant select on public.admin_users   to authenticated;   -- still filtered by RLS
