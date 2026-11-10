-- Voiding in finance admin.
-- 1. A voided obligation (charge) is cancelled for that member but kept on record:
--    nothing is owed, it is never overdue, and it's excluded from charge totals.
-- 2. A voided payment is a reversed manual payment; it no longer counts toward
--    any obligation (the view only counts 'completed' payments).

alter table public.finance_obligations
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_user_id uuid references public.users(id) on delete set null;

alter table public.finance_payments
  drop constraint if exists finance_payments_status_check;
alter table public.finance_payments
  add constraint finance_payments_status_check
  check (status = any (array['pending'::text, 'completed'::text, 'failed'::text, 'canceled'::text, 'voided'::text]));

-- New columns go at the end so `create or replace view` keeps existing ones in place.
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
    when fo.voided_at is not null or fo.exempted_at is not null then 0
    else greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0)::integer
  end as remaining_cents,
  case
    when fo.voided_at is not null then 'voided'
    when fo.exempted_at is not null then 'exempt'
    when greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0) = 0 then 'paid'
    when coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0) > 0 then 'partial'
    else 'unpaid'
  end as payment_state,
  (
    fo.voided_at is null
    and fo.exempted_at is null
    and greatest(fo.amount_cents - coalesce(sum(case when fp.status = 'completed' then fpa.amount_cents else 0 end), 0), 0) > 0
    and fo.due_at is not null
    and fo.due_at < now()
  ) as is_overdue,
  fo.exempted_at,
  fo.voided_at
from public.finance_obligations fo
  left join public.finance_payment_allocations fpa on fpa.obligation_id = fo.id
  left join public.finance_payments fp on fp.id = fpa.payment_id
group by fo.id, fo.charge_id, fo.user_id, fo.customer_id, fo.amount_cents, fo.due_at, fo.created_at, fo.updated_at, fo.exempted_at, fo.voided_at;
