-- +goose Up
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_normalized TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounts_email_normalized CHECK (email_normalized = lower(email_normalized))
);

CREATE TABLE auth_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL CHECK (credential_type IN ('webauthn', 'external')),
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA,
    external_subject TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    CONSTRAINT auth_credentials_shape CHECK (
        (credential_type = 'webauthn' AND public_key IS NOT NULL AND external_subject IS NULL)
        OR (credential_type = 'external' AND public_key IS NULL AND external_subject IS NOT NULL)
    ),
    UNIQUE (account_id, id)
);

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key_algorithm TEXT NOT NULL,
    public_key BYTEA NOT NULL,
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
    platform TEXT NOT NULL CHECK (length(platform) BETWEEN 1 AND 80),
    browser TEXT NOT NULL CHECK (length(browser) BETWEEN 1 AND 80),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    UNIQUE (account_id, id),
    CONSTRAINT devices_revocation_state CHECK (
        (status = 'revoked' AND revoked_at IS NOT NULL) OR (status <> 'revoked' AND revoked_at IS NULL)
    )
);
CREATE INDEX devices_account_status_idx ON devices (account_id, status, created_at DESC);

CREATE TABLE device_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    challenge_hash BYTEA NOT NULL CHECK (octet_length(challenge_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    approval_signature BYTEA,
    approver_device_id UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, id) ON DELETE CASCADE,
    FOREIGN KEY (account_id, approver_device_id) REFERENCES devices (account_id, id),
    CONSTRAINT enrollment_approval_state CHECK (
        (status = 'approved' AND approval_signature IS NOT NULL AND approver_device_id IS NOT NULL AND approved_at IS NOT NULL)
        OR (status <> 'approved' AND approval_signature IS NULL AND approver_device_id IS NULL AND approved_at IS NULL)
    ),
    UNIQUE (account_id, id)
);
CREATE INDEX device_enrollments_expiry_idx ON device_enrollments (expires_at) WHERE status = 'pending';

CREATE TABLE vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    protocol_version SMALLINT NOT NULL CHECK (protocol_version > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (account_id, id),
    CONSTRAINT vault_deletion_state CHECK (
        (status = 'deleted' AND deleted_at IS NOT NULL) OR (status = 'active' AND deleted_at IS NULL)
    )
);
CREATE INDEX vaults_account_status_idx ON vaults (account_id, status, created_at DESC);

CREATE TABLE vault_key_envelopes (
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    envelope_type TEXT NOT NULL CHECK (envelope_type IN ('password', 'recovery')),
    protocol_version SMALLINT NOT NULL CHECK (protocol_version > 0),
    key_wrap_algorithm TEXT NOT NULL CHECK (length(key_wrap_algorithm) BETWEEN 1 AND 64),
    kdf_algorithm TEXT NOT NULL CHECK (length(kdf_algorithm) BETWEEN 1 AND 64),
    kdf_parameters JSONB NOT NULL CHECK (jsonb_typeof(kdf_parameters) = 'object'),
    salt BYTEA NOT NULL,
    wrapped_vek BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, envelope_type),
    FOREIGN KEY (account_id, vault_id) REFERENCES vaults (account_id, id) ON DELETE CASCADE
);

CREATE TABLE vault_objects (
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    object_id UUID NOT NULL,
    current_revision BIGINT NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, object_id),
    UNIQUE (account_id, vault_id, object_id),
    FOREIGN KEY (account_id, vault_id) REFERENCES vaults (account_id, id) ON DELETE CASCADE
);
CREATE INDEX vault_objects_account_vault_idx ON vault_objects (account_id, vault_id, object_id);

CREATE TABLE vault_object_revisions (
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    object_id UUID NOT NULL,
    revision BIGINT NOT NULL CHECK (revision > 0),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    protocol_version SMALLINT,
    algorithm TEXT,
    key_wrap_algorithm TEXT,
    payload_version SMALLINT,
    purpose TEXT,
    nonce BYTEA,
    wrapped_dek BYTEA,
    ciphertext BYTEA,
    ciphertext_hash BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, object_id, revision),
    FOREIGN KEY (account_id, vault_id, object_id)
        REFERENCES vault_objects (account_id, vault_id, object_id) ON DELETE CASCADE,
    CONSTRAINT encrypted_revision_shape CHECK (
        (is_deleted AND protocol_version IS NULL AND algorithm IS NULL AND key_wrap_algorithm IS NULL
            AND payload_version IS NULL AND purpose IS NULL AND nonce IS NULL AND wrapped_dek IS NULL
            AND ciphertext IS NULL AND ciphertext_hash IS NULL)
        OR
        (NOT is_deleted AND protocol_version IS NOT NULL AND protocol_version > 0
            AND algorithm IS NOT NULL AND key_wrap_algorithm IS NOT NULL
            AND payload_version IS NOT NULL AND payload_version > 0
            AND purpose IS NOT NULL AND nonce IS NOT NULL AND wrapped_dek IS NOT NULL
            AND ciphertext IS NOT NULL AND ciphertext_hash IS NOT NULL AND octet_length(ciphertext_hash) = 32)
    )
);
CREATE INDEX vault_object_revisions_lookup_idx ON vault_object_revisions (account_id, vault_id, object_id, revision DESC);

CREATE TABLE sync_events (
    sequence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    operation_id UUID NOT NULL,
    device_id UUID NOT NULL,
    object_id UUID NOT NULL,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('upsert', 'delete')),
    base_revision BIGINT NOT NULL CHECK (base_revision >= 0),
    new_revision BIGINT NOT NULL CHECK (new_revision = base_revision + 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, vault_id, object_id)
        REFERENCES vault_objects (account_id, vault_id, object_id) ON DELETE CASCADE,
    FOREIGN KEY (vault_id, object_id, new_revision)
        REFERENCES vault_object_revisions (vault_id, object_id, revision) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, id),
    UNIQUE (vault_id, operation_id),
    UNIQUE (vault_id, object_id, new_revision)
);
CREATE INDEX sync_events_vault_cursor_idx ON sync_events (vault_id, sequence_id);

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    vault_id UUID NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    ciphertext_size BIGINT NOT NULL CHECK (ciphertext_size > 0),
    ciphertext_hash BYTEA NOT NULL CHECK (octet_length(ciphertext_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    FOREIGN KEY (account_id, vault_id) REFERENCES vaults (account_id, id) ON DELETE CASCADE,
    UNIQUE (account_id, vault_id, id)
);
CREATE INDEX attachments_vault_idx ON attachments (account_id, vault_id, created_at DESC);

CREATE TABLE idempotency_records (
    account_id UUID NOT NULL,
    device_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    request_digest BYTEA NOT NULL CHECK (octet_length(request_digest) = 32),
    response_status SMALLINT NOT NULL CHECK (response_status BETWEEN 200 AND 599),
    response_resource_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (account_id, device_id, idempotency_key),
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, id) ON DELETE CASCADE,
    CHECK (expires_at > created_at)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records (expires_at);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id UUID,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'account_created', 'device_enrollment_started', 'device_enrollment_approved',
        'device_revoked', 'vault_created', 'vault_deleted', 'key_envelope_changed',
        'sync_operation_accepted', 'backup_metadata_changed'
    )),
    resource_id UUID,
    request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, device_id) REFERENCES devices (account_id, id)
);
CREATE INDEX audit_events_account_time_idx ON audit_events (account_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS sync_events;
DROP TABLE IF EXISTS vault_object_revisions;
DROP TABLE IF EXISTS vault_objects;
DROP TABLE IF EXISTS vault_key_envelopes;
DROP TABLE IF EXISTS vaults;
DROP TABLE IF EXISTS device_enrollments;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS auth_credentials;
DROP TABLE IF EXISTS accounts;
