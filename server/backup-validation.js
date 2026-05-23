const requiredBackupArrays = [
  "projects",
  "tasks",
  "productionDailies",
  "productionLines",
  "priceSheetItems",
  "billingLedger",
  "roles",
  "users",
  "auditLog"
];

function validateBackupData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["Backup must be a JSON object."];
  const source = data.data && typeof data.data === "object" ? data.data : data;
  const failures = [];
  requiredBackupArrays.forEach(key => {
    if (!Array.isArray(source[key])) failures.push(`Missing required collection: ${key}`);
  });
  if (!source.company || typeof source.company !== "object") failures.push("Missing company profile.");
  if (!source.meta || typeof source.meta !== "object") failures.push("Missing metadata.");
  if (source.meta && !source.meta.dataVersion) failures.push("Missing metadata dataVersion.");

  Object.entries(source).forEach(([collection, rows]) => {
    if (!Array.isArray(rows)) return;
    const ids = new Set();
    rows.forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        failures.push(`${collection}[${index}] must be an object.`);
        return;
      }
      if (!record.id) return;
      if (ids.has(record.id)) failures.push(`${collection} has duplicate id: ${record.id}`);
      ids.add(record.id);
    });
  });

  return failures;
}

module.exports = {
  validateBackupData
};
