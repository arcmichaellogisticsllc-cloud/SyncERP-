# Operational Closeout Runbook

This runbook defines the remaining work to move Jackson Telecom ERP from workflow-complete to operationally complete.

## Closeout Checklist

1. Real workflow validation: walk real SQUAN/Brightspeed imports through Jackson resubmission, Admin approval, Billing package, SQUAN response, payment, and contractor settlement.
2. Persistence/database prep: keep Node as the runtime and prepare MAMP MySQL schema for durable storage beyond `data/db.json`.
3. Role permission QA: verify Foreman, Admin, Operations, Billing, and Safety/Compliance only see permitted screens and actions.
4. Final UX polish: keep Home role-command first and move dense views into Reports/Tools drawers.
5. Backup/restore/go-live procedure: export backup, validate restore, and document who owns the backup.
6. Real users/roles: seed actual users and assign least-privilege roles.
7. Record locking rules: submitted, approved, packaged, SQUAN-submitted, paid, and closed records require revision/correction instead of silent edits.
8. Correction/revision SOP: corrections preserve originals, create linked revisions, require a reason, and reopen downstream readiness where needed.
9. Required field matrix: required fields are enforced by workflow owner before the record can move forward.
10. Confirm SQUAN Tracker field format: Billing must verify the manual external Tracker fields against a real submission.
11. Exception handling: missing proof, wrong code, wrong quantity, wrong map/date, SQUAN rejection, short-pay/holdback, and contractor dispute each need owner/action/follow-up.
12. Audit trail review: confirm submit, review, approve/return, package, SQUAN submission, payment, deduction, settlement, and close events are logged.
13. Operational dashboard finalization: Home should show only next actions by role.
14. Data retention/archive rules: closed records remain audit records; demo/training rows move to archive and do not block live readiness.
15. Deployment runbook: document app start, data path, backup path, restore process, and admin recovery.
16. Acceptance test script: execute one end-to-end production-to-payment test before live use.
17. Data import SOP: import real SQUAN/Brightspeed files as read-only originals; archive demo; use linked Jackson resubmissions for billing.

## Required Fields

| Workflow | Owner | Required Before Moving Forward |
| --- | --- | --- |
| Foreman Daily | Foreman | Map/NTP, worked date, submitter, SQUAN billing code, quantity, UOM, proof note/reference |
| Admin/Ops Review | Operations | Source daily, code, quantity, proof state, map/date match, return/approve reason |
| Billing Package | Billing | Package key, map, worked date, code, quantity, rate source, proof accepted, Admin approval |
| Manual SQUAN Tracker | Billing | Tracker reference, method, submitted by, submitted at, package snapshot, recordkeeping CSV |
| SQUAN Response / Payment | Billing | Response status, approved amount, paid amount, holdback/reserve flag, reason, expected release, follow-up |
| Contractor Settlement | Billing | Agreement version, gross amount, deductions/expenses, net due, payment, dispute/hold reason |

## Locking Rules

| Stage | Rule |
| --- | --- |
| Foreman submitted | Submitted lines are editable only through return/correction. |
| Admin approved | Code, quantity, proof, and worked date require Admin/Ops revision reason. |
| Billing packaged | Package snapshot preserves rates, quantities, source daily, and proof state. |
| Submitted to SQUAN Tracker | Submitted package cannot be silently changed; create correction package or revision. |
| Approved / paid / closed | Payment and settlement records are audit-only after close unless Admin reopens with reason. |

## Acceptance Test

Run this before go-live:

1. Import one real SQUAN/Brightspeed source row.
2. Create a linked Jackson resubmission.
3. Confirm code, quantity, Map/NTP, worked date, and proof.
4. Admin/Ops approves or returns with reason.
5. Billing packages approved production.
6. Export the SQUAN Tracker recordkeeping CSV.
7. Record manual SQUAN Tracker submission reference.
8. Record SQUAN response, paid amount, and any holdback/reserve.
9. Generate contractor settlement with deductions/expenses visible.
10. Confirm reports match the submitted, approved, paid, and settlement totals.
