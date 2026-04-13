-- Remove blanket grants from 20260415_user_permissions.sql so access matches explicit assignments only.
-- Non-admin users with no rows have no granular permissions until an admin sets them in Settings.
-- Application middleware still gives admins full access without storing rows.

delete from public.user_permissions;
