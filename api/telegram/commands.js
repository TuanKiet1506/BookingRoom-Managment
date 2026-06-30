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
    const chatId = getQueryValue(req.query?.chatId);
    const results = await setTelegramCommands({ chatId });
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
  const querySecret = getQueryValue(req.query?.secret);
  return Boolean(secret && querySecret === secret);
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : String(value || "");
}
