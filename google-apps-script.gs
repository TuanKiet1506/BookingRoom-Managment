const SPREADSHEET_ID = "1VK4fZ0ajQk8Bj5Cl0DaQdjXsBA5NJGp-lo6P83dSQ6U";
const SHEET_NAME = "Bookings";
const RECURRING_SHEET_NAME = "RecurringTemplates";
const MEETING_ROOM = "Phòng họp";
const ADMIN_EMAIL = "admin@khomes.com.vn";
const ANNUAL_CLEANUP_FUNCTION = "annualCleanupBookings";
const LAST_CLEANUP_YEAR_KEY = "meetinghub.lastCleanupYear";
const BOT_STATE_PREFIX = "meetinghub.botState.";
// How many weeks ahead recurring templates are materialised into concrete
// Bookings rows. The daily trigger tops this up, so the window is always full.
const RECURRING_WEEKS_AHEAD = 8;
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
const RECURRING_HEADERS = [
  "id",
  "weekday",
  "startTime",
  "endTime",
  "room",
  "topic",
  "note",
  "ownerEmail",
  "active",
  "createdAt",
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

    if (payload.action === "createRecurring") {
      validateAdminEmail(
        payload.userEmail ||
          (payload.template && payload.template.ownerEmail),
      );
      ensureRecurringSheet();
      const template = addRecurringTemplate(payload.template);
      const generated = generateRecurringBookings(RECURRING_WEEKS_AHEAD);
      return json({ ok: true, template, generated: generated.created });
    }

    if (payload.action === "listRecurring") {
      ensureRecurringSheet();
      return json({ ok: true, templates: listRecurringTemplates() });
    }

    if (payload.action === "cancelRecurring") {
      validateAdminEmail(payload.userEmail);
      ensureRecurringSheet();
      const removed = cancelRecurringTemplate(payload.id, ADMIN_EMAIL);
      return json({ ok: true, cancelledOccurrences: removed });
    }

    if (payload.action === "generateRecurring") {
      validateAdminEmail(payload.userEmail);
      ensureRecurringSheet();
      const generated = generateRecurringBookings(
        payload.weeksAhead || RECURRING_WEEKS_AHEAD,
      );
      return json({ ok: true, generated: generated.created });
    }

    return json({ ok: false, error: "Unknown action" });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) });
  }
}

function setupMeetingSheet() {
  ensureSheet();
  ensureRecurringSheet();
  installAnnualCleanupTrigger();
  generateRecurringBookings(RECURRING_WEEKS_AHEAD);
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

// Runs daily via the time-based trigger. Kept named "annualCleanupBookings"
// so the trigger already installed on existing deployments keeps firing.
// It now does two jobs: the once-a-year cleanup, and topping up the rolling
// window of recurring bookings so future weeks always exist.
function annualCleanupBookings() {
  runAnnualCleanupIfDue();
  generateRecurringBookings(RECURRING_WEEKS_AHEAD);
}

function runAnnualCleanupIfDue() {
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
    writeBookingRow(booking);
  } finally {
    lock.releaseLock();
  }
}

// Raw row write shared by manual bookings and recurring generation.
// Callers are responsible for conflict/duplicate checks and locking.
function writeBookingRow(booking) {
  const sheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  sheet.appendRow(HEADERS.map((header) => booking[header] || ""));
  sheet
    .getRange(2, HEADERS.indexOf("date") + 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .setNumberFormat("@");
  sheet
    .getRange(
      2,
      HEADERS.indexOf("startTime") + 1,
      Math.max(sheet.getLastRow() - 1, 1),
      2,
    )
    .setNumberFormat("@");
}

function ensureRecurringSheet() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(RECURRING_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(RECURRING_SHEET_NAME);

  const currentHeaders = sheet
    .getRange(1, 1, 1, RECURRING_HEADERS.length)
    .getValues()[0];
  const needsHeader = RECURRING_HEADERS.some(
    (header, index) => currentHeaders[index] !== header,
  );
  if (needsHeader) {
    sheet.getRange(1, 1, 1, RECURRING_HEADERS.length).setValues([RECURRING_HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function listRecurringTemplates() {
  const sheet = getSpreadsheet().getSheetByName(RECURRING_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  return values
    .slice(1)
    .filter((row) => row[0])
    .map(rowToTemplate);
}

function rowToTemplate(row) {
  const template = {};
  RECURRING_HEADERS.forEach((header, index) => {
    template[header] = row[index];
  });
  template.id = String(template.id || "");
  template.weekday = Number(template.weekday);
  template.startTime = normalizeTimeText(template.startTime);
  template.endTime = normalizeTimeText(template.endTime);
  template.room = String(template.room || MEETING_ROOM);
  template.topic = String(template.topic || "");
  template.note = String(template.note || "");
  template.ownerEmail = String(template.ownerEmail || ADMIN_EMAIL);
  const activeValue = row[RECURRING_HEADERS.indexOf("active")];
  template.active = !(
    activeValue === false ||
    String(activeValue).trim().toLowerCase() === "false"
  );
  return template;
}

function normalizeTemplate(template) {
  const source = template || {};
  const weekday = Number(source.weekday);
  const startTime = normalizeTimeText(source.startTime);
  const endTime = normalizeTimeText(source.endTime);
  const topic = String(source.topic || "").trim();
  if (!(weekday >= 1 && weekday <= 7)) {
    throw new Error("Invalid weekday, expected 1 (Mon) to 7 (Sun)");
  }
  if (!startTime || !endTime) throw new Error("Invalid start/end time");
  if (startTime >= endTime) throw new Error("End time must be after start time");
  if (!topic) throw new Error("Topic required");
  return {
    weekday,
    startTime,
    endTime,
    topic,
    room: String(source.room || MEETING_ROOM),
    note: String(source.note || ""),
    ownerEmail: String(source.ownerEmail || ADMIN_EMAIL),
  };
}

function normalizeTimeText(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function addRecurringTemplate(template) {
  const normalized = normalizeTemplate(template);
  const sheet = getSpreadsheet().getSheetByName(RECURRING_SHEET_NAME);
  const record = {
    id: `tpl-${Utilities.getUuid()}`,
    weekday: normalized.weekday,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    room: normalized.room,
    topic: normalized.topic,
    note: normalized.note,
    ownerEmail: normalized.ownerEmail,
    active: true,
    createdAt: new Date().toISOString(),
  };
  sheet.appendRow(RECURRING_HEADERS.map((header) => record[header]));
  sheet
    .getRange(
      2,
      RECURRING_HEADERS.indexOf("startTime") + 1,
      Math.max(sheet.getLastRow() - 1, 1),
      2,
    )
    .setNumberFormat("@");
  return record;
}

function cancelRecurringTemplate(id, userEmail) {
  const sheet = getSpreadsheet().getSheetByName(RECURRING_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const idColumn = RECURRING_HEADERS.indexOf("id");
  const activeColumn = RECURRING_HEADERS.indexOf("active");

  let found = false;
  for (let row = 1; row < values.length; row += 1) {
    if (values[row][idColumn] === id) {
      sheet.getRange(row + 1, activeColumn + 1).setValue(false);
      found = true;
      break;
    }
  }
  if (!found) throw new Error("Recurring template not found");

  // Cancel future, still-active occurrences generated from this template.
  const bookingSheet = getSpreadsheet().getSheetByName(SHEET_NAME);
  const bookingValues = bookingSheet.getDataRange().getValues();
  const bId = HEADERS.indexOf("id");
  const bDate = HEADERS.indexOf("date");
  const bStatus = HEADERS.indexOf("status");
  const bCancelledAt = HEADERS.indexOf("cancelledAt");
  const bCancelledBy = HEADERS.indexOf("cancelledBy");
  const todayStr = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const prefix = `rec-${id}-`;
  let removed = 0;
  for (let row = 1; row < bookingValues.length; row += 1) {
    const rowId = String(bookingValues[row][bId] || "");
    if (rowId.indexOf(prefix) !== 0) continue;
    const rowDate = normalizeSheetValue("date", bookingValues[row][bDate]);
    if (rowDate < todayStr) continue;
    if (String(bookingValues[row][bStatus]) === "CANCELLED") continue;
    bookingSheet.getRange(row + 1, bStatus + 1).setValue("CANCELLED");
    bookingSheet
      .getRange(row + 1, bCancelledAt + 1)
      .setValue(new Date().toISOString());
    bookingSheet.getRange(row + 1, bCancelledBy + 1).setValue(userEmail);
    removed += 1;
  }
  return removed;
}

// Materialises each active template into concrete Bookings rows for the next
// `weeksAhead` weeks. Idempotent: rows use a stable id (rec-<templateId>-<date>)
// so re-runs never duplicate, and a slot already taken (manually, or a
// previously cancelled occurrence) is respected rather than overwritten.
function generateRecurringBookings(weeksAhead) {
  ensureSheet();
  ensureRecurringSheet();
  const weeks = weeksAhead || RECURRING_WEEKS_AHEAD;
  const templates = listRecurringTemplates().filter((template) => template.active);
  if (!templates.length) return { created: 0 };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let created = 0;
  try {
    const existing = getRows();
    const byId = {};
    existing.forEach((booking) => {
      byId[booking.id] = booking;
    });
    const active = existing.filter((booking) => booking.status !== "CANCELLED");
    const todayStr = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd",
    );

    templates.forEach((template) => {
      upcomingDatesForWeekday(template.weekday, weeks).forEach((date) => {
        if (date < todayStr) return;
        const id = recurringBookingId(template.id, date);
        if (byId[id]) return; // already generated, or user cancelled this one

        const candidate = {
          id,
          date,
          startTime: template.startTime,
          endTime: template.endTime,
          room: template.room || MEETING_ROOM,
          topic: template.topic,
          ownerEmail: template.ownerEmail || ADMIN_EMAIL,
          note: template.note || "",
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          cancelledAt: "",
          cancelledBy: "",
          telegramStatus: "PENDING",
        };

        const conflict = active.find(
          (item) =>
            item.room === candidate.room &&
            item.date === candidate.date &&
            candidate.startTime < item.endTime &&
            candidate.endTime > item.startTime,
        );
        if (conflict) return; // keep the existing booking in this slot

        writeBookingRow(candidate);
        active.push(candidate);
        byId[id] = candidate;
        created += 1;
      });
    });
  } finally {
    lock.releaseLock();
  }
  return { created };
}

function upcomingDatesForWeekday(weekday, weeks) {
  const timeZone = Session.getScriptTimeZone();
  const now = new Date();
  const todayDow = Number(Utilities.formatDate(now, timeZone, "u")); // 1=Mon..7=Sun
  const delta = (weekday - todayDow + 7) % 7;
  const base = new Date(now.getTime());
  base.setDate(base.getDate() + delta);

  const dates = [];
  for (let i = 0; i < weeks; i += 1) {
    const day = new Date(base.getTime());
    day.setDate(day.getDate() + i * 7);
    dates.push(Utilities.formatDate(day, timeZone, "yyyy-MM-dd"));
  }
  return dates;
}

function recurringBookingId(templateId, date) {
  return `rec-${templateId}-${date}`;
}

// One-off helper: seeds the four standing weekly meetings, then materialises
// them. Safe to run more than once — existing templates are not duplicated.
function seedDefaultRecurringTemplates() {
  ensureSheet();
  ensureRecurringSheet();
  const defaults = [
    { weekday: 1, startTime: "11:00", endTime: "12:00", topic: "Team Project B2B" },
    { weekday: 2, startTime: "10:00", endTime: "11:00", topic: "Team Finance" },
    { weekday: 2, startTime: "11:00", endTime: "12:00", topic: "Team KOL" },
    { weekday: 2, startTime: "14:00", endTime: "15:00", topic: "Team Khoá Bosch" },
  ];
  const existing = listRecurringTemplates();
  defaults.forEach((item) => {
    const duplicate = existing.find(
      (template) =>
        Number(template.weekday) === item.weekday &&
        template.startTime === item.startTime &&
        template.topic === item.topic,
    );
    if (duplicate) return;
    addRecurringTemplate({
      weekday: item.weekday,
      startTime: item.startTime,
      endTime: item.endTime,
      room: MEETING_ROOM,
      topic: item.topic,
      ownerEmail: ADMIN_EMAIL,
    });
  });
  return generateRecurringBookings(RECURRING_WEEKS_AHEAD);
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
