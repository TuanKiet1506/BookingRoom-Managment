const remindersHandler = require("./reminders");

module.exports = async function handler(req, res) {
  if (!req.query) req.query = {};
  if (!req.query.secret) {
    const parts = String(req.url || "").split("?")[0].split("/").filter(Boolean);
    req.query.secret = decodeURIComponent(parts[parts.length - 1] || "");
  }

  return remindersHandler(req, res);
};
