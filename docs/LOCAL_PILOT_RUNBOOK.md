# Local Pilot Runbook

Use this for a controlled local pilot on the Mac with Node and MAMP MySQL.

## 1. Prepare Local Env

Copy the template into the ignored `.env` file:

```bash
cp .env.local-pilot.example .env
```

Then edit `.env`:

- set `AUTH_SECRET` to a local 32+ character secret
- set `MYSQL_PASSWORD` to the local MAMP MySQL password
- keep `DEMO_AUTH=true` for the local pilot unless all users have `passwordHash`

## 2. Start MAMP MySQL

Confirm the socket exists:

```bash
ls /Applications/MAMP/tmp/mysql/mysql.sock
```

## 3. Export And Import Current Seed

Generate import SQL:

```bash
npm run mysql:export
```

Import into MAMP MySQL:

```bash
/Applications/MAMP/Library/bin/mysql80/bin/mysql \
  --socket=/Applications/MAMP/tmp/mysql/mysql.sock \
  -uroot -p < tmp/syncerp-mysql-import.sql
```

## 4. Verify Database

```bash
/Applications/MAMP/Library/bin/mysql80/bin/mysql \
  --socket=/Applications/MAMP/tmp/mysql/mysql.sock \
  -uroot -p syncerp \
  -e "SELECT collection_name, COUNT(*) AS rows_count FROM records GROUP BY collection_name ORDER BY collection_name; SELECT COUNT(*) AS audit_events FROM audit_events;"
```

## 5. Start App

```bash
npm start
```

Open:

```text
http://127.0.0.1:8090
```

## 6. Pilot Login

Demo logins are still available while `DEMO_AUTH=true`.

Use password:

```text
demo
```

## 7. Health Checks

```bash
curl http://127.0.0.1:8090/api/health
curl http://127.0.0.1:8090/api/health/db
```

Expected:

- `/api/health` returns `ok: true`
- `/api/health/db` returns `ok: true`
- `dataDriver` is `mysql`

## 8. Pilot Guardrails

- Do not expose this local pilot publicly.
- Do not commit `.env`.
- Keep `ALLOW_ADMIN_RESTORE=false` unless performing a planned restore drill.
- Keep backups before changing real pilot data.
- Use `docs/PRODUCTION_HARDENING.md` before any public deployment.
