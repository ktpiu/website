-- Allow admins to exempt a member from a finance charge.
-- An exempt obligation has no remaining balance and is excluded from the charge's total.

alter table public.finance_obligations
  add column if not exists exempted_at timestamptz,
  add column if not exists exempted_by_user_id uuid references public.users(id) on delete set null;

create or replace view public.finance_obligation_balances as
select
  fo.id,
  fo.charge_id,
  fo.user_id,
  fo.customer_id,
  fo.amount_cents,
  fo.due_at,
  fo.created_at,
  fo.updated_at,
  coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0)::integer as paid_cents,
  case
    when fo.exempted_at is not null then 0
    else greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0)::integer
  end as remaining_cents,
  case
    when fo.exempted_at is not null then 'exempt'
    when greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0) = 0 then 'paid'
    when coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0) > 0 then 'partial'
    else 'unpaid'
  end as payment_state,
  (
    fo.exempted_at is null
    and greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0) > 0
    and fo.due_at is not null
    and fo.due_at < now()
  ) as is_overdue,
  fo.exempted_at
from public.finance_obligations fo
  left join public.finance_payment_allocations fpa on fpa.obligation_id = fo.id
  left join public.finance_payments fp on fp.id = fpa.payment_id
group by fo.id, fo.charge_id, fo.user_id, fo.customer_id, fo.amount_cents, fo.due_at, fo.created_at, fo.updated_at, fo.exempted_at;
