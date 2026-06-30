const SPREADSHEET_ID = "1VK4fZ0ajQk8Bj5Cl0DaQdjXsBA5NJGp-lo6P83dSQ6U";
const SHEET_NAME = "Bookings";
const ADMIN_EMAIL = "admin@khomes.com.vn";
const ANNUAL_CLEANUP_FUNCTION = "annualCleanupBookings";
const LAST_CLEANUP_YEAR_KEY = "meetinghub.lastCleanupYear";
const BOT_STATE_PREFIX = "meetinghub.botState.";
const HEADERS = [
  "id",
  "date",
  "startTime",
  "endTime",
  "room",
  "topic",
  "ownerEmail",
  "note",
  "status",
  "createdAt",
  "cancelledAt",
  "cancelledBy",
  "telegramStatus",
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");

    // Bot-state actions use PropertiesService only — no Sheet access needed.
    if (payload.action === "getBotState") {
      return json({ ok: true, state: getBotState(payload.chatId) });
    }
    if (payload.action === "setBotState") {
      setBotState(payload.chatId, payload.state);
      return json({ ok: true });
    }
    if (payload.action === "clearBotState") {
      clearBotState(payload.chatId);
      return json({ ok: true });
    }

    // Combines getBotState + sheet write + clearBotState into one call
    // so /confirm only needs a single Apps Script round-trip instead of three.
    if (payload.action === "confirmFlow") {
      const state = getBotState(payload.chatId);
      if (!state) {
        return json({ ok: true, confirmed: false, reason: "no_state" });
      }
      if (state.step !== "confirm") {
        return json({ ok: true, confirmed: false, reason: "not_ready" });
      }
      if (state.flow === "book" && state.booking) {
        ensureSheet();
        const booking = state.booking;
        booking.ownerEmail = ADMIN_EMAIL;
        assertNotPastDate(booking.date);
        assertNoConflict(booking);
        appendBooking(booking);
        clearBotState(payload.chatId);
        return json({ ok: true, confirmed: true, flow: "book", booking });
      }
      if (state.flow === "cancel" && state.booking) {
        ensureSheet();
        validateAdminEmail(payload.userEmail);
        cancelBooking(state.booking.id, payload.userEmail);
        clearBotState(payload.chatId);
        return json({
          ok: true,
          confirmed: true,
          flow: "cancel",
          booking: state.booking,
        });
      }
      return json({ ok: true, confirmed: false, reason: "not_ready" });
    }

    ensureSheet();

    if (payload.action === "list") {
      return json({
        ok: true,
        bookings: listBookings(payload.date),
      });
    }

    // Returns bookings for an array of dates in one call,
    // replacing multiple parallel "list" requests.
    if (payload.action === "listRange") {
      const dates = Array.isArray(payload.dates)
        ? payload.dates.map(String)
        : [];
      const all = listBookings(null);
      const filtered =
        dates.length > 0 ? all.filter((b) => dates.includes(b.date)) : all;
      return json({ ok: true, bookings: filtered });
    }

    if (payload.action === "create") {
      validateAdminEmail(payload.userEmail || payload.booking.ownerEmail);
      payload.booking.ownerEmail = ADMIN_EMAIL;
      assertNotPastDate(payload.booking.date);
      assertNoConflict(payload.booking);
      appendBooking(payload.booking);
      return json({ ok: true });
    }

    if (payload.action === "cancel") {
      validateAdminEmail(payload.userEmail);
      cancelBooking(payload.id, ADMIN_EMAIL);
      return json({ ok: true });
    }

    if (payload.action === "markTelegram") {
      validateAdminEmail(payload.userEmail);
      markTelegramStatus(payload.id, payload.telegramStatus);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action" });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) });
  }
}

function setupMeetingSheet() {
  ensureSheet();
  installAnnualCleanupTrigger();
}

function installAnnualCleanupTrigger() {
  const hasTrigger = ScriptApp.getProjectTriggers().some((trigger) => {
    return trigger.getHandlerFunction() === ANNUAL_CLEANUP_FUNCTION;
  });
  if (hasTrigger) return;

  ScriptApp.newTrigger(ANNUAL_CLEANUP_FUNCTION)
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .create();
}

function annualCleanupBookings() {
  const timeZone = Session.getScriptTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, timeZone, "MM-dd");
  if (today !== "01-01") return;

  const year = Utilities.formatDate(now, timeZone, "yyyy");
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(LAST_CLEANUP_YEAR_KEY) === year) return;

  clearBookingRows();
  properties.setProperty(LAST_CLEANUP_YEAR_KEY, year);
}

function clearBookingRows() {
  ensureSheet();
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  sheet.deleteRows(2, lastRow - 1);
}

function ensureSheet() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  const currentHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsHeader = HEADERS.some(
    (header, index) => currentHeaders[index] !== header,
  );
  if (needsHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function listBookings(date) {
  const rows = getRows();
  return rows
    .filter((booking) => !date || booking.date === date)
    .sort((a, b) =>
      `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
    );
}

function appendBooking(booking) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    assertNoConflict(booking);
    const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
    sheet.appendRow(HEADERS.map((header) => booking[header] || ""));
    sheet
      .getRange(
        2,
        HEADERS.indexOf("date") + 1,
        Math.max(sheet.getLastRow() - 1, 1),
        1,
      )
      .setNumberFormat("@");
    sheet
      .getRange(
        2,
        HEADERS.indexOf("startTime") + 1,
        Math.max(sheet.getLastRow() - 1, 1),
        2,
      )
      .setNumberFormat("@");
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking(id, userEmail) {
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const idColumn = HEADERS.indexOf("id");
  const statusColumn = HEADERS.indexOf("status");
  const cancelledAtColumn = HEADERS.indexOf("cancelledAt");
  const cancelledByColumn = HEADERS.indexOf("cancelledBy");

  for (let row = 1; row < values.length; row += 1) {
    if (values[row][idColumn] === id) {
      sheet.getRange(row + 1, statusColumn + 1).setValue("CANCELLED");
      sheet
        .getRange(row + 1, cancelledAtColumn + 1)
        .setValue(new Date().toISOString());
      sheet.getRange(row + 1, cancelledByColumn + 1).setValue(userEmail);
      return;
    }
  }

  throw new Error("Booking not found");
}

function markTelegramStatus(id, telegramStatus) {
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const idColumn = HEADERS.indexOf("id");
  const telegramStatusColumn = HEADERS.indexOf("telegramStatus");

  for (let row = 1; row < values.length; row += 1) {
    if (values[row][idColumn] === id) {
      sheet
        .getRange(row + 1, telegramStatusColumn + 1)
        .setValue(telegramStatus || "REMINDED_1H");
      return;
    }
  }

  throw new Error("Booking not found");
}

function getBotState(chatId) {
  const raw = PropertiesService.getScriptProperties().getProperty(
    botStateKey(chatId),
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setBotState(chatId, state) {
  PropertiesService.getScriptProperties().setProperty(
    botStateKey(chatId),
    JSON.stringify(state || null),
  );
}

function clearBotState(chatId) {
  PropertiesService.getScriptProperties().deleteProperty(botStateKey(chatId));
}

function botStateKey(chatId) {
  return `${BOT_STATE_PREFIX}${String(chatId || "").trim()}`;
}

function assertNoConflict(booking) {
  const conflict = getRows().find((item) => {
    return (
      item.status !== "CANCELLED" &&
      item.room === booking.room &&
      item.date === booking.date &&
      booking.startTime < item.endTime &&
      booking.endTime > item.startTime
    );
  });

  if (conflict) {
    throw new Error(
      `Conflict with ${conflict.topic} (${conflict.startTime}-${conflict.endTime})`,
    );
  }
}

function assertNotPastDate(dateValue) {
  const bookingDate = normalizeSheetValue("date", dateValue);
  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  if (!bookingDate || bookingDate < today) {
    throw new Error("Cannot book past date");
  }
}

function getRows() {
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  return values
    .slice(1)
    .filter((row) => row[0])
    .map(rowToBooking);
}

function rowToBooking(row) {
  return HEADERS.reduce((booking, header, index) => {
    booking[header] = normalizeSheetValue(header, row[index]);
    return booking;
  }, {});
}

function normalizeSheetValue(header, value) {
  if (!value) return "";
  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    if (header === "date") {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd",
      );
    }
    if (header === "startTime" || header === "endTime") {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
    }
    return value.toISOString();
  }

  const text = String(value).trim();
  if (header === "date") {
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const usDateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usDateMatch) {
      return `${usDateMatch[3]}-${usDateMatch[1].padStart(2, "0")}-${usDateMatch[2].padStart(2, "0")}`;
    }
  }
  if (header === "startTime" || header === "endTime") {
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
    }
  }

  return text;
}

function validateAdminEmail(email) {
  if (
    String(email || "")
      .trim()
      .toLowerCase() !== ADMIN_EMAIL
  ) {
    throw new Error("Admin account only");
  }
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
