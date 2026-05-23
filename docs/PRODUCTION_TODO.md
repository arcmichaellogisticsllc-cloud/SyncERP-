# Production Completion Checklist

## Automated / In-Repo Completed

- Static file allowlist blocks `.env`, `data`, `server.js`, docs, scripts, and package files.
- Signed bearer tokens protect API routes after login.
- Demo auth can be disabled with `DEMO_AUTH=false`.
- Production mode validates critical env settings.
- Password-hash login path supports `passwordHash` user records.
- Login throttling limits repeated failures by IP/email.
- Security headers, request IDs, structured logs, and graceful shutdown are in place.
- Admin restore is disabled unless `ALLOW_ADMIN_RESTORE=true`.
- Audit log is read-only through generic CRUD.
- Upload metadata validation exists for allowed file types and sizes.
- Password reset token request/confirm endpoints exist for future email integration.
- Security regression tests cover private file blocking, auth, role restrictions, upload validation, reset token flow, production auth, and restore guard.
- Test harnesses use temporary DB copies so QA does not mutate `data/db.json`.
- Deployment templates exist for Caddy, systemd, Docker, and PM2.
- Runbooks exist for hardening, backups, monitoring, restore, and final drill.

## External / Needs Owner

- Local pilot: copy `.env.local-pilot.example` to `.env` and fill local MAMP password.
- Local pilot: import current seed into MAMP MySQL using `docs/LOCAL_PILOT_RUNBOOK.md`.
- Choose hosting platform and production domain.
- Provision HTTPS/reverse proxy and DNS.
- Provision production MySQL or hosted DB.
- Create least-privilege DB users and backup user.
- Store `AUTH_SECRET` and DB credentials in host secrets.
- Generate and assign real user `passwordHash` values.
- Configure scheduled DB backups and off-host retention.
- Configure log shipping and alerting.
- Choose private file storage and malware scanning.
- Choose transactional email provider.
- Wire reset/invite tokens to email delivery.
- Perform staging drill with production-like config.
- Validate customer/security policy requirements.
- Enable Live Mode only after staging, backup, auth, DB, HTTPS, and monitoring checks pass.
