-- Applied to project ulensjpqjptqvghjtggv on 2026-09-09 as
-- "role_types_graduation_year". Kept here for reference/local dev.
--
-- Moves member classification fully onto the roles system:
--   * roles.type distinguishes pledge-class roles from general roles.
--   * Grade is derived from users.graduation_year (see lib/members.ts);
--     the Freshman/Sophomore/Junior/Senior roles are removed.
--   * Alumni are flagged manually via users.is_alumni.
--   * Legacy users.class / users."pledgeClass" columns are dropped.

alter table public.roles
  add column if not exists type text not null default 'general';

alter table public.roles drop constraint if exists roles_type_check;
alter table public.roles
  add constraint roles_type_check check (type in ('general', 'pledge_class'));

update public.roles
  set type = 'pledge_class'
  where name in ('Alpha Class', 'Beta Class', 'Gamma Class');

-- Founding Fathers are members of the Alpha pledge class; "Founding Father"
-- stays as a separate distinction role.
insert into public.user_roles (user_id, role_id)
select ur.user_id, alpha.id
from public.user_roles ur
join public.roles ff on ff.id = ur.role_id and ff.name = 'Founding Father'
cross join (select id from public.roles where name = 'Alpha Class' limit 1) alpha
on conflict do nothing;

alter table public.users
  add column if not exists graduation_year integer;

alter table public.users drop constraint if exists users_graduation_year_check;
alter table public.users
  add constraint users_graduation_year_check
  check (graduation_year is null or graduation_year between 2000 and 2100);

alter table public.users
  add column if not exists is_alumni boolean not null default false;

-- Backfill graduation year from the grade roles (academic year 2026-27).
update public.users u
set graduation_year = m.year
from public.user_roles ur
join public.roles r on r.id = ur.role_id
join (values ('Freshman', 2030), ('Sophomore', 2029), ('Junior', 2028), ('Senior', 2027))
  as m(name, year) on m.name = r.name
where ur.user_id = u.id
  and u.graduation_year is null;

delete from public.roles
  where name in ('Freshman', 'Sophomore', 'Junior', 'Senior')
    and type = 'general';

alter table public.users drop column if exists class;
alter table public.users drop column if exists "pledgeClass";
