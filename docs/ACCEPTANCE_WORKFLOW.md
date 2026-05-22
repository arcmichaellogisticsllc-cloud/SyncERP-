# Acceptance Workflow

Last updated: 2026-05-22

Run this before treating a deployment as live.

## Preconditions

- `npm run check` passes.
- `syncerp` exists in MAMP MySQL and row counts match the current seed.
- Runtime mode is known:
  - JSON mode: `DATA_DRIVER=json`
  - MySQL mode: `DATA_DRIVER=mysql`
- Real credentials, API keys, ArcGIS tokens, and customer secrets are not stored in the repo.

## One-Row Production-To-Payment Test

1. Import one real SQUAN/Brightspeed source row as read-only source data.
2. Create a linked Jackson resubmission rather than editing the source row.
3. Confirm Map/NTP, worked date, code, quantity, UOM, and proof reference.
4. Submit or save the Foreman Daily Capture record.
5. Admin/Ops reviews proof, code, quantity, Map/date match, and blockers.
6. If returned, correct through the correction path and confirm the original remains auditable.
7. Approve the production line.
8. Billing prepares an approved-only package snapshot.
9. Export the SQUAN Tracker recordkeeping CSV.
10. Record manual SQUAN Tracker submission reference, method, submitted by, and submitted at.
11. Record SQUAN response, approved amount, paid amount, short pay, holdback/reserve, and follow-up date.
12. Generate or update contractor settlement with agreement version, gross amount, deductions, net due, payment, and dispute/hold reason.
13. Confirm reports match submitted, approved, billed, paid, retained, and settled totals.
14. Confirm audit events exist for submit, review, approve/return, package, submission, response, payment, settlement, and close.

## Pass Criteria

- No blank screens or console-breaking workflow errors.
- No silent edits to submitted, approved, packaged, paid, or closed records.
- CSV exports match the package snapshot and payment records.
- Role views expose only the intended workflow surfaces.
- Backup export and restore validation both succeed.

## Blocker Policy

Block live use for:

- Missing audit events on financial state changes.
- Any destructive action that bypasses correction/revision.
- Package totals that do not match approved production and payment records.
- Missing backup/restore owner.
- Unconfirmed SQUAN Tracker fields.
