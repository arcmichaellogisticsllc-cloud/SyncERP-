# Sync-ERP Action Plan 1-15

1. Confirm ArcGIS is display-first for engineered SQUAN working map plans.
2. Keep SQUAN CSV exports as the near-term operating source.
3. Maintain price sheet import for codes, units, rates, and work aspects.
4. Import SQUAN daily/pay export rows into Sync-ERP production placeholders.
5. Link imported map features to contractor and tech production dailies.
6. Require field proof before approval or billing readiness.
7. Reconcile SQUAN quantity, Jackson submitted quantity, approved quantity, and billable quantity.
8. Convert approved contractor rows into contractor payables.
9. Convert approved in-house tech rows into job cost.
10. Convert accepted rows into the SQUAN billable ledger.
11. Use Safety for hazards, blocked field conditions, and safety proof review.
12. Use Billing for SQUAN packages, unpaid work, retainage, disputes, and proof.
13. Use Reports for locked billing, collections, safety, and audit packets.
14. Store ArcGIS portal, web map, layer, and field mappings without storing secrets.
15. Move to live ArcGIS FeatureLayer import only after the internal workflow is stable.

This pass aligns Home, Maps, Billing, Safety, Reports, and Settings around the same path:

ArcGIS/SQUAN map plan -> SQUAN export/import -> Jackson daily entry -> proof review -> approved payable/job cost/billable ledger -> billing package and audit trail.
