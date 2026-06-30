const {
  TELEGRAM_COMMANDS,
  setTelegramCommands,
} = require("../_telegram");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const results = await setTelegramCommands();
    res.status(200).json({
      ok: true,
      commands: TELEGRAM_COMMANDS.map((item) => item.command),
      scopes: results,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
};

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || "";
  const rawQuerySecret = req.query?.secret || "";
  const querySecret = Array.isArray(rawQuerySecret) ? rawQuerySecret[0] : rawQuerySecret;
  return Boolean(secret && querySecret === secret);
}
