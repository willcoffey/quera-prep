/** A record of all programs indexed by the SHA256 hash of their nsv in UTF-8 */
CREATE TABLE IF NOT EXISTS programs (
  program_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now (),
  CONSTRAINT program_id_is_sha256 CHECK (
    program_id = encode (sha256 (convert_to (body, 'UTF8')), 'hex')
  )
);

/**
 * Tasks created by the user, represent a request to create a program and run
 * it a specified number of times.
 */
CREATE TABLE IF NOT EXISTS task (
  task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idem_key TEXT NOT NULL UNIQUE,
  program_id TEXT NOT NULL REFERENCES programs (program_id),
  runs INT NOT NULL DEFAULT 1000 CHECK (runs > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

/** A record of all runs that have been executed */
CREATE TABLE IF NOT EXISTS run (
  run_id UUID PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES task (task_id),
  program_id TEXT NOT NULL REFERENCES programs (program_id),
  result SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

/** 
 * A record of all runs that were executed as the result
 * of a double send, should be empty
 */
CREATE TABLE IF NOT EXISTS duplicate_runs (
  run_id UUID NOT NULL,
  task_id BIGINT NOT NULL REFERENCES task (task_id),
  program_id TEXT NOT NULL REFERENCES programs (program_id),
  result SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

/**
 * Outbox with a idem key per run. Design decision based on assumption that
 * tasks runs are several ms per, so overhead is light. Obviously toy simulation
 * does not have this.
 */
CREATE TABLE IF NOT EXISTS outbox (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  task_id BIGINT NOT NULL REFERENCES task (task_id),
  program_id TEXT NOT NULL REFERENCES programs (program_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS run_task_id ON run (task_id);
CREATE INDEX IF NOT EXISTS run_program_id ON run (program_id);
CREATE INDEX IF NOT EXISTS outbox_created_at ON outbox (created_at);

