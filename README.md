# Personal Digital Vault

Personal Digital Vault is a local-first vault application with client-side encryption, a Go API, a protected Admin/CMS surface, and a Chrome extension. Phase 0 and Phase 1 foundations are in place. Phase 2 has a partial, unreviewed TypeScript crypto-core prototype; authentication, CMS behavior, and vault APIs are not implemented, and the prototype must not be used with real vault data.

## Prerequisites

- Windows 10/11 with Windows PowerShell 5.1 or newer
- Docker Desktop with Docker Compose v2
- Node.js 22 or newer and pnpm 12.16.1
- Go 1.26 or newer
- Chrome for extension development

## Start local development

From the repository root:

```powershell
pnpm install
pnpm dev:services:up
pnpm db:migrate
pnpm dev
```

The first service startup creates an ignored `.env` with random local-only Postgres and RustFS credentials. Compose binds service ports to loopback. `pnpm db:migrate` applies the versioned schema. `pnpm db:rollback` rolls back the latest migration and drops the Phase 1 schema in a fresh local database; do not use it against data you want to keep. RustFS's development console is available at `http://127.0.0.1:9001`.

`pnpm dev` starts the Vault app (`http://localhost:5173`), Admin app (`http://localhost:5174`), Chrome extension dev server, and Go API (`http://127.0.0.1:8080`). Stop services with `pnpm dev:services:down`.

Run `pnpm api:generate` after changing the OpenAPI contract; run `pnpm contract:lint` to validate it. The generated client currently provides types only. The OpenAPI routes describe future behavior and are not implemented handlers.

The API reads `DATABASE_URL` from the ignored root `.env` when started through `pnpm dev:api`; the API package can also be started directly after setting its required environment variables. `/health/live` checks process liveness. `/health/ready` checks the configured PostgreSQL connection. OpenAPI describes future account, device, vault, and sync operations, but only the health endpoints currently have handlers. Object storage is configured but not yet used by the API.

## Managed-service development

The API accepts a PostgreSQL `DATABASE_URL` and generic S3 settings through environment variables. For managed development, use separate Neon and Cloudflare R2 development resources and provide their credentials in a local ignored `.env`. Do not use production credentials or data locally. Do not expose storage credentials to either browser app.

Local Compose services keep the project runnable without managed services or paid infrastructure. The free-tier providers are convenience options, not production availability guarantees; check their current terms before deployment.

## Repository layout

- `apps/vault-web`: user-facing React application
- `apps/admin-web`: separate Admin/CMS React application
- `apps/extension`: WXT Chrome MV3 extension shell
- `apps/api`: Go modular-monolith API
- `packages/data-models`: shared TypeScript domain models, including explicitly client-only decrypted record types
- `packages/validation`: strict Zod runtime schemas
- `packages/api-client`: generated OpenAPI types
- `contracts/openapi.yaml`: API contract
- `database/migrations`: versioned Goose SQL migrations
- `docs`: implementation, architecture, decisions, security, and test documentation

## Security and scope

Never commit `.env` files, credentials, real personal data, vault keys, unlock passwords, or recovery secrets. The API has no authentication or vault-data handlers yet. The database contains account/device metadata and ciphertext-shaped columns only; the schema is not a substitute for API authorization. Do not use this build with real vault data. See `docs/SECURITY_NOTES.md` and `docs/IMPLEMENTATION_STATUS.md`.
