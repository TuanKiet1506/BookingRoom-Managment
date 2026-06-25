async function callAppsScript(payload) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";
  if (!scriptUrl) {
    throw new Error("Missing GOOGLE_APPS_SCRIPT_URL");
  }

  const response = await fetch(scriptUrl, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script did not return JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `${response.status} ${response.statusText}`);
  }
  return result;
}

async function listBookings(date) {
  const result = await callAppsScript({
    action: "list",
    date,
  });
  return result.bookings || [];
}

async function markTelegramStatus(id, telegramStatus, userEmail) {
  return callAppsScript({
    action: "markTelegram",
    id,
    telegramStatus,
    userEmail,
  });
}

module.exports = {
  callAppsScript,
  listBookings,
  markTelegramStatus,
};
