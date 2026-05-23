# Changelog

## Unreleased

- Hardened static serving with an explicit public file allowlist.
- Added signed auth tokens, demo-auth gating, production password-hash login, and login throttling.
- Added production configuration checks, security headers, request IDs, structured logs, and graceful shutdown.
- Added role and collection guards, admin-only exports, audit metadata, and read-only audit log protection.
- Added password reset token endpoints for future email integration.
- Added upload metadata validation scaffold for future private file storage.
- Added backup verification, go-live config checks, password-hash utility, and security regression tests.
- Added deployment templates for Caddy, systemd, Docker, and PM2.
- Added production hardening and production tracking docs.
