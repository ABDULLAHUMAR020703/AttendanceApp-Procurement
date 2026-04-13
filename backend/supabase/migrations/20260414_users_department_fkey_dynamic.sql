-- Dynamic departments: users.department must reference departments(code).
-- Drops the static CHECK list so new rows from /api/departments are valid.

alter table public.users drop constraint if exists users_department_fkey;

alter table public.users drop constraint if exists users_department_check;

alter table public.users
  add constraint users_department_fkey foreign key (department) references public.departments (code);

-- Case-insensitive uniqueness for display names (admin UI)
create unique index if not exists departments_display_name_lower_key on public.departments (lower(display_name));
