# Jackson Telcom ERP Build Outline

This is the internal build path for replacing the external starter stack with a single Jackson Telcom ERP.

## 1. Data Model and Database Schema

Core records:

- Company setup
- Users and roles
- Crews
- Customers
- Vendors
- Cost codes
- Unit-price catalog
- Projects and SQUAN POs
- Field dailies
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
- Foreman: assigned projects, dailies, photos, JSA, inspections, production
- Operations: PO schedule, crew assignments, production status, equipment, blockers, closeout readiness
- Billing: invoices, retainage, AR, billing readiness
- Safety: incidents, near misses, corrective actions, compliance

Current implementation: demo login endpoint, seeded users, role records, role-scoped navigation, and role-specific dashboard landing states. Next step is password hashing, sessions, and server-side route guards.

Initial permission model:

| Module | Admin | Foreman | Operations | Billing | Safety/Compliance |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Full | Limited | Full | Billing | Safety |
| Project & PO Hub | Full | Assigned | Full | View | View |
| Field Dailies | Full | Own | Approve | View | View |
| People/Compliance | Full | Hidden | View | Hidden | Full |
| Equipment/Materials | Full | Assigned | Full | Hidden | Full |
| Money/Invoicing | Full | Hidden | Hidden | Full | Hidden |
| Safety/Risk | Full | Create own | View | Hidden | Full |
| Reports/Exports | Full | Own | Operations | Billing | Safety |
| Settings | Full | No | Limited | No | No |

## 3. Project and PO Hub

Required capabilities:

- PO intake
- Scope, schedule, crew, unit prices, quantities, required certs
- Document control
- Profitability view
- Linked dailies, invoices, equipment, material, safety events
- Billing deadline tracking

Current implementation: projects collection, desktop PO drill-down, API CRUD.

First operating slice:

- Project unit-price lines are tracked in `projectUnits`.
- Completed and billable quantities are recalculated from submitted daily production.
- PO detail shows contract quantity, completed quantity, and billable dollars.

## 4. Field Daily Workflow

Required capabilities:

- Pre-job gate: JSA, signatures, PPE, Forms 4/6/7/8, 811
- Work log: photos, hazards, notes, near misses
- Closeout: units, labor, equipment, materials, SOT, SQUAN daily report
- Submit and approval status
- Offline mode later

Current implementation: mobile daily workflow UI and dailies API.

First operating slice:

- `POST /api/workflows/submit-daily` accepts one daily plus production, labor, equipment, and material lines.
- The endpoint replaces existing line items for the daily ID, marks the daily submitted, and writes an audit event.

## 5. People and Compliance Ledger

Required capabilities:

- Employee and subcontractor records
- Certifications and expiration alerts
- Background checks, MVRs, drug tests, HSE acknowledgments
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

## 7. Job Costing

Required capabilities:

- Labor cost
- Equipment cost
- Material cost
- Overhead burden
- Direct expense capture
- Forecast-at-completion
- Margin by PO

Current implementation: project actual cost, forecast cost, and profitability summary.

First operating slice:

- Daily labor lines calculate `hours * costRate`.
- Daily equipment lines calculate `hours * rate`.
- Jackson-owned material lines calculate `quantity * unitCost`.
- SQUAN-owned material is tracked as consumption without adding material cost.
- Project actual cost is recalculated from base actual cost plus submitted daily line costs.

## 8. Invoicing and Retainage

Required capabilities:

- Invoice generation from billable progress
- Completeness gate for dailies, SOT, as-builts, photos
- 30-day billing window alerts
- 90/10 retainage ledger
- Pay-when-paid notes
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

Current implementation: safety collection, risk dashboard, executive report API.

## 10. Reporting and Exports

Required capabilities:

- Executive dashboard
- Project profitability
- PO progress
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

1. Replace JSON persistence with SQLite or Postgres.
2. Add real login, hashed passwords, sessions, and role guards.
3. Add file upload storage for photos, certs, permits, SOT, and as-builts.
4. Add PDF generation for SQUAN daily reports, SOT, invoices, and audit packages.
5. Add compliance blocking logic for crew/project/equipment assignment.
6. Add payroll-ready labor exports.
