# Production Deployment Guide — Personal Digital Vault (PDV)

**Target Audience:** DevOps Engineers, System Administrators, and Self-Hosters.

---

## 1. Architecture Overview

```
                      Internet
                         │
                         ▼
             ┌─────────────────────────┐
             │ Reverse Proxy (TLS/HSTS)│
             │ Nginx / Caddy / Cloudflare│
             └───────────┬─────────────┘
                         │
        ┌────────────────┼────────────────┐
        │ :443           │ :443           │ :443
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  vault-web   │ │  admin-web   │ │   pdv-api    │
│  (Vite SPA)  │ │  (Vite SPA)  │ │  (Go Binary) │
└──────────────┘ └──────────────┘ └───────┬──────┘
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                                 ▼
              ┌─────────────────────┐           ┌─────────────────────┐
              │ PostgreSQL 16+      │           │ MinIO / RustFS S3   │
              │ (Metadata & Envelopes)│         │ (Encrypted Blobs)   │
              └─────────────────────┘           └─────────────────────┘
```

---

## 2. Infrastructure Requirements

- **Operating System:** Linux (Ubuntu 22.04 LTS / Debian 12 recommended) or Docker runtime.
- **Compute:** Minimum 2 vCPU, 4 GB RAM (to accommodate Argon2id p=4 memory requirements and database buffers).
- **Storage:** NVMe/SSD for PostgreSQL database and object storage.
- **TLS Certificate:** Valid TLS 1.3 certificate (e.g. Let's Encrypt).

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env` on production servers. **Never commit `.env` to source control.**

| Variable                  | Description                    | Production Example                                                            |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `APP_ENV`                 | Application environment        | `production`                                                                  |
| `API_ADDR`                | Internal listen address        | `127.0.0.1:8080`                                                              |
| `DATABASE_URL`            | PostgreSQL connection string   | `postgres://pdv_user:<SECURE_PASSWORD>@10.0.0.5:5432/pdv?sslmode=verify-full` |
| `WEB_ORIGIN`              | Allowed client origin for CORS | `https://vault.example.com`                                                   |
| `ADMIN_ORIGIN`            | Allowed admin origin for CORS  | `https://admin.example.com`                                                   |
| `OBJECT_STORAGE_ENDPOINT` | MinIO or S3 endpoint           | `s3.example.com`                                                              |
| `OBJECT_STORAGE_BUCKET`   | S3 bucket for encrypted blobs  | `pdv-encrypted-attachments`                                                   |

> [!CAUTION]
> **Zero Client Keys Policy:** Never define encryption keys (VEK, DEK, master passwords, recovery secrets) in server environment variables or configuration files. Cryptographic keys exist strictly on user endpoints.

---

## 4. Reverse Proxy & Security Headers (Nginx Example)

```nginx
server {
    listen 443 ssl http2;
    server_name vault.example.com;

    ssl_certificate /etc/letsencrypt/live/vault.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.example.com/privkey.pem;
    ssl_protocols TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Defense-in-depth headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;

    # Static Web App
    location / {
        root /var/www/pdv/vault-web;
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;
        client_max_body_size 105M; # 100MB max attachment + envelope overhead
    }
}
```

---

## 5. Maintenance & Retention Operations

### Tombstone & Soft-Deletion Purge Job

To enforce the 30-day sync tombstone window and clean up soft-deleted records:
Schedule a daily cron job invoking the database maintenance purge:

```bash
# Example nightly cron job at 03:00 UTC
0 3 * * * /usr/local/bin/pdv-api --maintenance-purge-older-than 720h >> /var/log/pdv-purge.log 2>&1
```

### Database Backups

Execute daily PostgreSQL base backups:

```bash
pg_dump -U pdv_user -Fc -d pdv -f "/var/backups/pdv_$(date +\%Y\%m\%d).dump"
```

_Note:_ The database backup contains only encrypted ciphertext envelopes. Even if the backup dump is intercepted, the attacker cannot read vault contents without the user's master password or 256-bit recovery secret.
