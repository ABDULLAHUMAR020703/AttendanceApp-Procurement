-- Project PM (explicit), employee assignments (many-to-many), optional job title on users.

alter table public.users add column if not exists job_title text;

alter table public.projects add column if not exists pm_id uuid references public.users (id) on delete set null;

create index if not exists projects_pm_id_idx on public.projects (pm_id);

comment on column public.projects.pm_id is 'Department PM responsible for this project (approval chain uses this user for the PM stage).';

create table if not exists public.project_assignments (
  project_id uuid not null references public.projects (id) on delete cascade,
  employee_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create index if not exists project_assignments_employee_idx on public.project_assignments (employee_id);

comment on table public.project_assignments is 'Employees (role employee) granted access to a project; must match project department.';

-- Backfill pm_id: first PM in same department per project.
update public.projects p
set pm_id = sub.chosen_pm
from (
  select distinct on (p2.id)
    p2.id as proj_id,
    u.id as chosen_pm
  from public.projects p2
  join public.users u on u.role = 'pm' and u.department = p2.department
  order by p2.id, u.created_at nulls last, u.id
) sub
where p.id = sub.proj_id
  and p.pm_id is null;

update public.projects
set pm_id = (select id from public.users where role = 'pm' order by created_at nulls last, id limit 1)
where pm_id is null;

do $$
begin
  if not exists (select 1 from public.projects where pm_id is null) then
    alter table public.projects alter column pm_id set not null;
  end if;
end $$;
