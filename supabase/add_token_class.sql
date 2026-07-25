-- ============================================================
--  BENCHHOOD - add token classification to the decision log.
--  RUN THIS ONCE before using the new start scripts, or decision
--  saving will error on the new "token_class" field.
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this
--    3. click RUN
-- ============================================================
alter table decisions add column if not exists token_class text;
