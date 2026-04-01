-- Migration 0023: Feature gaps — missing Mastodon API tables
-- Adds: status_edits, account_notes, featured_tags, user_domain_blocks, account_pins

-- Status edit history snapshots
CREATE TABLE IF NOT EXISTS status_edits (
  id TEXT PRIMARY KEY,
  status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  spoiler_text TEXT NOT NULL DEFAULT '',
  sensitive INTEGER NOT NULL DEFAULT 0,
  media_attachments_json TEXT, -- JSON array snapshot of media at time of edit
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_status_edits_status_id ON status_edits(status_id);

-- Personal notes on other accounts (CRM-style)
CREATE TABLE IF NOT EXISTS account_notes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(account_id, target_account_id)
);

-- User featured tags (shown on profile)
CREATE TABLE IF NOT EXISTS featured_tags (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  statuses_count INTEGER NOT NULL DEFAULT 0,
  last_status_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(account_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_featured_tags_account ON featured_tags(account_id);

-- User-level domain blocks (separate from admin domain blocks)
CREATE TABLE IF NOT EXISTS user_domain_blocks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(account_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_user_domain_blocks_account ON user_domain_blocks(account_id);

-- Endorsed/featured accounts (pinned on profile)
CREATE TABLE IF NOT EXISTS account_pins (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(account_id, target_account_id)
);
CREATE INDEX IF NOT EXISTS idx_account_pins_account ON account_pins(account_id);
