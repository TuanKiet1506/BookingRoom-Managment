// State-only calls (PropertiesService, no Sheet): used in pairs → 4 s each keeps
// two sequential calls within Vercel Hobby's 10 s function cap.
const APPS_SCRIPT_STATE_TIMEOUT_MS = 4000;

// Sheet calls (SpreadsheetApp read or write): always a single call per request,
// so 8 s timeout still leaves ~2 s for Telegram response within the 10 s cap.
const APPS_SCRIPT_SHEET_TIMEOUT_MS = 8000;

async function callAppsScript(payload, retries = 1, timeoutMs = APPS_SCRIPT_STATE_TIMEOUT_MS) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";
  if (!scriptUrl) {
    throw new Error("Missing GOOGLE_APPS_SCRIPT_URL");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response, text;
  try {
    response = await fetch(scriptUrl, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === "AbortError") {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error(`Apps Script không phản hồi sau ${secs} giây. Bạn gửi lại lệnh nhé.`);
    }
    throw fetchError;
  }
  clearTimeout(timeoutId);

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    // Apps Script returned an HTML error page — retry once immediately (no delay).
    if (retries > 0) {
      return callAppsScript(payload, retries - 1, timeoutMs);
    }
    throw new Error(`Apps Script did not return JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `${response.status} ${response.statusText}`);
  }
  return result;
}

async function listBookings(date) {
  const result = await callAppsScript({ action: "list", date }, 1, APPS_SCRIPT_SHEET_TIMEOUT_MS);
  return result.bookings || [];
}

async function listBookingsByDates(dates) {
  const result = await callAppsScript({ action: "listRange", dates }, 1, APPS_SCRIPT_SHEET_TIMEOUT_MS);
  return result.bookings || [];
}

async function markTelegramStatus(id, telegramStatus, userEmail) {
  return callAppsScript(
    { action: "markTelegram", id, telegramStatus, userEmail },
    1,
    APPS_SCRIPT_SHEET_TIMEOUT_MS,
  );
}

async function createBooking(booking, userEmail) {
  return callAppsScript({ action: "create", booking, userEmail }, 1, APPS_SCRIPT_SHEET_TIMEOUT_MS);
}

async function cancelBooking(id, userEmail) {
  return callAppsScript({ action: "cancel", id, userEmail }, 1, APPS_SCRIPT_SHEET_TIMEOUT_MS);
}

// Single round-trip: reads bot state + writes to Sheet + clears state.
// Needs the longer sheet timeout because it touches SpreadsheetApp.
async function confirmFlowCall(chatId, userEmail) {
  return callAppsScript(
    { action: "confirmFlow", chatId, userEmail },
    1,
    APPS_SCRIPT_SHEET_TIMEOUT_MS,
  );
}

async function getBotState(chatId) {
  const result = await callAppsScript({ action: "getBotState", chatId });
  return result.state || null;
}

async function setBotState(chatId, state) {
  return callAppsScript({ action: "setBotState", chatId, state });
}

async function clearBotState(chatId) {
  return callAppsScript({ action: "clearBotState", chatId });
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
