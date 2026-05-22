# Live Use Gap Outline

Last updated: 2026-05-22

SyncERP is ready for a controlled local pilot. The gaps below must be closed before broad live production use with real operational users and production records.

## Go / No-Go Summary

| Area | Current State | Live-Use Requirement | Status |
| --- | --- | --- | --- |
| Operational cleanup | Cleanup queue is clear. | Keep cleanup queue at zero before signoff. | Ready |
| Local pilot runtime | Node app runs locally; paid public hosting deferred. | Decide final production host before out-of-state employee access. | Gap |
| Database persistence | MAMP MySQL `syncerp` is the local pilot source of truth; JSON is backup/export fallback. | Move to hosted database when public hosting is approved. | Ready for local pilot |
| Backup / restore | Backup validation and isolated MySQL restore drill pass. | Choose final off-machine backup location. | Ready for local pilot |
| Real users | Pilot/demo users are seeded. | Replace demo emails with real users and least-privilege roles. | Gap |
| SQUAN Tracker | CSV recordkeeping is ready. | Billing confirms exact external Tracker fields with first real submission. | Gap |
| Acceptance workflow | Script/checklist is documented. | Execute one real production-to-payment test and capture results. | Gap |

## Required Before Live Use

### 1. Production Hosting Decision

Decide where the Node app will run for live use.

Required decisions:

- Host machine or hosting provider.
- Public/private access model.
- Who can start, stop, and restart the app.
- Port/domain/SSL approach.
- Where logs are stored.
- Recovery procedure if the app fails.

Exit criteria:

- App URL is known.
- Runtime owner is named.
- Restart procedure is documented.
- Health endpoint is reachable: `/api/health`.

### 2. Persistence Decision

The app can run from JSON or MySQL mode. The local controlled pilot source of truth is now MySQL.

Options:

- `DATA_DRIVER=mysql`: current local controlled pilot source of truth.
- `DATA_DRIVER=json`: backup/export fallback only.
- Future hosted database: required if access expands beyond the local machine.

Exit criteria:

- Source of truth is declared: MAMP MySQL `syncerp`.
- `.env` is configured locally and not committed.
- MySQL row counts are verified after import.
- App reads expected records in MySQL mode.

### 3. Backup And Restore Drill

Backup validation and the isolated MySQL restore rehearsal pass. Live use still needs a final off-machine backup location.

Required steps:

- Export backup from Admin/API. Done for local drill.
- Store backup in the approved backup location. Still requires final off-machine location.
- Validate backup. Done.
- Restore into a safe test copy or maintenance window. Done in `syncerp_restore_test`.
- Confirm row counts and key workflow records after restore. Done.
- Record backup owner and restore owner. Done: Admin.

Exit criteria:

- Restore drill date is recorded.
- Backup path is known locally.
- Off-machine backup location is selected.
- Owner is named.
- Recovery instructions are documented.

### 4. Real Users And Least-Privilege Roles

Demo logins are not live identities.

Required steps:

- Replace demo emails with real users.
- Assign each user the minimum role needed.
- Confirm Admin, Foreman, Operations, Billing, Safety/Compliance, and Crew Member views.
- Remove or disable training-only users before live use.
- Define who can approve, package, submit, record payment, and settle contractors.

Exit criteria:

- Real user list is approved.
- Role matrix is reviewed.
- Demo accounts are disabled, renamed, or clearly marked training-only.

### 5. SQUAN Tracker Field Confirmation

The app exports CSV recordkeeping data for manual SQUAN Tracker entry. Billing must confirm the exact external fields.

Required steps:

- Use one real SQUAN/Brightspeed submission.
- Compare package CSV fields to the external Tracker form.
- Add or rename fields if needed.
- Record the Tracker reference after manual submission.
- Confirm submitted amount, approved amount, paid amount, and holdback handling.

Exit criteria:

- Billing signs off field format.
- First real Tracker submission has a recorded reference.
- Any field changes are committed.

### 6. Real End-To-End Acceptance Test

Run the documented workflow with one real row.

Required path:

1. Import real SQUAN/Brightspeed source row.
2. Create linked Jackson resubmission.
3. Submit or save Foreman Daily Capture.
4. Admin/Ops approve or return with reason.
5. Billing prepares approved-only package.
6. Export SQUAN Tracker CSV.
7. Record manual SQUAN Tracker submission.
8. Record SQUAN response/payment/holdback.
9. Create contractor settlement.
10. Confirm reports and audit events.

Exit criteria:

- All workflow states are auditable.
- Reports match source, approved, billed, paid, retained, and settled totals.
- Any exception has owner, reason, and follow-up date.

## Recommended Hardening Before Wider Rollout

These should not block a controlled pilot, but they should happen before multiple users rely on the system daily.

| Hardening Item | Reason |
| --- | --- |
| Real authentication | Current demo login is not production security. |
| Password hashing and sessions | Required before real external access. |
| HTTPS / local network security | Protects credentials and financial workflow data. |
| MySQL write-load testing | Current MySQL mode is validated for pilot-scale usage. |
| Audit export review | Confirms every financial state change is traceable. |
| Role-based destructive-action QA | Submit, approve, return, package, payment, holdback, and payout need manual validation by role. |
| Error logging | Needed for support and recovery. |
| Production data retention policy | Defines what stays live, archived, or exported. |

## Current Pilot-Ready Evidence

- `npm run check` passes.
- Operational cleanup CSV has no blocker rows.
- Operational readiness CSV shows zero blockers.
- MAMP MySQL `syncerp` import is verified.
- Backup validation and isolated MySQL restore drill pass.
- MySQL mode reports `dataDriver: mysql` when enabled.
- MySQL mode is the local controlled pilot runtime through ignored `.env`.
- JSON remains the backup/export fallback.

## Final Live Signoff Checklist

- Production host selected.
- Source of truth selected for local pilot.
- `.env` configured outside git.
- Full restore drill completed.
- Off-machine backup location selected.
- Real user roster approved.
- Demo accounts handled.
- SQUAN Tracker fields confirmed.
- One real production-to-payment acceptance test passed.
- Manual destructive-action QA passed.
- GitHub `main` tagged for live release.
