-- +goose Up
CREATE TABLE vault_backups (
    snapshot_id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
    ciphertext_hash BYTEA NOT NULL CHECK (octet_length(ciphertext_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, vault_id) REFERENCES vaults (account_id, id) ON DELETE CASCADE
);
CREATE INDEX vault_backups_vault_idx ON vault_backups (account_id, vault_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS vault_backups;
