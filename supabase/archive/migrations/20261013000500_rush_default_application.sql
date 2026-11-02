-- Rush: an explicit default application form.
--
-- Cycles without their own application form use the default. Previously that
-- was implicitly the first active global application by sort_order; now it's
-- chosen in Rush Settings ("Make default"). At most one form is the default.

alter table public.rush_form_templates
  add column if not exists is_default boolean not null default false;

create unique index if not exists rush_form_templates_one_default_application
  on public.rush_form_templates (kind)
  where is_default;

alter table public.rush_form_templates
  drop constraint if exists rush_form_templates_default_is_global_application;
alter table public.rush_form_templates
  add constraint rush_form_templates_default_is_global_application
  check (not is_default or (kind = 'application' and cycle_id is null));

-- Keep today's behaviour: mark the form that was implicitly the default.
update public.rush_form_templates
   set is_default = true
 where id = (
   select id from public.rush_form_templates
    where kind = 'application' and cycle_id is null and is_active
    order by sort_order, created_at
    limit 1
 )
   and not exists (select 1 from public.rush_form_templates where is_default);
