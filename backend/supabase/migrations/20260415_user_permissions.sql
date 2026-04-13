-- Granular app permissions (extends role-based access). Admins bypass checks in middleware.

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  permission text not null,
  unique (user_id, permission),
  constraint user_permissions_permission_check check (
    permission in (
      'view_projects',
      'view_pos',
      'view_approvals',
      'approve_requests',
      'view_budget',
      'manage_exceptions'
    )
  )
);

create index if not exists user_permissions_user_id_idx on public.user_permissions (user_id);

-- No default rows: admins bypass in middleware; other users get access only via explicit rows (Settings → Permissions).
