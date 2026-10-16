-- OUTDATED: written for the old DS001 numbering, TN/AP states and delete+reindex.
-- Use centre-numbering-tests.sql instead.
-- =====================================================================
--  Deep Skilling Training — database integrity test suite
--
--  ⚠️  DESTRUCTIVE: this TRUNCATES the registrations table.
--      Run it against a development Supabase project only, never
--      against production.
--
--  Usage (Supabase SQL Editor): paste and run after schema.sql.
--  Usage (psql):  psql "$DATABASE_URL" -f integrity-tests.sql
--
--  Covers §75 of the specification:
--    sequential ID allocation · age boundaries · email rules ·
--    mobile + ID proof formats · state/district · occupation/institution ·
--    PWD conditional · duplicate prevention · maintenance lock ·
--    delete + reindex + document renaming · post-delete ID continuation
-- =====================================================================

-- Build a complete, valid payload with optional overrides.
create or replace function test_payload(overrides jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'unique_id_type','PAN Card',
    'id_proof', (floor(random()*900000000000)+100000000000)::bigint::text,
    'first_name','Dhanabal',
    'last_name','D',
    'date_of_birth', (current_date - interval '25 years')::date::text,
    'gender','Male',
    'beneficiary_state','TamilNadu',
    'district','Chennai',
    'contact_number','9876543210',
    'email','user'||floor(random()*100000000)::text||'@gmail.com',
    'ews_category','Yes - 1',
    'last_completed_education','4-Graduation',
    'degree_specialization','B.Sc.',
    'annual_income','2-1 to 2.99 Lakh',
    'occupation','2-Unemployed',
    'institution_type','',
    'domain_course','Data Analytics',
    'pwd_status','No - 2',
    'parent_name','Parent Name',
    'alternative_contact_number','9123456780',
    'social_category','OBC-3',
    'education_ext','pdf',
    'ews_ext','jpg',
    'pwd_ext',''
  ) || overrides;
$$;

create or replace function expect_fail(p jsonb, expected text, label text)
returns text language plpgsql as $$
begin
  perform public.create_registration(p);
  return format('FAIL  %s  (expected error %s, but insert succeeded)', label, expected);
exception when others then
  if position(expected in SQLERRM) > 0 then
    return format('ok    %s', label);
  end if;
  return format('FAIL  %s  (got: %s)', label, left(SQLERRM, 90));
end $$;

create or replace function expect_ok(p jsonb, label text)
returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.create_registration(p);
  return format('ok    %s  -> %s', label, r->>'mafoi_id');
exception when others then
  return format('FAIL  %s  (%s)', label, left(SQLERRM, 110));
end $$;

\echo ''
\echo '=============== 1. SEQUENTIAL ID ALLOCATION ==============='
select expect_ok(test_payload('{"first_name":"Alpha"}'),  'registration 1');
select expect_ok(test_payload('{"first_name":"Bravo"}'),  'registration 2');
select expect_ok(test_payload('{"first_name":"Charlie"}'),'registration 3');
select serial_no, mafoi_id, first_name from registrations order by serial_no;

\echo ''
\echo '=============== 2. AGE BOUNDARIES ==============='
select expect_fail(test_payload(jsonb_build_object('date_of_birth',(current_date - interval '17 years')::date::text)),
                   'VALIDATION_ERROR', '17 years -> reject');
select expect_ok  (test_payload(jsonb_build_object('date_of_birth',(current_date - interval '18 years')::date::text,'first_name','Age18')),
                   'exactly 18 -> accept');
select expect_ok  (test_payload(jsonb_build_object('date_of_birth',(current_date - interval '36 years')::date::text,'first_name','Age36')),
                   'exactly 36 -> accept');
select expect_ok  (test_payload(jsonb_build_object('date_of_birth',(current_date - interval '37 years' + interval '1 day')::date::text,'first_name','Age36d')),
                   '36 years 364 days -> accept');
select expect_fail(test_payload(jsonb_build_object('date_of_birth',(current_date - interval '37 years')::date::text)),
                   'VALIDATION_ERROR', 'exactly 37 -> reject');

\echo ''
\echo '=============== 3. EMAIL RULES ==============='
select expect_fail(test_payload('{"email":"Dhanabal@gmail.com"}'), 'reg_email_chk', 'uppercase local part -> reject');
select expect_fail(test_payload('{"email":"dhanabal@GMAIL.com"}'), 'reg_email_chk', 'uppercase domain -> reject');
select expect_fail(test_payload('{"email":"dhanabal@yahoo.com"}'), 'reg_email_chk', 'non-gmail domain -> reject');
select expect_ok  (test_payload('{"email":"dhanabal.d@gmail.com","first_name":"EmailOk"}'), 'lowercase gmail -> accept');

\echo ''
\echo '=============== 4. MOBILE + ID PROOF ==============='
select expect_fail(test_payload('{"contact_number":"987654321"}'),    'reg_contact_chk', '9 digits -> reject');
select expect_fail(test_payload('{"contact_number":"98765432101"}'),  'reg_contact_chk', '11 digits -> reject');
select expect_fail(test_payload('{"contact_number":"+919876543210"}'),'reg_contact_chk', '+91 prefix -> reject');
select expect_fail(test_payload('{"alternative_contact_number":"98 7654 3210"}'), 'reg_alt_contact_chk', 'spaces in alt number -> reject');
select expect_fail(test_payload('{"id_proof":"ABCD1234"}'),           'reg_id_proof_chk', 'letters in id proof -> reject');
select expect_fail(test_payload('{"id_proof":"1234-5678"}'),          'reg_id_proof_chk', 'hyphen in id proof -> reject');

\echo ''
\echo '=============== 5. STATE / DISTRICT ==============='
select expect_fail(test_payload('{"beneficiary_state":"TamilNadu","district":"Vishak"}'),
                   'reg_state_district_chk', 'TamilNadu + Vishak -> reject');
select expect_fail(test_payload('{"beneficiary_state":"Andhra Pradesh","district":"Chennai"}'),
                   'reg_state_district_chk', 'Andhra Pradesh + Chennai -> reject');
select expect_ok  (test_payload('{"beneficiary_state":"Andhra Pradesh","district":"Vijayawada","first_name":"AP"}'),
                   'Andhra Pradesh + Vijayawada -> accept');

\echo ''
\echo '=============== 6. OCCUPATION / INSTITUTION ==============='
select expect_fail(test_payload('{"occupation":"4-Student","institution_type":""}'),
                   'VALIDATION_ERROR', 'Student without institution -> reject');
select expect_fail(test_payload('{"occupation":"1-Employed","institution_type":"2-University"}'),
                   'VALIDATION_ERROR', 'non-Student with institution -> reject');
select expect_ok  (test_payload('{"occupation":"4-Student","institution_type":"2-University","first_name":"Student"}'),
                   'Student with institution -> accept');

\echo ''
\echo '=============== 7. PWD CONDITIONAL ==============='
select expect_fail(test_payload('{"pwd_status":"Yes - 1","pwd_ext":""}'),
                   'VALIDATION_ERROR', 'PWD Yes without certificate -> reject');
select expect_fail(test_payload('{"pwd_status":"No - 2","pwd_ext":"pdf"}'),
                   'VALIDATION_ERROR', 'PWD No with certificate -> reject');
select expect_ok  (test_payload('{"pwd_status":"Yes - 1","pwd_ext":"pdf","first_name":"Pwd"}'),
                   'PWD Yes with certificate -> accept');
select mafoi_id, pwd_status, coalesce(pwd_certificate_name,'<NULL>') as pwd_file
  from registrations where first_name in ('Pwd','Alpha') order by serial_no;

\echo ''
\echo '=============== 8. DUPLICATE PREVENTION ==============='
select expect_ok  (test_payload('{"id_proof":"555000111222","email":"dupe@gmail.com","first_name":"Dupe"}'), 'original registration');
select expect_fail(test_payload('{"id_proof":"555000111222","email":"other@gmail.com"}'),
                   'DUPLICATE_REGISTRATION', 'same unique ID + id proof -> reject');
select expect_fail(test_payload('{"id_proof":"999888777666","email":"dupe@gmail.com"}'),
                   'DUPLICATE_REGISTRATION', 'same email -> reject');

\echo ''
\echo '=============== 9. MAINTENANCE LOCK BLOCKS REGISTRATION ==============='
select public.acquire_maintenance_lock('test', null) as lock_acquired;
select public.acquire_maintenance_lock('test again', null) as second_lock_should_be_false;
select expect_fail(test_payload('{}'), 'MAINTENANCE_LOCK', 'registration while locked -> reject');
select public.release_maintenance_lock();
select expect_ok(test_payload('{"first_name":"AfterUnlock"}'), 'registration after unlock');

-- ============ DELETE + REINDEX ============

-- Ten registrations, a mix of PWD / non-PWD, to mirror §25.
do $$
declare i int; p jsonb;
begin
  for i in 1..10 loop
    p := test_payload(jsonb_build_object(
      'first_name', 'Student' || i,
      'last_name',  'D',
      'id_proof',   (100000000000 + i)::text,
      'email',      'student' || i || '@gmail.com',
      'pwd_status', case when i % 3 = 0 then 'Yes - 1' else 'No - 2' end,
      'pwd_ext',    case when i % 3 = 0 then 'pdf' else '' end,
      'education_ext', case when i % 2 = 0 then 'jpg' else 'pdf' end
    ));
    perform public.create_registration(p);
  end loop;
end $$;

\echo ''
\echo '=============== BEFORE DELETION ==============='
select mafoi_id, first_name, education_document_name, coalesce(pwd_certificate_name,'—') as pwd_doc
  from registrations order by serial_no;

-- ---------------------------------------------------------------
\echo ''
\echo '=============== PLAN for deleting DS009 ==============='
select jsonb_pretty(jsonb_build_object(
         'deleting', plan->'target'->>'mafoi_id',
         'files_removed', plan->'target'->'files',
         'rows_to_shift', jsonb_array_length(plan->'rows'),
         'renames', plan->'renames'))
from (select public.compute_reindex_plan((select id from registrations where mafoi_id='DS009')) as plan) s;

\echo ''
\echo '=============== APPLY (delete DS009) ==============='
select public.apply_delete_reindex(
  (select id from registrations where mafoi_id='DS009'), null);

select mafoi_id, first_name, education_document_name, coalesce(pwd_certificate_name,'—') as pwd_doc
  from registrations order by serial_no;

-- ---------------------------------------------------------------
\echo ''
\echo '=============== DELETE FROM THE MIDDLE (DS003) ==============='
select public.apply_delete_reindex(
  (select id from registrations where mafoi_id='DS003'), null);

select mafoi_id, first_name, education_document_name, ews_certificate_name
  from registrations order by serial_no;

-- ---------------------------------------------------------------
\echo ''
\echo '=============== DELETE THE FIRST (DS001) ==============='
select public.apply_delete_reindex(
  (select id from registrations where mafoi_id='DS001'), null);

select mafoi_id, first_name, education_document_path from registrations order by serial_no;

-- ---------------------------------------------------------------
\echo ''
\echo '=============== NEXT REGISTRATION CONTINUES THE SEQUENCE ==============='
select public.create_registration(test_payload(
  '{"first_name":"NewJoiner","id_proof":"777777777777","email":"newjoiner@gmail.com"}'))->>'mafoi_id'
  as newly_assigned_id;

-- ---------------------------------------------------------------
\echo ''
\echo '=============== INTEGRITY INVARIANTS ==============='
select
  count(*)                                                       as total,
  bool_and(serial_no = rn)                                       as serials_are_1_to_n,
  bool_and(mafoi_id = 'DS' || lpad(serial_no::text,3,'0'))        as ids_match_serials,
  bool_and(education_document_name like mafoi_id || '\_%')        as edu_name_matches_id,
  bool_and(ews_certificate_name like mafoi_id || '\_%')           as ews_name_matches_id,
  bool_and(pwd_certificate_name is null
           or pwd_certificate_name like mafoi_id || '\_%')        as pwd_name_matches_id,
  bool_and(education_document_path = 'registrations/' || id || '/' || education_document_name)
                                                                  as paths_match_names,
  count(distinct mafoi_id) = count(*)                             as no_duplicate_ids
from (select r.*, row_number() over (order by serial_no) as rn from registrations r) t;

\echo ''
\echo '=============== STALE-PLAN GUARD ==============='
-- A plan computed for a table that then changes must be refused.
select case when public.apply_delete_reindex(
         (select id from registrations where mafoi_id='DS002'),
         'deliberately-wrong-fingerprint') is not null
       then 'FAIL — stale plan was applied' end;
