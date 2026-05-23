const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv"
]);

const allowedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".csv"]);
const maxUploadBytes = 15 * 1024 * 1024;

function extensionFor(fileName = "") {
  const dot = String(fileName).lastIndexOf(".");
  return dot === -1 ? "" : String(fileName).slice(dot).toLowerCase();
}

function validateUploadMetadata(file = {}) {
  const failures = [];
  const name = String(file.name || "");
  const mimeType = String(file.mimeType || file.type || "");
  const size = Number(file.size || 0);
  const extension = extensionFor(name);

  if (!name || name.includes("/") || name.includes("\\")) failures.push("File name is required and must not include path separators.");
  if (!allowedExtensions.has(extension)) failures.push(`File extension ${extension || "(none)"} is not allowed.`);
  if (!allowedMimeTypes.has(mimeType)) failures.push(`MIME type ${mimeType || "(none)"} is not allowed.`);
  if (!Number.isFinite(size) || size <= 0) failures.push("File size must be greater than zero.");
  if (size > maxUploadBytes) failures.push(`File size exceeds ${maxUploadBytes} bytes.`);

  return {
    ok: failures.length === 0,
    failures,
    normalized: {
      name,
      mimeType,
      size,
      extension
    }
  };
}

module.exports = {
  allowedExtensions,
  allowedMimeTypes,
  maxUploadBytes,
  validateUploadMetadata
};
