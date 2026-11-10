-- Per-candidate extension on the materials deadline. When set and later than
-- the election's submission_deadline, that candidate can keep editing their
-- materials until this instant. Null means no extension.
alter table public.election_candidates
  add column if not exists materials_extended_until timestamptz;
