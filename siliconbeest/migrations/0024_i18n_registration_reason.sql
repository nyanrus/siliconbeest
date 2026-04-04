-- Add reason column to users table for approval-mode registration reasons
ALTER TABLE users ADD COLUMN reason TEXT DEFAULT NULL;
