# Deployment Readiness Outline

Last updated: 2026-05-22

This outline defines what remains to move SyncERP from local workflow prototype to a controlled deployment.

## Current Release Shape

The local release stack is organized into reviewable commits:

1. Production billing workflow foundation: Node API, JSON seed data, billing workflow persistence, local server helpers, smoke tests, and phase workflow tests.
2. ERP workflow UI: Admin home, Daily Capture, Billing, Reports, role navigation, workflow rails, and responsive polish.
3. Workflow deployment QA coverage: confidence checks, browser click QA, viewport QA, and workflow QA notes.
4. Deployment readiness documentation: this outline plus closeout/runbook documents.

The pre-cleanup commit stack is preserved on `backup/pre-cleanup-20260522-142558`.

## Deployment Goal

Deploy a controlled internal Jackson Telcom ERP instance that can support real SQUAN/Brightspeed workflow validation without exposing secrets, losing audit history, or mixing demo/training records with live production records.

## Required Decisions

| Decision | Owner | Required Before |
| --- | --- | --- |
| Hosting target for the Node app | Admin / Technical owner | Deployment build |
| Durable database target, likely MAMP MySQL first | Admin / Technical owner | Real data entry |
| Backup location and restore owner | Admin | Live pilot |
| Real user list and roles | Admin | Role QA |
| SQUAN Tracker field format confirmation | Billing | Billing package submission |
| ArcGIS auth strategy and non-secret metadata | Admin / Operations | Live ArcGIS read-only integration |
| Demo/training archive policy | Admin | Live readiness signoff |

## Technical Readiness Checklist

| Area | Status | Next Action |
| --- | --- | --- |
| Local app runtime | Ready for local validation | Continue using `npm start` for local review. |
| Automated QA | Ready | Run `npm run check` before every release candidate. |
| JSON persistence | Prototype-ready only | Keep backups; do not treat `data/db.json` as final durable storage. |
| MySQL migration | Not started | Design schema from `docs/DATA_MODEL.md` and current `data/db.json` collections. |
| Secrets handling | Partially defined | Keep ArcGIS/API credentials outside repo and outside `data/db.json`. |
| Audit trail | Implemented in app flows | Review submit, approve, return, package, SQUAN response, payment, settlement, and close events. |
| Record locking | App rules started | Validate correction/revision flows against real examples. |
| Backup/restore | Controls documented | Execute an export and restore drill before live pilot. |
| Browser compatibility | Covered for core paths | Add manual destructive-action QA before go-live. |

## Operational Readiness Checklist

| Workflow | Required Validation |
| --- | --- |
| Map setup | Real Map/NTP, scope, required documents, 811/permit, crew/equipment readiness, and release gate. |
| Foreman Daily Capture | Real work date, billing code, quantity, UOM, proof note/reference, submit/correction flow. |
| Admin/Ops Review | Proof state, code, quantity, Map/date match, blockers, approve/return reason. |
| Billing Package | Approved-only lines, package snapshot, rate source, proof accepted, export/recordkeeping CSV. |
| Manual SQUAN Tracker | Tracker reference, method, submitted by, submitted at, package snapshot. |
| SQUAN Response / Payment | Approved amount, paid amount, short pay, holdback/reserve, follow-up date. |
| Contractor Settlement | Agreement version, gross amount, deductions, net due, payment, dispute/hold reason. |
| Reports / Audit | Submitted, approved, paid, retained, settled, and exception totals match source records. |

## Go-Live Phases

### Phase 1: Release Candidate

- Keep the cleaned commit stack on `main`.
- Decide whether generated `data/db.json` demo state should be committed, archived, or discarded.
- Run `npm run check`.
- Review the app at `http://127.0.0.1:8090` or the selected local port.
- Capture the release notes from the grouped commits.

### Phase 2: Pilot Data Prep

- Archive or flag demo/training rows so they do not affect live readiness counts.
- Seed real users with least-privilege roles.
- Import one real SQUAN/Brightspeed source row as read-only source data.
- Create a linked Jackson resubmission rather than editing the imported source row.
- Confirm SQUAN Tracker fields with Billing.

### Phase 3: End-to-End Acceptance Test

- Walk one real row through Foreman daily, Admin approval, Billing package, SQUAN submission, payment/holdback, contractor settlement, and reports.
- Confirm every state transition has an audit log entry.
- Confirm record locks require correction/revision instead of silent edits.
- Confirm exported CSVs match the accepted package and payment records.
- Record issues and decide whether they block pilot use.

### Phase 4: Controlled Deployment

- Deploy Node runtime to the selected host.
- Move persistence from JSON prototype storage to approved durable storage.
- Configure backup and restore procedure.
- Store secrets outside the repository.
- Run the acceptance test against deployed environment.
- Lock the deployment tag after signoff.

## Pre-Deployment Commands

```bash
npm run check
npm start
```

Use `scripts/server-status.js` and `scripts/server-dedupe.js` as local maintenance helpers during release review.

## Known Blockers Before Live Use

- Durable persistence is not yet implemented.
- Backup/restore has not been executed against a live candidate.
- Real users and least-privilege permissions are not seeded.
- SQUAN Tracker fields need real-world confirmation.
- Demo/training rows need archive handling before live readiness metrics are trusted.
- Manual QA is still needed for destructive actions: submit, approve, return, package, payment, holdback, and contractor payout.
