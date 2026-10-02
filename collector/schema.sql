-- Shared collector schema (Cloudflare D1). Apply: wrangler d1 execute DB --file collector/schema.sql
CREATE TABLE IF NOT EXISTS surveys (
  survey_id TEXT PRIMARY KEY,
  version   TEXT NOT NULL,
  deadline  TEXT,                       -- ISO date or date-time; NULL = no deadline
  status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE TABLE IF NOT EXISTS responses (
  id            TEXT PRIMARY KEY,
  survey_id     TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  raw           TEXT NOT NULL,          -- request body stored verbatim
  submission_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses (survey_id, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_submission ON responses (survey_id, submission_id) WHERE submission_id IS NOT NULL;
