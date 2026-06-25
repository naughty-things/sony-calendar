-- Add 'staging' to the allowed status values for posts.
--
-- 'staging' is the pre-in_progress state where a post has been ingested
-- from email but is missing key metadata (typically publish_date — the
-- client said "Within this week" instead of an exact date). PIC then
-- opens the modal, fills in publish_date, and the status auto-transitions
-- to 'in_progress' for the regular workflow.
--
-- Routing rules in gmail.ts:
--   - if no publish_date AND (no target_launch_date OR low conf)
--     → status='staging'  (PIC needs to assign a date)
--   - if no publish_date BUT high confidence + full brief
--     → status='staging' too (even with date missing, route to staging
--       so PIC explicitly picks a date instead of getting an in_progress
--       post that the calendar can't display)
--   - otherwise follow existing client_review / in_progress logic

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_status_check
  CHECK (status IN ('staging','in_progress','client_review','approved','posted'));

-- Convert any current "in_progress + null publish_date" posts to staging
-- so PIC sees them in the staging inbox. Existing dated in_progress posts
-- remain in_progress.
UPDATE posts
SET status = 'staging',
    updated_at = NOW()
WHERE status = 'in_progress'
  AND publish_date IS NULL;