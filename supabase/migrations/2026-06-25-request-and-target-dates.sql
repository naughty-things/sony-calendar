-- 2026-06-25: Add target_launch_date and request_date to posts
-- Motivation: the parseEmail AI can now extract these two columns separately
-- from planning tables (e.g. Jennifer Chan's MSS Workshop table has both).
-- publish_date stays the social-post go-live date (used by calendar logic);
-- target_launch_date mirrors what the client wrote in the planning table;
-- request_date is the copy-delivery deadline (when Cheri needs the copy).
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS target_launch_date DATE,
  ADD COLUMN IF NOT EXISTS request_date DATE;

-- Both are nullable. Existing posts (31 rows as of this migration) will have
-- null for both; new posts from email-sourced ingests will populate them
-- when the planning table has those columns. Manually-created posts can
-- leave them null.

-- Add a CHECK: target_launch_date and request_date should both be valid dates.
-- (DATE type already enforces this.)