# Jackson Telcom ERP

Jackson Telcom ERP is a SQUAN-focused operating system prototype for managing the full subcontractor workflow from PO intake to field daily, invoice support, retainage, safety scoring, and audit readiness.

This first version is intentionally dependency-free so the app can run immediately from a fresh clone.

## Run Locally

Open `index.html` in a browser.

Optional local server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Included Modules

- Executive dashboard with PO profitability, retainage, SQUAN score estimate, and risk exposure
- Project & PO Hub for SQUAN POs, scope, budget, required certs, document control, and margin
- Field Operations daily workflow for JSA, inspections, 811, production, SOT, payroll, and inventory outputs
- People & Compliance ledger for certifications, background checks, drug tests, and workers' comp class
- Equipment & Materials controls for inspections, availability, SQUAN-supplied materials, and cost allocation
- Money module for invoice completeness, 30-day billing window, 90/10 retainage, AR, and pay-when-paid notes
- Safety, Quality, and Risk log for near misses, 5 Whys, Form 12 corrective actions, and audit metrics

## Data

Records are stored in browser `localStorage` for this prototype. Use **Reset demo data** in the app to restore seeded Jackson Telcom/SQUAN demo data.
