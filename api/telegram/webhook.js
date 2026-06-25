const { listBookings } = require("../_appsScript");
const { sendTelegramMessage } = require("../_telegram");

const TIME_ZONE = "Asia/Saigon";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const message = req.body?.message || req.body?.edited_message;
    if (!message?.text || !message.chat?.id) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const chatId = String(message.chat.id);
    if (!isAllowedChat(chatId)) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const command = parseCommand(message.text);
    if (!command) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const responseText = await handleCommand(command);
    await sendTelegramMessage(responseText, chatId);
    res.status(200).json({ ok: true, command });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    res.status(200).json({ ok: false, error: String(error.message || error) });
  }
};

function isAllowedChat(chatId) {
  const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || "");
  return Boolean(allowedChatId && chatId === allowedChatId);
}

function parseCommand(text) {
  const firstToken = String(text || "").trim().split(/\s+/)[0] || "";
  const command = firstToken.split("@")[0].toLowerCase();
  if (["/help", "/today", "/tomorrow", "/upcoming"].includes(command)) {
    return command;
  }
  return "";
}

async function handleCommand(command) {
  if (command === "/help") return helpMessage();
  if (command === "/today") return bookingsForDateMessage("Lịch họp hôm nay", todayISO());
  if (command === "/tomorrow") return bookingsForDateMessage("Lịch họp ngày mai", addDays(todayISO(), 1));
  if (command === "/upcoming") return upcomingMessage();
  return helpMessage();
}

function helpMessage() {
  return [
    "MeetingHub Bot",
    "",
    "/today - Xem lịch họp hôm nay",
    "/tomorrow - Xem lịch họp ngày mai",
    "/upcoming - Xem lịch sắp diễn ra",
    "/help - Xem hướng dẫn sử dụng bot",
  ].join("\n");
}

async function bookingsForDateMessage(title, date) {
  const bookings = await listBookings(date);
  const active = bookings
    .filter((booking) => booking.status !== "CANCELLED")
    .sort(sortBookings);

  if (active.length === 0) {
    return `${title}\n${formatDate(date)}\n\nKhông có lịch họp.`;
  }

  return [
    title,
    formatDate(date),
    "",
    active.map(formatBookingSummary).join("\n\n"),
  ].join("\n");
}

async function upcomingMessage() {
  const dates = [todayISO(), addDays(todayISO(), 1), addDays(todayISO(), 2)];
  const rows = (await Promise.all(dates.map(listBookings)))
    .flat()
    .filter((booking) => booking.status !== "CANCELLED")
    .filter((booking) => minutesUntilStart(booking) >= 0)
    .sort(sortBookings)
    .slice(0, 8);

  if (rows.length === 0) {
    return "Lịch sắp diễn ra\n\nKhông có lịch họp sắp tới.";
  }

  return [
    "Lịch sắp diễn ra",
    "",
    rows.map(formatBookingSummary).join("\n\n"),
  ].join("\n");
}

function formatBookingSummary(booking) {
  return [
    `${booking.startTime || ""} - ${booking.endTime || ""} | ${booking.topic || ""}`,
    `Phòng: ${booking.room || "Phòng họp"}`,
    `Ngày: ${formatDate(booking.date)}`,
    `Người đặt: ${booking.ownerEmail || ""}`,
    booking.note ? `Ghi chú: ${booking.note}` : "",
  ].filter(Boolean).join("\n");
}

function sortBookings(a, b) {
  return `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
}

function todayISO() {
  return getZonedParts(new Date()).date;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function minutesUntilStart(booking) {
  const now = getZonedParts(new Date());
  const [hour, minute] = String(booking.startTime || "").split(":").map(Number);
  if (!booking.date || Number.isNaN(hour) || Number.isNaN(minute)) return Infinity;

  const dayOffset = dayDiff(now.date, booking.date);
  const nowMinutes = now.hour * 60 + now.minute;
  const bookingMinutes = dayOffset * 24 * 60 + hour * 60 + minute;
  return bookingMinutes - nowMinutes;
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

function dateToUTC(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
