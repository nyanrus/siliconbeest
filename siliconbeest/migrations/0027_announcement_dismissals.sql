-- Track which announcements each user has dismissed
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  announcement_id TEXT NOT NULL REFERENCES announcements(id),
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (announcement_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_account ON announcement_dismissals(account_id);
