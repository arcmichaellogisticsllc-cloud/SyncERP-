# Jackson Telcom ERP Build Outline

This is the internal build path for replacing the external starter stack with a single Jackson Telcom ERP.

Source-backed requirements from the signed SQUAN MSA and Jackson Telcom workflow transcripts are captured in `docs/SOURCE_REQUIREMENTS.md`. Those requirements should drive the next contract controls and workflow gates.

Workflow and MVP boundaries are captured in `docs/WORKFLOW_MVP_REVIEW.md`. Before adding new slices, use that document to confirm the user, operating question, source record, downstream impact, and whether the slice is MVP-required or deferred.

## Guiding Decision

Phase 1 is import-first. Jackson ERP should export from SQUAN and import into Jackson ERP, while contractors and in-house technicians submit Jackson production dailies. Live ArcGIS integration is Phase 4 after the internal workflow, proof controls, and pay/bill ledger are stable.

## 1. Data Model and Database Schema

Core records:

- Company setup
- Users and roles
- Customer contract rules
- Crews
- Customers
- Vendors
- Cost codes
- Unit-price catalog
- SQUAN imports and parsed production lines
- Price sheet items
- Contractor and tech production dailies
- Production ledger, contractor payables, tech work entries, billing ledger, and quantity reconciliation
- Maps and SQUAN work packages
- Field dailies
- Time entries
- People and compliance records
- Equipment and materials
- Invoices, AR, retainage, and chargebacks
- Safety, quality, and risk events
- Documents
- Audit log

Current implementation: `data/db.json` plus REST endpoints in `server.js`.

## 2. Authentication and Roles

Roles:

- Admin: full access, operating dashboard, setup, audit exports
- Foreman: assigned Maps, dailies, photos, JSA, inspections, production
- Operations: Map schedule, crew assignments, production status, equipment, blockers, closeout readiness
- Billing: invoices, retainage, AR, billing readiness
- Contractor: own production daily, proof, corrections, payable status
- In-house Technician: own production/time, photos, equipment/vehicle usage, field notes
- Safety: incidents, near misses, corrective actions, compliance
- Crew Member: limited mobile field access for assignment, JSA/PPE signoff, safety plans, obstacles, time confirmation, and hazard reporting

Current implementation: demo login endpoint, seeded users, role records, role-scoped navigation, role-specific dashboard landing states, and limited Crew Member access for ground hand, traffic control, and underground crew users. Next step is password hashing, sessions, and server-side route guards.

Initial permission model:

| Module | Admin | Foreman | Operations | Billing | Safety/Compliance | Crew Member |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Full | Limited | Full | Billing | Safety | Hidden |
| Map Hub | Full | Assigned | Full | View | View | Assigned crew only |
| Production Import / Ledger | Full | Submit/review own | Import/review | View/package | View proof | Submit own |
| Field Dailies | Full | Own | Approve | View | View | Assigned crew only |
| Time Tracking | Full | Crew approve | Review | View/export | Hours metrics | Own time only |
| People/Compliance | Full | Hidden | View | Hidden | Full | Own record only |
| Equipment/Materials | Full | Assigned | Full | Hidden | Full | Assigned crew only |
| Money/Invoicing | Full | Hidden | Hidden | Full | Hidden | Hidden |
| Safety/Risk | Full | Create own | View | Hidden | Full | Create hazard/near miss |
| Reports/Exports | Full | Own | Operations | Billing | Safety | Hidden |
| Settings | Full | No | Limited | No | No | No |

## 3. Map Hub

Required capabilities:

- Map intake
- Contract rule selection
- Site survey, permit, utility conflict, and special condition checklist
- Scope, schedule, crew, unit prices, quantities, required certs
- Document control
- Profitability view
- Linked dailies, invoices, equipment, material, safety events
- Billing deadline tracking

Current implementation: maps/projects collection, desktop Map drill-down, API CRUD.

First operating slice:

- Map unit-price lines are tracked in `projectUnits`.
- Completed and billable quantities are recalculated from submitted daily production.
- Map detail shows contract quantity, completed quantity, and billable dollars.

## 4. Field Daily Workflow

Required capabilities:

- Pre-job gate: JSA, signatures, PPE, Forms 4/6/7/8, 811
- 24-hour daily and SOT SLA tracking
- Work log: photos, hazards, notes, near misses
- Closeout: units, labor, equipment, materials, SOT, SQUAN daily report
- Submit and approval status
- Offline mode later

Current implementation: mobile daily workflow UI and dailies API.

First operating slice:

- `POST /api/workflows/submit-daily` accepts one daily plus production, labor, equipment, and material lines.
- The endpoint replaces existing line items for the daily ID, marks the daily submitted, and writes an audit event.

## 4A. Time Tracking

Required capabilities:

- Employee time entries tied to crew, daily, Map, work type, and cost code
- Clock in, clock out, breaks, regular hours, overtime, travel, standby, and delay reason
- Crew member time confirmation
- Foreman approval
- Payroll export status
- Job cost posting status
- Safety hours for TRIR/DART calculations

Current implementation: `timeEntries` collection, Time Tracking view, role-scoped visibility, Map detail time summary, crew member time confirmation, foreman approval queue, and audit-package export.

## 4B. Operational Pay/Billing Production MVP

Required capabilities:

- Import SQUAN Daily Export CSV.
- Import Jackson/SQUAN Price Sheet CSV.
- Contractor Daily mobile form with Map/NTP, date, code, quantity, notes, proof, and submit.
- Tech Daily mobile form with Map/NTP, date, code, quantity/hours, vehicle/equipment usage, notes, proof, and submit.
- Jackson Review Queue to approve, reject, or request correction.
- Production Ledger showing Jackson quantity, SQUAN export quantity, variance, proof status, contractor payable, in-house cost, SQUAN billable, and payment/billing status.
- Billing Package View grouped by Map/NTP, date, and code.

Current implementation: `priceSheetItems`, `squanImports`, `squanProductionLines`, `productionDailies`, `productionLines`, `contractorPayables`, `techWorkEntries`, `billingLedger`, `quantityReconciliation`, and `fieldEvidence` collections; Production screen import center, contractor/tech daily form, review queue, proof checklist, production ledger, and billing package view.

Sample CSV templates are provided in `samples/price-sheet-template.csv` and `samples/squan-daily-export-template.csv`.

## 4C. Evidence and Audit Control

Required capabilities:

- Photo/as-built/proof upload workflow.
- Proof checklist grouped by missing proof, needs review, and accepted proof.
- Correction requests that create owner tasks.
- Approval history on production lines and proof records.
- Exportable billing support package from accepted lines only.

Current implementation: Production proof checklist, proof correction task creation, proof acceptance action, approval blocking when proof is missing/unaccepted, proof CSV export, billing ledger CSV export, and accepted-line Billing Package View.

## 4D. SQUAN Map Workbench

Required capabilities:

- SQUAN map cards by Map/NTP.
- Layer and feature browser.
- Selected feature detail panel.
- Code and quantity rollups by Map/NTP, layer, and code.
- Map-to-daily workflow that creates a Jackson production daily from a selected SQUAN feature placeholder.

Current implementation: SQUAN Map Workbench on the Production screen. It derives feature placeholders from SQUAN daily export lines and optional `squanMapFeatures` records, displays layer/category labels, quantity placeholders, feature detail, rollups, and creates Jackson production dailies tied back to `sourceFeatureId`. It also supports manual feature creation/editing, feature-level proof, layer/status filtering, feature status updates, bulk status updates, batch feature selection, one Jackson daily from multiple selected features, and feature-level reconciliation against submitted, approved, and billing quantities. Live ArcGIS remains Phase 4.

## 4E. ArcGIS Phase 4 Readiness

Required capabilities before live integration:

- Store non-secret portal URL and display name.
- Track planned authentication mode without storing secrets.
- Track web map ID, FeatureLayer service URL, layer name/ID, and field mappings.
- Show readiness status before any live Esri service call is enabled.
- Keep SQUAN CSV import as the operating path until service access is approved.

Current implementation: Production screen shows an ArcGIS Phase 4 Readiness panel seeded with `https://jactelops.maps.arcgis.com` and portal display name `jactelops`. It includes readiness checks for portal URL, web map ID, feature service, layer mapping, field mapping, and authentication. No passwords, API keys, client secrets, tokens, or security answers are stored. See `docs/ARCGIS_PHASE4_READINESS.md`.

## 5. People and Compliance Ledger

Required capabilities:

- Employee and subcontractor records
- Certifications and expiration alerts
- Government ID retention, 7-year background checks, 3-year refresh, MVRs, drug tests, HSE acknowledgments
- Subcontractor SQUAN consent, safety review, HSE program, orientation, and COI
- Assignment blocking when required certs are missing or expired
- Audit export

Current implementation: people collection, compliance statuses, API CRUD.

## 6. Equipment and Materials

Required capabilities:

- Equipment registry
- Inspection and calibration schedules
- Availability blocking
- Equipment cost rates and job allocation
- SQUAN-owned vs Jackson-owned material
- Material receipts and consumption

Current implementation: equipment collection, material owner field, API CRUD.

## 7. Map Costing

Required capabilities:

- Labor cost
- Equipment cost
- Material cost
- Overhead burden
- Direct expense capture
- Forecast-at-completion
- Margin by Map

Current implementation: Map actual cost, forecast cost, and profitability summary.

First operating slice:

- Daily labor lines calculate `hours * costRate`.
- Daily equipment lines calculate `hours * rate`.
- Jackson-owned material lines calculate `quantity * unitCost`.
- SQUAN-owned material is tracked as consumption without adding material cost.
- Map actual cost is recalculated from base actual cost plus submitted daily line costs.

## 8. Invoicing and Retainage

Required capabilities:

- Invoice generation from billable progress
- Completeness gate for dailies, SOT, as-builts, photos, and QC closeout
- 30-day billing window alerts
- 90/10 retainage ledger
- Pay-when-paid status tracking
- COI/payment-hold alerts
- Disputes and chargebacks
- AR aging

Current implementation: invoices collection, retainage release dates, money dashboard, CSV export.

First operating slice:

- Billing readiness is recalculated after daily submission.
- Readiness checks submitted daily, SOT, photos, as-builts, billable amount, and billing deadline.
- Money screen includes a Billing Readiness queue.

## 9. Safety, Quality, and Risk

Required capabilities:

- Incidents, near misses, hazards, complaints, chargebacks
- 5 Whys root cause
- Form 12 corrective actions
- Due dates and closure verification
- TRIR, DART, EMR, MVIFR inputs
- SQUAN score estimate
- Mitigation plan workflow when SQUAN score is below 90
- Foreman-owned QC closeout until a dedicated QC role exists

Current implementation: safety collection, risk dashboard, executive report API.

## 10. Reporting and Exports

Required capabilities:

- Executive dashboard
- Map profitability
- Map progress
- Daily production
- Billing readiness
- AR and retainage
- Compliance expiration
- Equipment inspection
- Safety performance
- Audit package

Current implementation:

- `GET /api/reports/executive`
- `GET /api/reports/audit-package`
- `GET /api/exports/:collection`

## Next Engineering Milestones

The next milestones should stay inside the MVP boundary:

1. Finish Phase 1 Production: price sheet import, SQUAN daily CSV import, contractor/tech daily submission, Jackson review queue, production ledger, contractor payable, in-house cost, and SQUAN billable support.
2. Expand Phase 2 evidence controls with real file storage for photos/as-builts and packet exports beyond CSV.
3. Expand Phase 3 SQUAN Map Workbench with persistent saved filter views, feature-level proof attachment, and feature-level billing package exports.
4. Complete Phase 4 prerequisites: Esri sandbox web map ID, FeatureLayer service URL, layer IDs/names, field mappings, and approved OAuth/API-key strategy.
5. Clean up navigation around the end-to-end Map workflow so Map setup, Production, Field Daily, Documents, Billing, Safety, and Admin approval all point back to the same source-of-truth Map/NTP.
6. Stabilize the Billing/Admin collections workflow already built: decision evidence, SLA tasks, readiness gates, packet snapshots, and clear user-facing labels.
7. Add source-backed SQUAN contract rules and wire them into daily SLA, billing readiness, retainage, and score alerts.
8. Finish Map intake checklist for maps, surveys, permits, utility conflicts, aerial/underground transitions, and special conditions.
9. Harden compliance blocking logic for crew/project/equipment assignment.
10. Add file upload storage for photos, certs, permits, SOT, and as-builts.
11. Add PDF generation for SQUAN daily reports, SOT, invoices, and audit packages.
12. Replace JSON persistence with SQLite or Postgres, then add real login, hashed passwords, sessions, and role guards.
