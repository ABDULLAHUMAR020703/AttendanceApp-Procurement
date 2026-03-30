-- Seed auth users + public.users profiles in Supabase
-- Safe to re-run: skips existing auth users and existing public.users rows.
-- Requires: pgcrypto extension (for crypt/gen_salt) and proper privileges.

create extension if not exists pgcrypto;

-- Role mapping (legacy meta roles in auth metadata):
-- super_admin -> admin
-- manager -> pm
-- employee -> employee
alter table public.users
drop constraint if exists users_role_check;

update public.users
set role = case
  when role = 'super_admin' then 'admin'
  when role = 'manager' then 'pm'
  when role in ('team_lead', 'finance') then 'employee'
  when role in ('dept_head', 'gm') then 'pm'
  else role
end
where role in ('super_admin', 'manager', 'team_lead', 'finance', 'dept_head', 'gm');

update public.users set department = coalesce(nullif(trim(department), ''), 'technical') where department is null;
update public.users set department = 'management' where role = 'admin';
update public.users set department = 'finance' where email ilike '%.batt@hadir.ai' and role = 'employee';

alter table public.users
add constraint users_role_check
check (role in ('admin', 'pm', 'employee'));

do $$
declare
  allowed_roles text[] := array['super_admin', 'manager', 'employee'];
  allowed_mapped_roles text[] := array['admin', 'pm', 'employee'];
  rec record;
  v_email text;
  v_full_name text;
  v_mapped_role text;
  v_user_id uuid;
  v_department text;
begin
  for rec in
    select *
    from (
      values
        ('hammad.bakhtiar', 'hammadbakhtiar123', 'super_admin'),
        ('abdullah.bin.ali', 'abdullahbinali123', 'manager'),
        ('hasnain.ibrar', 'hasnainibrar123', 'employee'),
        ('abdul.rehman.batt', 'abdulrehmanbatt123', 'manager'),
        ('abdullah.bin.umar', 'abdullahbinumar123', 'employee'),
        ('samad.kiani', 'samadkiani123', 'employee'),
        ('bilawal.cheema', 'bilawalcheema123', 'manager'),
        ('zidane.asghar', 'zidaneasghar123', 'employee'),
        ('moiz.kazi', 'moizkazi123', 'manager'),
        ('balaj.nadeem.kiani', 'balajnadeemkiani123', 'manager')
    ) as t(username, plain_password, role)
  loop
    if not (rec.role = any(allowed_roles)) then
      raise warning '[SKIPPED] Invalid role "%" for username "%"', rec.role, rec.username;
      continue;
    end if;

    v_email := rec.username || '@hadir.ai';
    v_full_name := initcap(replace(rec.username, '.', ' '));
    v_mapped_role := case
      when rec.role = 'super_admin' then 'admin'
      when rec.role = 'manager' then 'pm'
      when rec.role = 'employee' then 'employee'
      else rec.role
    end;

    v_department := case
      when v_mapped_role = 'admin' then 'management'
      when rec.username = 'abdul.rehman.batt' then 'finance'
      else 'technical'
    end;

    if not (v_mapped_role = any(allowed_mapped_roles)) then
      raise warning '[SKIPPED] Invalid mapped role "%" for username "%"', v_mapped_role, rec.username;
      continue;
    end if;

    select id into v_user_id
    from auth.users
    where lower(email) = lower(v_email)
    limit 1;

    if v_user_id is null then
      insert into auth.users (
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        crypt(rec.plain_password, gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('username', rec.username, 'full_name', v_full_name, 'role', rec.role),
        now(),
        now()
      )
      returning id into v_user_id;

      raise notice '[AUTH CREATED] % -> %', rec.username, v_email;
    else
      raise notice '[AUTH EXISTS] % -> %', rec.username, v_email;
    end if;

    insert into public.users (id, name, email, role, department, created_at)
    values (v_user_id, v_full_name, v_email, v_mapped_role, v_department, now())
    on conflict (id) do update set
      name = excluded.name,
      email = excluded.email,
      role = excluded.role,
      department = excluded.department;

    raise notice '[USERS UPSERTED] % (id=%)', rec.username, v_user_id;
  end loop;
end $$;
