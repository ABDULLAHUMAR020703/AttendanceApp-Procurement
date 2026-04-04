-- Pass actor into finalize so purchase_requests.updated_by is set atomically with approval.

create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid, p_updated_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr record;
  v_proj record;
  v_line record;
  v_po record;
  v_amt numeric(20, 2);
  v_pending integer;
  v_new_rem_amt numeric;
  v_new_rem_val numeric;
  v_new_budget numeric;
begin
  select * into v_pr from purchase_requests where id = p_pr_id for update;
  if not found then
    raise exception 'PR_NOT_FOUND';
  end if;

  if v_pr.budget_deducted = true and v_pr.status = 'approved' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'pr_id', p_pr_id);
  end if;

  if v_pr.status not in ('pending', 'pending_exception') then
    raise exception 'PR_NOT_PENDING status=%', v_pr.status;
  end if;

  if v_pr.budget_deducted = true then
    raise exception 'PR_BUDGET_ALREADY_DEDUCTED_INCONSISTENT';
  end if;

  v_amt := v_pr.amount;
  if v_amt is null or v_amt <= 0 then
    raise exception 'PR_INVALID_AMOUNT';
  end if;

  select count(*)::integer into v_pending
  from approvals
  where request_id = p_pr_id and status = 'pending';

  if v_pending > 0 then
    raise exception 'PR_APPROVALS_STILL_PENDING count=%', v_pending;
  end if;

  if v_pr.po_line_id is not null then
    select * into v_line from purchase_orders where id = v_pr.po_line_id for update;
    if not found then
      raise exception 'PO_LINE_NOT_FOUND';
    end if;
    if v_line.remaining_amount < v_amt or v_line.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_LINE_BALANCE';
    end if;
    update purchase_orders
    set
      remaining_amount = remaining_amount - v_amt,
      remaining_value = remaining_value - v_amt,
      updated_by = coalesce(p_updated_by, updated_by)
    where id = v_pr.po_line_id;

    v_new_rem_amt := v_line.remaining_amount - v_amt;
    v_new_rem_val := v_line.remaining_value - v_amt;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'po_line',
      'pr_id', p_pr_id,
      'po_line_id', v_pr.po_line_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  select * into v_proj from projects where id = v_pr.project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_proj.po_id is not null then
    select * into v_po from purchase_orders where id = v_proj.po_id for update;
    if not found then
      raise exception 'PO_NOT_FOUND';
    end if;

    if v_po.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_VALUE';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 and v_po.remaining_amount < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_AMOUNT';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 then
      update purchase_orders
      set
        remaining_amount = remaining_amount - v_amt,
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := v_po.remaining_amount - v_amt;
      v_new_rem_val := v_po.remaining_value - v_amt;
    else
      update purchase_orders
      set
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := coalesce(v_po.remaining_amount, 0);
      v_new_rem_val := v_po.remaining_value - v_amt;
    end if;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'project_po',
      'pr_id', p_pr_id,
      'purchase_order_id', v_proj.po_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  if v_proj.budget < v_amt then
    raise exception 'INSUFFICIENT_PROJECT_BUDGET';
  end if;

  update projects
  set
    budget = budget - v_amt,
    updated_by = coalesce(p_updated_by, updated_by)
  where id = v_proj.id;

  v_new_budget := v_proj.budget - v_amt;

  update purchase_requests
  set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
  where id = p_pr_id;

  return jsonb_build_object(
    'ok', true,
    'deduction_type', 'project_budget',
    'pr_id', p_pr_id,
    'project_id', v_proj.id,
    'amount', v_amt,
    'remaining_budget', v_new_budget
  );
end;
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid, uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid, uuid) to service_role;

-- Keep one-arg overload for backwards compatibility (no updated_by attribution)
create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.finalize_pr_budget_after_approval(p_pr_id, null::uuid);
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid) to service_role;
