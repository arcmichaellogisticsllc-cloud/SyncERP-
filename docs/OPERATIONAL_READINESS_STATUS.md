# Operational Readiness Status

Last updated: 2026-05-22

## Current Status

SyncERP is ready for a controlled local pilot, not broad live external use.

The readiness cleanup queue is clear:

- Demo/training production rows are archived and excluded from live readiness blockers.
- RDB daily `226231` / `PL-RDB-226231-HRS` is approved as an accepted proof exception with a prior-approval billing hold.
- MAMP MySQL `syncerp` is imported and verified.
- Backup export validation passes.
- JSON remains the default runtime; MySQL mode is available with `DATA_DRIVER=mysql`.

## Remaining Live Signoffs

These are external/business signoffs, not code blockers:

| Item | Status | Owner | Live Requirement |
| --- | --- | --- | --- |
| SQUAN Tracker field format | Pilot CSV ready; Billing signoff pending | Billing | Confirm exact external Tracker columns with the first real submission. |
| Real users/roles | Pilot seeded | Admin | Replace demo emails with real users and least-privilege roles. |
| Full restore drill | Validation passed; full restore pending maintenance window | Admin | Execute one restore rehearsal before production data entry. |
| Hosting target | Local Node pilot | Admin / Technical owner | Choose production host before external access. |

See [LIVE_USE_GAP_OUTLINE.md](LIVE_USE_GAP_OUTLINE.md) for the full live-use checklist.

## Verification Commands

```bash
npm run check
npm run mysql:export
```

Readiness reports:

```bash
curl http://127.0.0.1:8090/api/reports/operational-readiness.csv
curl http://127.0.0.1:8090/api/reports/operational-cleanup.csv
curl http://127.0.0.1:8090/api/reports/operational-closeout.csv
```

MySQL counts:

```bash
/Applications/MAMP/Library/bin/mysql80/bin/mysql \
  --socket=/Applications/MAMP/tmp/mysql/mysql.sock \
  -uroot -p syncerp \
  -e "SELECT 'app_state' AS table_name, COUNT(*) AS rows_count FROM app_state UNION ALL SELECT 'records', COUNT(*) FROM records UNION ALL SELECT 'audit_events', COUNT(*) FROM audit_events;"
```
