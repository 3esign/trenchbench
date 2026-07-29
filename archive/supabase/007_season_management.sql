-- ============================================================
--  007: Season Management
--  Adds a season column to the sessions table and defaults
--  existing sessions to Season 1 (v1).
-- ============================================================

-- Add season column if it doesn't exist
alter table sessions add column if not exists season int default 1;

-- Ensure all existing sessions are set to Season 1
update sessions set season = 1 where season is null;
