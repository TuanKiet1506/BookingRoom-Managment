const {
  bookingReminderMessage,
  sendTelegramMessage,
} = require("../_telegram");

const ADMIN_EMAIL = "admin@khomes.com.vn";
const REMINDED_STATUS = "REMINDED_1H";
const TIME_ZONE = "Asia/Saigon";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedCron(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";
  if (!scriptUrl) {
    res.status(500).json({
      ok: false,
      error: "Missing GOOGLE_APPS_SCRIPT_URL",
      hint: "Add GOOGLE_APPS_SCRIPT_URL in Vercel Environment Variables and redeploy.",
    });
    return;
  }

  try {
    const dates = getReminderDates();
    const bookings = (await Promise.all(dates.map((date) => listBookings(scriptUrl, date))))
      .flat()
      .filter(shouldSendReminder);

    const sent = [];
    for (const booking of bookings) {
      await sendTelegramMessage(bookingReminderMessage(booking));
      await markReminderSent(scriptUrl, booking.id);
      sent.push(booking.id);
    }

    res.status(200).json({ ok: true, checkedDates: dates, sent });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error.message || error),
      hint: "Open this URL in a browser after redeploy to read this JSON error. Common causes: Apps Script URL is old/not public, Telegram token/chat id is wrong, or Apps Script was not redeployed.",
    });
  }
};

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET || "";
  const rawQuerySecret = req.query?.secret || "";
  const querySecret = Array.isArray(rawQuerySecret) ? rawQuerySecret[0] : rawQuerySecret;
  const userAgent = String(req.headers["user-agent"] || "");
  return Boolean(
    (secret && querySecret === secret) ||
      userAgent.includes("vercel-cron/1.0"),
  );
}

async function listBookings(scriptUrl, date) {
  const result = await callAppsScript(scriptUrl, {
    action: "list",
    date,
  });
  return result.bookings || [];
}

async function markReminderSent(scriptUrl, id) {
  await callAppsScript(scriptUrl, {
    action: "markTelegram",
    id,
    telegramStatus: REMINDED_STATUS,
    userEmail: ADMIN_EMAIL,
  });
}

async function callAppsScript(scriptUrl, payload) {
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

function shouldSendReminder(booking) {
  if (booking.status !== "CONFIRMED") return false;
  if (booking.telegramStatus === REMINDED_STATUS) return false;

  const minutes = minutesUntilStart(booking);
  return minutes >= 55 && minutes <= 70;
}

function minutesUntilStart(booking) {
  const now = getZonedParts(new Date());
  const bookingDate = String(booking.date || "");
  const [hour, minute] = String(booking.startTime || "").split(":").map(Number);
  if (!bookingDate || Number.isNaN(hour) || Number.isNaN(minute)) return Infinity;

  const dayOffset = dayDiff(now.date, bookingDate);
  const nowMinutes = now.hour * 60 + now.minute;
  const bookingMinutes = dayOffset * 24 * 60 + hour * 60 + minute;
  return bookingMinutes - nowMinutes;
}

function getReminderDates() {
  const today = getZonedParts(new Date()).date;
  const tomorrow = addDays(today, 1);
  return [today, tomorrow];
}

function getZonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function dayDiff(fromDate, toDate) {
  return (dateToUTC(toDate) - dateToUTC(fromDate)) / 86400000;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateToUTC(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
