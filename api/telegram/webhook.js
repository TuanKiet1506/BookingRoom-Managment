const { randomUUID } = require("crypto");
const {
  cancelBooking,
  clearBotState,
  createBooking,
  getBotState,
  listBookings,
  setBotState,
} = require("../_appsScript");
const {
  bookingCancelledMessage,
  bookingCreatedMessage,
  sendTelegramMessage,
} = require("../_telegram");

const TIME_ZONE = "Asia/Saigon";
const ADMIN_EMAIL = "admin@khomes.com.vn";
const MEETING_ROOM = "Phòng họp";

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
    if (!isAllowedChat(chatId, message.chat.type)) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const command = parseCommand(message.text);
    const responseText = command
      ? await handleCommand(command, chatId)
      : await handleConversation(chatId, message.text);
    if (!responseText) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    await sendTelegramMessage(responseText, chatId);
    res.status(200).json({ ok: true, command });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    const chatId = req.body?.message?.chat?.id || req.body?.edited_message?.chat?.id;
    if (chatId) {
      await sendTelegramMessage(
        `Không thực hiện được yêu cầu: ${formatErrorMessage(error)}`,
        String(chatId),
      ).catch(() => {});
    }
    res.status(200).json({ ok: false, error: String(error.message || error) });
  }
};

function isAllowedChat(chatId, chatType) {
  const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || "");
  return chatType === "private" || Boolean(allowedChatId && chatId === allowedChatId);
}

function parseCommand(text) {
  const firstToken = String(text || "").trim().split(/\s+/)[0] || "";
  const command = firstToken.split("@")[0].toLowerCase();
  if ([
    "/help",
    "/today",
    "/tomorrow",
    "/upcoming",
    "/id",
    "/book",
    "/cancel",
    "/confirm",
    "/abort",
  ].includes(command)) {
    return command;
  }
  return "";
}

async function handleCommand(command, chatId) {
  if (command === "/help") return helpMessage();
  if (command === "/id") return `Chat ID: ${chatId}`;
  if (command === "/book") return startBookFlow(chatId);
  if (command === "/cancel") return startCancelFlow(chatId);
  if (command === "/confirm") return confirmFlow(chatId);
  if (command === "/abort") return abortFlow(chatId);
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
    "/book - Đặt lịch họp mới",
    "/cancel - Hủy lịch họp sắp tới",
    "/confirm - Xác nhận thao tác đang làm",
    "/abort - Hủy thao tác đang làm",
    "/help - Xem hướng dẫn sử dụng bot",
  ].join("\n");
}

async function startBookFlow(chatId) {
  await setBotState(chatId, {
    flow: "book",
    step: "date",
    data: {},
    createdAt: new Date().toISOString(),
  });
  return [
    "Mình sẽ giúp bạn đặt lịch phòng họp.",
    "",
    "Bạn muốn đặt lịch ngày nào?",
    "Ví dụ: hôm nay, ngày mai, 2026-06-26 hoặc 26/06/2026",
    "",
    "Gõ /abort nếu muốn hủy thao tác.",
  ].join("\n");
}

async function startCancelFlow(chatId) {
  const options = await upcomingBookings(14);
  if (options.length === 0) {
    await clearBotState(chatId);
    return "Không có lịch họp sắp tới để hủy.";
  }

  await setBotState(chatId, {
    flow: "cancel",
    step: "choose",
    options,
    createdAt: new Date().toISOString(),
  });

  return [
    "Bạn muốn hủy lịch nào?",
    "",
    options.map((booking, index) => `${index + 1}. ${shortBookingLine(booking)}`).join("\n"),
    "",
    "Gõ số thứ tự để chọn, ví dụ: 1",
    "Hoặc gõ /abort để thoát.",
  ].join("\n");
}

async function handleConversation(chatId, text) {
  const state = await getBotState(chatId);
  if (!state) return "";
  if (state.flow === "book") return continueBookFlow(chatId, state, text);
  if (state.flow === "cancel") return continueCancelFlow(chatId, state, text);
  return "";
}

async function continueBookFlow(chatId, state, text) {
  const value = String(text || "").trim();
  const data = state.data || {};

  if (state.step === "date") {
    const date = parseFriendlyDate(value);
    if (!date) return "Mình chưa hiểu ngày này. Bạn nhập dạng hôm nay, ngày mai, 2026-06-26 hoặc 26/06/2026 nhé.";
    if (date < todayISO()) return "Không thể đặt lịch cho ngày trong quá khứ. Bạn chọn ngày khác nhé.";
    await setBotState(chatId, { ...state, step: "startTime", data: { ...data, date } });
    return "Giờ bắt đầu là mấy giờ?\nVí dụ: 14:00";
  }

  if (state.step === "startTime") {
    const startTime = parseTime(value);
    if (!startTime) return "Giờ bắt đầu chưa đúng định dạng. Bạn nhập dạng HH:mm, ví dụ 14:00 nhé.";
    await setBotState(chatId, { ...state, step: "endTime", data: { ...data, startTime } });
    return "Giờ kết thúc là mấy giờ?\nVí dụ: 15:00";
  }

  if (state.step === "endTime") {
    const endTime = parseTime(value);
    if (!endTime) return "Giờ kết thúc chưa đúng định dạng. Bạn nhập dạng HH:mm, ví dụ 15:00 nhé.";
    if (data.startTime >= endTime) return "Giờ kết thúc phải sau giờ bắt đầu. Bạn nhập lại giờ kết thúc nhé.";
    await setBotState(chatId, { ...state, step: "topic", data: { ...data, endTime } });
    return "Chủ đề cuộc họp là gì?";
  }

  if (state.step === "topic") {
    if (!value) return "Bạn nhập giúp mình chủ đề cuộc họp nhé.";
    await setBotState(chatId, { ...state, step: "note", data: { ...data, topic: value } });
    return "Có ghi chú gì thêm không?\nGõ - nếu không có.";
  }

  if (state.step === "note") {
    const booking = buildBooking({ ...data, note: value === "-" ? "" : value });
    await setBotState(chatId, { ...state, step: "confirm", booking });
    return [
      "Xác nhận đặt lịch?",
      "",
      formatBookingSummary(booking),
      "",
      "Gõ /confirm để xác nhận hoặc /abort để hủy thao tác.",
    ].join("\n");
  }

  if (state.step === "confirm") {
    return "Bạn gõ /confirm để xác nhận hoặc /abort để hủy thao tác nhé.";
  }

  return "";
}

async function continueCancelFlow(chatId, state, text) {
  const value = String(text || "").trim();
  if (state.step === "choose") {
    const index = Number(value) - 1;
    const booking = state.options?.[index];
    if (!booking) return "Mình chưa thấy số thứ tự hợp lệ. Bạn gõ số trong danh sách, ví dụ: 1";

    await setBotState(chatId, { ...state, step: "confirm", booking });
    return [
      "Xác nhận hủy lịch?",
      "",
      formatBookingSummary(booking),
      "",
      "Gõ /confirm để xác nhận hoặc /abort để hủy thao tác.",
    ].join("\n");
  }
  if (state.step === "confirm") {
    return "Bạn gõ /confirm để xác nhận hoặc /abort để hủy thao tác nhé.";
  }
  return "";
}

async function confirmFlow(chatId) {
  const state = await getBotState(chatId);
  if (!state) return "Không có thao tác nào đang chờ xác nhận.";

  if (state.flow === "book" && state.step === "confirm" && state.booking) {
    await createBooking(state.booking, ADMIN_EMAIL);
    await clearBotState(chatId);
    await notifyDefaultGroupIfNeeded(chatId, bookingCreatedMessage(state.booking));
    return `Đã đặt lịch thành công.\n\n${formatBookingSummary(state.booking)}`;
  }

  if (state.flow === "cancel" && state.step === "confirm" && state.booking) {
    await cancelBooking(state.booking.id, ADMIN_EMAIL);
    await clearBotState(chatId);
    await notifyDefaultGroupIfNeeded(chatId, bookingCancelledMessage(state.booking, ADMIN_EMAIL));
    return `Đã hủy lịch thành công.\n\n${formatBookingSummary(state.booking)}`;
  }

  return "Thao tác hiện tại chưa sẵn sàng để xác nhận.";
}

async function abortFlow(chatId) {
  await clearBotState(chatId);
  return "Đã hủy thao tác đang làm.";
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

async function upcomingBookings(days) {
  const dates = Array.from({ length: days }, (_, index) => addDays(todayISO(), index));
  return (await Promise.all(dates.map(listBookings)))
    .flat()
    .filter((booking) => booking.status !== "CANCELLED")
    .filter((booking) => minutesUntilStart(booking) >= 0)
    .sort(sortBookings)
    .slice(0, 12);
}

function buildBooking(data) {
  return {
    id: randomUUID(),
    topic: data.topic,
    room: MEETING_ROOM,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    ownerEmail: ADMIN_EMAIL,
    note: data.note || "",
    status: "CONFIRMED",
    createdAt: new Date().toISOString(),
    cancelledAt: "",
    cancelledBy: "",
    telegramStatus: "PENDING",
  };
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

function shortBookingLine(booking) {
  return `${formatDate(booking.date)} ${booking.startTime || ""} - ${booking.endTime || ""} | ${booking.topic || ""}`;
}

function parseFriendlyDate(value) {
  const raw = String(value || "").trim();
  const text = normalizeText(raw);
  if (text === "hom nay" || text === "today") return todayISO();
  if (text === "ngay mai" || text === "tomorrow") return addDays(todayISO(), 1);

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return [
      isoMatch[1],
      isoMatch[2].padStart(2, "0"),
      isoMatch[3].padStart(2, "0"),
    ].join("-");
  }

  const vnMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (vnMatch) {
    return [
      vnMatch[3],
      vnMatch[2].padStart(2, "0"),
      vnMatch[1].padStart(2, "0"),
    ].join("-");
  }

  return "";
}

function parseTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

async function notifyDefaultGroupIfNeeded(sourceChatId, text) {
  const defaultChatId = String(process.env.TELEGRAM_CHAT_ID || "");
  if (defaultChatId && defaultChatId !== String(sourceChatId)) {
    await sendTelegramMessage(text);
  }
}

function formatErrorMessage(error) {
  const message = String(error?.message || error || "không rõ nguyên nhân");
  if (message.includes("Conflict with")) {
    return `lịch bị trùng khung giờ. ${message}`;
  }
  if (message.includes("Cannot book past date")) {
    return "không thể đặt lịch cho ngày trong quá khứ.";
  }
  if (message.includes("Admin account only")) {
    return "tài khoản không có quyền thao tác.";
  }
  return message;
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
