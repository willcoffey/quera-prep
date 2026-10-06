CREATE TABLE IF NOT EXISTS task (
  task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idem_key TEXT NOT NULL UNIQUE,
  body JSONB NOT NULL,
  requested_runs INT NOT NULL DEFAULT 1000,
  complete_runs INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

/**
 * Outbox required to guarantee at least once delivery.
 * Entries deleted after pulsar ack
 */
CREATE TABLE IF NOT EXISTS outbox (
  task_id BIGINT PRIMARY KEY REFERENCES task (task_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now ()
);

/** A record of all runs that have been executed */
CREATE TABLE IF NOT EXISTS run (
  run_idx INT NOT NULL,
  task_id BIGINT NOT NULL REFERENCES task (task_id),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now (),
  PRIMARY KEY (task_id, run_idx)
);
