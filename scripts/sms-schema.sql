-- Additive migration. Apply manually after review; never bootstrap legacy schema.
BEGIN;
CREATE TABLE IF NOT EXISTS sms_threads (
  id uuid PRIMARY KEY,
  scope_key text NOT NULL,
  local_number text NOT NULL CHECK (local_number ~ '^\+[1-9][0-9]{7,14}$'),
  remote_number text NOT NULL CHECK (remote_number ~ '^\+[1-9][0-9]{7,14}$'),
  lead_id integer REFERENCES contacts(id) ON DELETE SET NULL,
  name text NOT NULL,
  preview text NOT NULL DEFAULT '',
  unread boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,local_number,remote_number)
);
CREATE TABLE IF NOT EXISTS sms_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES sms_threads(id),
  text text NOT NULL,
  outgoing boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('received','sending','queued','failed','unknown','delivered')),
  client_request_id text,
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS sms_messages_thread_time ON sms_messages(thread_id,created_at,id);
CREATE TABLE IF NOT EXISTS sms_receipts (
  event_id text PRIMARY KEY,
  payload_hash text NOT NULL,
  message_id uuid REFERENCES sms_messages(id),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sms_suppressions (
  scope_key text NOT NULL,
  local_number text NOT NULL,
  remote_number text NOT NULL,
  reason text NOT NULL DEFAULT 'STOP',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_key,local_number,remote_number)
);
CREATE TABLE IF NOT EXISTS sms_reconciliations (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES sms_messages(id),
  previous_status text NOT NULL,
  resolved_status text NOT NULL,
  provider_id text,
  actor text NOT NULL,
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
