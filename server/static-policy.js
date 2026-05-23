const path = require("path");

const PUBLIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const PUBLIC_FILES = new Set(["/index.html", "/src/app.js", "/src/styles.css"]);

function publicContentType(filePath) {
  return PUBLIC_TYPES[path.extname(filePath)] || "application/octet-stream";
}

function canServePublicPath(pathname) {
  return PUBLIC_FILES.has(pathname === "/" ? "/index.html" : pathname);
}

module.exports = {
  canServePublicPath,
  publicContentType
};
