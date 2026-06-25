const { getBearerToken, verifySessionToken } = require("./_auth");
const {
  bookingCancelledMessage,
  bookingCreatedMessage,
  sendTelegramMessage,
} = require("./_telegram");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const session = verifySessionToken(getBearerToken(req));
    if (!session) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const { scriptUrl, payload } = req.body || {};
    const targetScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || scriptUrl;
    if (!targetScriptUrl || !payload) {
      res.status(400).json({ ok: false, error: "Missing scriptUrl or payload" });
      return;
    }

    const safePayload = {
      ...payload,
      userEmail: session.email,
    };
    if (safePayload.booking) {
      safePayload.booking = {
        ...safePayload.booking,
        ownerEmail: session.email,
      };
    }

    const response = await fetch(targetScriptUrl, {
      method: "POST",
      body: JSON.stringify(safePayload),
    });
    const text = await response.text();
    const result = parseJSON(text);

    if (response.ok && result?.ok) {
      try {
        await notifyTelegram(safePayload, session.email);
      } catch (error) {
        console.error("Telegram notification failed:", error);
      }
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(response.ok ? 200 : response.status).send(text);
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
};

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function notifyTelegram(payload, userEmail) {
  if (payload.action === "create" && payload.booking) {
    await sendTelegramMessage(bookingCreatedMessage(payload.booking));
  }
  if (payload.action === "cancel" && payload.booking) {
    await sendTelegramMessage(bookingCancelledMessage(payload.booking, userEmail));
  }
}
