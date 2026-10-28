CREATE TABLE IF NOT EXISTS recordings (
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

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS cues jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS submit_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS submit_retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS submit_error text;

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS duration double precision;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS chapter_state text NOT NULL DEFAULT 'waiting';
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS chapter_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS chapter_retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS chapter_error text;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS draft jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS approved_at timestamptz;
