# Production Hardening Runbook

This app can run a controlled local pilot, but production requires these controls to be configured outside the repo before enabling Live Mode.

## Required Environment

Use real deployment secrets, not committed files.

```bash
NODE_ENV=production
PRODUCTION_MODE=true
DEMO_AUTH=false
AUTH_SECRET=<strong random secret, 32+ chars>
DATA_DRIVER=mysql
ALLOW_JSON_PRODUCTION=false
ALLOW_INSECURE_HTTP=false
ALLOW_ADMIN_RESTORE=false
DEBUG_ERRORS=false
TRUST_PROXY=true
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=8
```

`ALLOW_INSECURE_HTTP=true` is only acceptable for a private pilot behind another trusted control. Public deployments must terminate HTTPS before Node and forward `X-Forwarded-Proto: https`.

Run the config gate before enabling Live Mode:

```bash
npm run go-live:check
```

Use `.env.production.example` as the deployment template.

## HTTPS / Reverse Proxy

Use the Caddy template in `deploy/caddy/Caddyfile` or an equivalent Nginx/managed-platform setup. Required behavior:

- redirect public HTTP to HTTPS
- forward `X-Forwarded-Proto: https`
- keep `ALLOW_INSECURE_HTTP=false`
- keep the Node process on a private listener where possible

## Passwords

Demo password login is only allowed with `DEMO_AUTH=true`.

Generate production password hashes with:

```bash
npm run auth:hash -- "long unique passphrase"
```

Store the resulting `scrypt$...` value on the user record as `passwordHash`. Do not store plain-text passwords.

Production login has basic IP/email throttling through `LOGIN_RATE_LIMIT_WINDOW_MS` and `LOGIN_RATE_LIMIT_MAX`. Add an email invite/reset flow before letting users self-manage credentials.

## Database

JSON persistence is for demos and isolated QA. Production should use MySQL or a hosted database with:

- migration/import procedure tested before cutover
- least-privilege DB account
- scheduled backups
- restore drill before go-live
- monitoring for failed reads/writes

Run the app with a process manager. Starter templates are available:

- `deploy/systemd/syncerp.service`
- `deploy/pm2/ecosystem.config.cjs`
- `Dockerfile`

## Backups And Restore

Backup export stays admin-only. Restore is disabled in production unless `ALLOW_ADMIN_RESTORE=true`.

Open restore only for a controlled maintenance window, then set it back to false.

Verify exported backups before storing or restoring them:

```bash
npm run backup:verify -- path/to/backup.json
```

## Audit

Audit events should be treated as compliance records. Production operators should:

- export or replicate audit events to append-only storage
- monitor auth failures and destructive actions
- avoid restore workflows that replace audit history without retaining the previous backup
- preserve request IDs, actor IDs, IPs, and user agents in external log retention

## Uploads

Before accepting real uploads, add:

- file size limits
- extension and MIME validation
- isolated storage outside the public web root
- malware scanning where required by customer policy
- signed/private access URLs

Recommended implementation: store metadata in the app database and actual files in S3-compatible private storage. Serve downloads through authenticated, short-lived signed URLs.

## Email / Password Reset

Add a transactional email provider before public onboarding. Reset/invite tokens should be:

- random, single-use, and short-lived
- stored hashed where possible
- audited on request and completion
- never include passwords in email

## Network Access

Restrict database access to the app host/private network. Restrict admin restore and deployment operations by VPN, private network, or IP allowlist where the host supports it.

## Monitoring

Monitor:

- `/api/health`
- `/api/health/db`
- auth failure rate
- backup/restore events
- report/export failures
- write failures and 500 responses

Detailed errors should remain server-side. Keep `DEBUG_ERRORS=false` outside development.

Structured JSON request logs are emitted by the Node process. Forward stdout/stderr to the host log system and alert on:

- repeated `auth.failed` or `auth.rate_limited`
- `request.error`
- `/api/health/db` failures
- restore attempts
- 5xx response rates

## Final Drill

Before public launch:

1. Deploy staging with production-like env.
2. Run `npm run check`.
3. Run `npm run go-live:check`.
4. Verify all active users have `passwordHash`.
5. Verify `/api/health` and `/api/health/db`.
6. Export and verify a backup.
7. Restore the backup into a clean non-production DB.
8. Test each role's login and core workflow.
9. Confirm rollback and log access.
