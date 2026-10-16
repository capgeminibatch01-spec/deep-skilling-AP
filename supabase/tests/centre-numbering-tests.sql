-- DESTRUCTIVE dev-only checks for per-centre numbering (AP-VWD / AP-GUN / AP-VZG).
-- Run in a throw-away database after schema.sql. Replaces the DS001-based
-- integrity-tests.sql, which no longer applies.
\set ON_ERROR_STOP off
create or replace function pl(o jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('unique_id_type','PAN Card','id_proof',(floor(random()*9e11)+1e11)::bigint::text,
 'first_name','Ravi','last_name','Kumar','date_of_birth',(current_date - interval '25 years')::date::text,'gender','Male',
 'beneficiary_state','Andhra Pradesh','district','Guntur','contact_number','9876543210',
 'email',('u'||floor(random()*1e9)::bigint||'@gmail.com'),'ews_category','No - 2',
 'training_centre_preference','Vijayawada, Andhra Pradesh','last_completed_education','4-Graduation',
 'degree_specialization','B.Sc.','annual_income','1-Less than 99,999','occupation','2-Unemployed',
 'institution_type','','domain_course','BFSI','pwd_status','No - 2','parent_name','A B, C D',
 'alternative_contact_number','9876543211','social_category','Gen-4',
 'marksheet_10th_ext','pdf','marksheet_12th_ext','pdf','marksheet_degree_ext','pdf','marksheet_diploma_iti_ext','pdf',
 'ews_ext','jpg','pwd_ext','') || o $$;
\echo '--- 3 VWD, 2 GUN, 1 VZG'
select (create_registration(pl()))->>'mafoi_id';
select (create_registration(pl()))->>'mafoi_id';
select (create_registration(pl()))->>'mafoi_id';
select (create_registration(pl('{"training_centre_preference":"Guntur, Andhra Pradesh"}')))->>'mafoi_id';
select (create_registration(pl('{"training_centre_preference":"Guntur, Andhra Pradesh"}')))->>'mafoi_id';
select (create_registration(pl('{"training_centre_preference":"Vizag, Andhra Pradesh"}')))->>'mafoi_id';
\echo '--- filenames/paths for first VWD row'
select marksheet_10th_document_name, marksheet_12th_document_name, marksheet_degree_document_name, marksheet_diploma_iti_document_name, ews_certificate_name, pwd_certificate_name from registrations where mafoi_id='AP-VWD-001';
select marksheet_diploma_iti_document_path from registrations where mafoi_id='AP-VWD-001';
\echo '--- invalid centre (old option) must fail'
select create_registration(pl('{"training_centre_preference":"DBV, Perambur"}'));
\echo '--- non-AP state / district must fail at DB'
select create_registration(pl('{"beneficiary_state":"Karnataka"}'));
insert into registrations select * from registrations limit 0;
\echo '--- immutability'
update registrations set mafoi_id='AP-VWD-999' where mafoi_id='AP-VWD-001';
update registrations set training_centre_preference='Vizag, Andhra Pradesh' where mafoi_id='AP-VWD-001';
update registrations set first_name='Edited' where mafoi_id='AP-VWD-001';
select mafoi_id, first_name from registrations where mafoi_id='AP-VWD-001';
\echo '--- delete last VWD (003) then register again: must be 004, not 003'
select apply_delete_reindex((select id from registrations where mafoi_id='AP-VWD-003'), null);
select (create_registration(pl()))->>'mafoi_id';
\echo '--- counters'
select * from centre_counters order by centre_code;
\echo '--- 1000+ formatting'
update centre_counters set last_number=998 where centre_code='AP-VZG';
select (create_registration(pl('{"training_centre_preference":"Vizag, Andhra Pradesh"}')))->>'mafoi_id';
select (create_registration(pl('{"training_centre_preference":"Vizag, Andhra Pradesh"}')))->>'mafoi_id';
select (create_registration(pl('{"training_centre_preference":"Vizag, Andhra Pradesh"}')))->>'mafoi_id';
\echo '--- uniqueness check'
select count(*) total, count(distinct mafoi_id) distinct_codes from registrations;
