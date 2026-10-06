CREATE TABLE IF NOT EXISTS task (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idem_key    TEXT NOT NULL UNIQUE,
    body        JSONB, 
    status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'in_progress', 'complete', 'failed', 'canceled')),
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_queued_idx ON task (created_at) WHERE status = 'queued';

