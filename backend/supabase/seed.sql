-- Seed procurement workflow data using the real users created in `seedUsers.sql`.
-- Safe to re-run (idempotent) where inserts use `on conflict (id) do nothing`.

-- PURCHASE ORDER
insert into public.purchase_orders (id, po_number, vendor, total_value, remaining_value, uploaded_by, created_at) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'PO-1001',
    'Vendor A',
    50000.00,
    50000.00,
    (select id from public.users where email = 'hammad.bakhtiar@hadir.ai' and role = 'admin' limit 1),
    now()
  )
on conflict (id) do nothing;

-- PROJECTS (department + optional team_lead_id)
insert into public.projects (
  id, name, po_id, budget, department, team_lead_id, created_by, status, is_exception, created_at
) values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Project Alpha',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    50000.00,
    'technical',
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    (select id from public.users where email = 'abdullah.bin.ali@hadir.ai' and role = 'pm' limit 1),
    'active',
    false,
    now()
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Project NoPO',
    null,
    30000.00,
    'technical',
    null,
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    'exception_pending',
    true,
    now()
  )
on conflict (id) do nothing;

-- EXCEPTIONS
insert into public.exceptions (id, type, reference_id, status, approved_by, created_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'no_po', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'pending', null, now())
on conflict (id) do nothing;

-- PURCHASE REQUESTS
insert into public.purchase_requests (id, project_id, description, amount, document_url, status, created_by, created_at) values
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Invoice for materials',
    15000.00,
    null,
    'pending',
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    now()
  ),
  (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Big over-budget request',
    60000.00,
    null,
    'pending_exception',
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    now()
  )
on conflict (id) do nothing;

-- APPROVALS (team_lead → pm → admin)
insert into public.approvals (id, request_id, approver_id, role, status, comments, created_at, updated_at) values
  (
    '12121212-1212-1212-1212-121212121212',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    'team_lead',
    'pending',
    null,
    now(),
    now()
  ),
  (
    '13131313-1313-1313-1313-131313131313',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    (select id from public.users where email = 'abdullah.bin.ali@hadir.ai' and role = 'pm' limit 1),
    'pm',
    'pending',
    null,
    now(),
    now()
  ),
  (
    '14141414-1414-1414-1414-141414141414',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    (select id from public.users where email = 'hammad.bakhtiar@hadir.ai' and role = 'admin' limit 1),
    'admin',
    'pending',
    null,
    now(),
    now()
  )
on conflict (id) do nothing;

-- NOTIFICATIONS (optional sample)
insert into public.notifications (id, user_id, type, message, is_read, created_at) values
  (
    '16161616-1616-1616-1616-161616161616',
    (select id from public.users where email = 'hasnain.ibrar@hadir.ai' and role = 'employee' limit 1),
    'pr_created',
    'PR created for Project Alpha',
    false,
    now()
  )
on conflict (id) do nothing;
