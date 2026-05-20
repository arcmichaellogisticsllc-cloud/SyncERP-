# ArcGIS Phase 4 Readiness

Current non-secret portal metadata:

- Portal URL: `https://jactelops.maps.arcgis.com`
- Portal display name: `jactelops`

Do not store passwords, security answers, API keys, client secrets, access tokens, or refresh tokens in this repository or in `data/db.json`.

Before enabling live read-only ArcGIS calls, collect:

- Web map item ID
- Feature service URL
- Layer IDs and layer names
- Field names for Map/NTP, work code, quantity, status, object ID, global ID, and geometry
- Approved auth strategy: OAuth client ID or read-only API key stored outside the repo

Until those are approved, Jackson ERP should keep using SQUAN CSV imports and the internal SQUAN Map Workbench.
