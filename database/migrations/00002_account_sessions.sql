-- +goose Up
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_device_idx ON sessions (device_id);
CREATE INDEX sessions_token_hash_idx ON sessions (token_hash);

-- +goose Down
DROP TABLE IF EXISTS sessions;
