-- Sync published_at from published flag for existing rows.
-- The published_at column may already exist from prior admin usage.
UPDATE announcements SET published_at = created_at WHERE published = 1 AND published_at IS NULL;
