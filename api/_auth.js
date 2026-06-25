const crypto = require("crypto");

const ADMIN_EMAIL = "admin@khomes.com.vn";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function getSessionSecret() {
  return process.env.SESSION_SECRET || "";
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(value) {
  return base64url(
    crypto.createHmac("sha256", getSessionSecret()).update(value).digest(),
  );
}

function createSessionToken(email) {
  if (!getSessionSecret()) {
    throw new Error("Missing SESSION_SECRET");
  }

  const payload = {
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
  if (!getSessionSecret()) return null;

  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (String(payload.email || "").toLowerCase() !== ADMIN_EMAIL) return null;
    return payload;
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

module.exports = {
  ADMIN_EMAIL,
  createSessionToken,
  getBearerToken,
  verifySessionToken,
};
