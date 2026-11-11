-- +goose Up
CREATE TABLE attachment_blobs (
    attachment_id UUID PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    ciphertext_blob BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS attachment_blobs;
