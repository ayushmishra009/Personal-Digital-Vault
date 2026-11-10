-- +goose Up
-- SQL in this section is executed when the migration is applied.

CREATE TABLE cms_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    module_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    description TEXT,
    icon_key VARCHAR(64) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    route_key VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_modules_account_key UNIQUE (account_id, module_key)
);

CREATE INDEX idx_cms_modules_account_order ON cms_modules(account_id, display_order);

CREATE TABLE cms_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    screen_key VARCHAR(64) NOT NULL,
    section_type VARCHAR(64) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    style_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    display_order INT NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cms_sections_account_screen_order ON cms_sections(account_id, screen_key, display_order);

CREATE TABLE cms_navigation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    route_key VARCHAR(64) NOT NULL,
    icon_key VARCHAR(64) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cms_navigation_account_order ON cms_navigation_items(account_id, display_order);

CREATE TABLE cms_theme_settings (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    theme_preset VARCHAR(64) NOT NULL DEFAULT 'default',
    primary_color VARCHAR(32) NOT NULL DEFAULT '#1c5230',
    border_radius VARCHAR(16) NOT NULL DEFAULT '8px',
    density VARCHAR(16) NOT NULL DEFAULT 'comfortable',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cms_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    revision_number INT NOT NULL,
    actor_device_id VARCHAR(64),
    change_summary TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_revisions_account_rev UNIQUE (account_id, revision_number)
);

CREATE INDEX idx_cms_revisions_account_rev ON cms_revisions(account_id, revision_number DESC);

-- +goose Down
-- SQL in this section is executed when the migration is rolled back.

DROP TABLE IF EXISTS cms_revisions;
DROP TABLE IF EXISTS cms_theme_settings;
DROP TABLE IF EXISTS cms_navigation_items;
DROP TABLE IF EXISTS cms_sections;
DROP TABLE IF EXISTS cms_modules;
