# Jackson Telcom ERP

Jackson Telcom ERP is a SQUAN-focused operating system prototype for managing the full subcontractor workflow from PO intake to field daily, invoice support, retainage, safety scoring, and audit readiness.

This version is intentionally dependency-free. It can run as a static browser prototype, or as a local full-stack starter with a Node API and JSON database.

## Run Locally

Recommended full-stack mode:

```bash
npm start
```

Then visit `http://127.0.0.1:8080`.

## Demo Login Workspaces

Use the login screen demo buttons, or sign in with one of these seeded emails and password `demo`:

- `ronald@jacksontelcom.example` - Admin
- `marcus@jacksontelcom.example` - Foreman
- `ops@jacksontelcom.example` - Operations
- `billing@jacksontelcom.example` - Billing
- `safety@jacksontelcom.example` - Safety/Compliance

Static fallback:

```bash
python3 -m http.server 8080
```

Then visit `http://127.0.0.1:8080`. In static mode, records are stored in browser `localStorage`.

## Included Modules

- Role-based dashboard views for Admin, Foreman, Operations, Billing, and Safety/Compliance users
- Role-scoped navigation for Admin, Foreman, Operations, Billing, and Safety/Compliance
- Demo login screen with individual workspaces for each role
- Role workspaces refined around primary queues: Admin Exceptions, Foreman Today's Work, Operations PO Control Board, Billing Cash Queue, and Safety Compliance Risk Queue
- Responsive desktop and mobile layouts with table-to-card behavior on phones
- Executive dashboard with PO profitability, retainage, SQUAN score estimate, and risk exposure
- Project & PO Hub for SQUAN POs, scope, budget, required certs, document control, and margin
- Desktop Project & PO drill-down with linked dailies, invoices, and risk events
- Field Operations daily workflow for JSA, inspections, 811, production, SOT, payroll, and inventory outputs
- Mobile-first Field Daily workflow with pre-job, work log, and closeout steps
- Dependency-free Node API with JSON persistence
- REST endpoints for projects, project units, dailies, daily line items, people, equipment, invoices, billing readiness, safety, documents, crews, cost codes, and unit prices
- End-to-end daily submit workflow that updates production units, job cost, material usage, and billing readiness
- Executive, audit package, and CSV export endpoints
- People & Compliance ledger for certifications, background checks, drug tests, and workers' comp class
- Equipment & Materials controls for inspections, availability, SQUAN-supplied materials, and cost allocation
- Money module for invoice completeness, 30-day billing window, 90/10 retainage, AR, and pay-when-paid notes
- Safety, Quality, and Risk log for near misses, 5 Whys, Form 12 corrective actions, and audit metrics

## Data

Full-stack records are stored in `data/db.json`. Static fallback records are stored in browser `localStorage`.

## First End-to-End Slice

The first implemented operating loop is:

`PO -> Field Daily -> Cost Update -> Billing Readiness`

Use the Field Operations screen to submit a daily with production quantity, labor hours, equipment hours, and SQUAN material usage. The server updates project unit progress, actual cost, and the Money module billing readiness queue.

See [docs/BUILD_OUTLINE.md](docs/BUILD_OUTLINE.md) for the 1-10 ERP build path.
