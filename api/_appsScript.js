async function callAppsScript(payload, retries = 1) {
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
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return callAppsScript(payload, retries - 1);
    }
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

// Fetches bookings for multiple dates in a single Apps Script call,
// avoiding the concurrency issues caused by parallel "list" requests.
async function listBookingsByDates(dates) {
  const result = await callAppsScript({
    action: "listRange",
    dates,
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

async function createBooking(booking, userEmail) {
  return callAppsScript({
    action: "create",
    booking,
    userEmail,
  });
}

async function cancelBooking(id, userEmail) {
  return callAppsScript({
    action: "cancel",
    id,
    userEmail,
  });
}

// Single round-trip that reads bot state, writes to Sheet, and clears bot state,
// replacing the three sequential calls previously needed for /confirm.
async function confirmFlowCall(chatId, userEmail) {
  const result = await callAppsScript({ action: "confirmFlow", chatId, userEmail });
  return result;
}

async function getBotState(chatId) {
  const result = await callAppsScript({
    action: "getBotState",
    chatId,
  });
  return result.state || null;
}

async function setBotState(chatId, state) {
  return callAppsScript({
    action: "setBotState",
    chatId,
    state,
  });
}

async function clearBotState(chatId) {
  return callAppsScript({
    action: "clearBotState",
    chatId,
  });
}

module.exports = {
  callAppsScript,
  cancelBooking,
  clearBotState,
  confirmFlowCall,
  createBooking,
  getBotState,
  listBookings,
  listBookingsByDates,
  markTelegramStatus,
  setBotState,
};
