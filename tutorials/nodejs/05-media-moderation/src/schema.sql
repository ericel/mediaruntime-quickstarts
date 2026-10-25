CREATE TABLE IF NOT EXISTS videos (
 id uuid PRIMARY KEY, name text NOT NULL, source_uri text,
 remote_job_id text UNIQUE, state text NOT NULL DEFAULT 'uploading',
 created_at timestamptz NOT NULL DEFAULT now(), saved_at timestamptz,
 output_bytes bigint, completion_count integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS webhook_inbox (
 account_id text NOT NULL, event_id text NOT NULL, job_id text NOT NULL,
 status text NOT NULL, payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','dead')),
 deliveries integer NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
 PRIMARY KEY (account_id, event_id)
);
CREATE INDEX IF NOT EXISTS inbox_pending ON webhook_inbox(next_attempt_at) WHERE state='pending';
CREATE TABLE IF NOT EXISTS pipeline_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, detail text NOT NULL
);

ALTER TABLE videos ADD COLUMN IF NOT EXISTS moderation jsonb;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS policy_state text NOT NULL DEFAULT 'held';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS policy_reason text NOT NULL DEFAULT 'Awaiting moderation';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS publication text NOT NULL DEFAULT 'private';
CREATE TABLE IF NOT EXISTS review_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 video_id uuid NOT NULL REFERENCES videos(id),
 action text NOT NULL CHECK(action IN ('approve','reject','hold')),
 reason text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
