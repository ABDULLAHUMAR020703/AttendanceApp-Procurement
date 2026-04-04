# Testing checklist

Short steps. Use `/login`. Migrations applied. Need: **admin**, **PM** (operational dept), **employee**, **team lead** user.

---

## Setup

- [ ] API + frontend running
- [ ] Log in as admin, PM, employee (separate sessions)

---

## APIs (optional)

| Check | Who |
|-------|-----|
| `GET /api/departments` → list | any |
| `GET /api/users` | admin, PM |
| `GET /api/users?department=X&role=employee` | admin |

---

## Projects `/projects`

| # | Action | Pass if |
|---|--------|---------|
| 1 | Admin: dept → PM → TL → pick employees → PO **or** no-PO + budget | 201, project created |
| 2 | PM: create (no dept dropdown) | same dept as PM |
| 3 | Missing PM/TL | 400 |
| 4 | PM in employee list | 400 |
| 5 | List as **admin** | all projects |
| 6 | List as **PM** | only own dept |
| 7 | List as **employee** | assigned / TL / PM on project / legacy no-assignments dept |
| 8 | Open `/projects/[id]` | PM, TL, members, dept label |
| 9 | **Edit members** → Save | list updates |
| 10 | Change **Team lead** on list | saves |
| 11 | **Delete** project | archives; fails if approved spend |

---

## Purchase requests `/purchase-requests`

| # | Action | Pass if |
|---|--------|---------|
| 1 | Employee **on** project: create PR | 201 (project active) |
| 2 | Employee **not** on project | 403 |
| 3 | List **admin** | all PRs |
| 4 | List **employee** | own + approvals + visible projects |

---

## Approvals `/approvals`

| # | Action | Pass if |
|---|--------|---------|
| 1 | TL approves → PM approves | PR approved, budget finalized |
| 2 | No TL on project | only PM step |
| 3 | TL or PM **Reject** | PR rejected |
| 4 | Admin **Force approve** | all pending done, PR approved |
| 5 | Admin **Override approval** (reason) approve/reject | works |
| 6 | Admin **Reject** on card | full reject |
| 7 | UI: chain = TL → PM only; legacy admin = note not required | — |

---

## POs

| # | Action | Pass if |
|---|--------|---------|
| 1 | `GET /api/po` employee | scoped to visible projects |
| 2 | PR form: line search | 403 on project you can’t see |
| 3 | `/po/upload` | admin/PM CSV rules |

---

## Exceptions (no-PO project)

| # | Action | Pass if |
|---|--------|---------|
| 1 | Create no-PO project | exception pending |
| 2 | Dept PM (or admin) approves | project **active**, PRs allowed |

---

## Other

| # | Where | Pass if |
|---|--------|---------|
| 1 | `/dashboard` | loads |
| 2 | Notifications | fire on approve/exception |
| 3 | `/api/audit-logs/...` | allowed user only |
| 4 | `/purchase-requests/[id]` | admin sees override UI |

---

## Smoke order (fast)

1. Create project (PO) + members  
2. PR → TL approve → PM approve  
3. Another PR → admin **Force approve**  
4. PR → admin **Override** reject  
5. No-PO project → approve exception → PR  
6. Edit members on project detail  

---

## Quick fixes

| Issue | Fix |
|-------|-----|
| Missing PM on project | migrations / `pm_id` backfill |
| Employee: no projects | add to **members** |
| Finalize blocked | pending TL/PM only; check finalize migration |
| Force approve 403 | admin + valid pending approval id |

---

## API paths

`departments` `users` `projects` `projects/:id` `projects/:id/team-lead` `projects/:id/members`  
`purchase-requests` `po` `po/search` `approvals` `approvals/:id/decision` `approvals/override`  
`exceptions` `audit-logs/:type/:id` `dashboard` `notifications`
