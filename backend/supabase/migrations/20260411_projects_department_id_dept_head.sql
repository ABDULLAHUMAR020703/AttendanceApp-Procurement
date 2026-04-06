-- Projects: canonical FK to departments(code) as department_id; add dept_head app role.

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('admin', 'pm', 'dept_head', 'employee'));

alter table public.projects add column if not exists department_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'department'
  ) then
    update public.projects p
    set department_id = coalesce(p.department_id, p.department)
    where p.department_id is null;
  end if;
end $$;

alter table public.projects drop constraint if exists projects_department_check;

alter table public.projects alter column department_id set not null;

alter table public.projects drop constraint if exists projects_department_id_fkey;
alter table public.projects
  add constraint projects_department_id_fkey foreign key (department_id) references public.departments (code);

drop index if exists projects_department_idx;

alter table public.projects drop column if exists department;

create index if not exists projects_department_id_idx on public.projects (department_id);
