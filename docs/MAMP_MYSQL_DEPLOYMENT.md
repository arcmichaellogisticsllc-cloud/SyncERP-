# MAMP MySQL Deployment Prep

Last updated: 2026-05-22

phpMyAdmin confirms the local database target:

- MySQL version: 8.0.44
- phpMyAdmin: 5.2.3
- Local socket: `/Applications/MAMP/tmp/mysql/mysql.sock`
- CLI client: `/Applications/MAMP/Library/bin/mysql80/bin/mysql`
- Character set/collation target: `utf8mb4` / `utf8mb4_unicode_ci`

Do not commit real database passwords, API keys, ArcGIS tokens, customer credentials, or production exports.

## Current Persistence State

The app still runs on Node and persists to `data/db.json`. MAMP MySQL is the next durable-storage target. The first migration step is a lossless JSON-backed schema so the current data can be imported, counted, backed up, and queried before the app runtime is changed.

## Schema

Initial schema file:

```bash
database/schema.mysql.sql
```

The schema creates:

- `app_state`: top-level `company` and `meta` objects.
- `records`: one row per application record, keyed by `collection_name` and `record_id`, with indexed workflow fields and full JSON payload.
- `audit_events`: audit log rows separated for easier review and reporting.

This is intentionally conservative. After import validation, high-value workflows can be normalized into relational tables without losing the original payloads.

## Generate Import SQL

```bash
node scripts/export-mysql-seed.js
```

Output:

```bash
tmp/syncerp-mysql-import.sql
```

`tmp/` is not committed. Regenerate the file from the current `data/db.json` whenever the seed dataset changes.

## Import With MAMP MySQL CLI

```bash
/Applications/MAMP/Library/bin/mysql80/bin/mysql \
  --socket=/Applications/MAMP/tmp/mysql/mysql.sock \
  -uroot -p < tmp/syncerp-mysql-import.sql
```

Enter the local MAMP MySQL password when prompted. If using phpMyAdmin instead, open the `Import` tab and upload `tmp/syncerp-mysql-import.sql`.

## Verify Import

```bash
/Applications/MAMP/Library/bin/mysql80/bin/mysql \
  --socket=/Applications/MAMP/tmp/mysql/mysql.sock \
  -uroot -p syncerp \
  -e "SELECT collection_name, COUNT(*) AS rows_count FROM records GROUP BY collection_name ORDER BY collection_name; SELECT COUNT(*) AS audit_events FROM audit_events;"
```

## Runtime Migration Steps

1. Import current JSON into MySQL and confirm row counts.
2. Add a database adapter behind `readDb()` and `writeDb()` in `server.js`.
3. Keep JSON backup/export working during the transition.
4. Run `npm run check` against JSON mode.
5. Run the same workflow checks against MySQL mode.
6. Lock down real users, backup/restore, and destructive-action QA before live pilot.

## Runtime Mode

For the local controlled pilot, MySQL is the runtime source of truth through the ignored local `.env` file:

```bash
npm start
```

Equivalent explicit command:

```bash
DATA_DRIVER=mysql \
MYSQL_SOCKET=/Applications/MAMP/tmp/mysql/mysql.sock \
MYSQL_BIN=/Applications/MAMP/Library/bin/mysql80/bin/mysql \
MYSQL_DATABASE=syncerp \
MYSQL_USER=root \
MYSQL_PASSWORD='your-local-password' \
npm start
```

Use JSON only as a fallback/export mode:

```bash
DATA_DRIVER=json npm start
```

The `/api/health` endpoint reports the active data driver. Keep `.env` local and uncommitted.

## Tables To Normalize First

Start with these after the lossless JSON import is validated:

- `users`
- `roles`
- `projects`
- `productionDailies`
- `productionLines`
- `priceSheetItems`
- `billingLedger`
- `packageSnapshots`
- `invoiceSubmissions`
- `cashReceipts`
- `contractorAgreements`
- `contractorSettlements`
- `auditLog`
