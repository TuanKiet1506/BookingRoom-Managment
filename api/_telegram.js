function getTelegramConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  };
}

function hasTelegramConfig() {
  const { token, chatId } = getTelegramConfig();
  return Boolean(token && chatId);
}

const TELEGRAM_COMMANDS = [
  { command: "help", description: "Xem hướng dẫn sử dụng bot" },
  { command: "today", description: "Xem lịch họp hôm nay" },
  { command: "tomorrow", description: "Xem lịch họp ngày mai" },
  { command: "upcoming", description: "Xem lịch sắp diễn ra" },
  { command: "id", description: "Xem Chat ID" },
  { command: "book", description: "Đặt lịch họp mới" },
  { command: "cancel", description: "Hủy lịch họp sắp tới" },
  { command: "confirm", description: "Xác nhận thao tác" },
  { command: "abort", description: "Hủy thao tác" },
];

async function callTelegramApi(method, body) {
  const { token } = getTelegramConfig();
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ${method} failed`);
  }
  return result;
}

async function setTelegramCommands(options = {}) {
  const scopes = [
    { type: "default" },
    { type: "all_private_chats" },
    { type: "all_group_chats" },
  ];
  if (options.chatId) {
    scopes.push({ type: "chat", chat_id: String(options.chatId) });
  }

  const results = [];
  for (const scope of scopes) {
    const result = await callTelegramApi("setMyCommands", {
      scope,
      commands: TELEGRAM_COMMANDS,
    });
    results.push({ scope: scope.type, ok: result.ok });
  }
  return results;
}

async function sendTelegramMessage(text, targetChatId) {
  const { token, chatId } = getTelegramConfig();
  const destination = targetChatId || chatId;
  if (!token || !destination) return { ok: false, skipped: true };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: destination,
      text,
      disable_web_page_preview: true,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || "Telegram sendMessage failed");
  }
  return result;
}

async function sendTelegramPhoto(imageBuffer, options = {}) {
  const { token, chatId } = getTelegramConfig();
  const destination = options.chatId || chatId;
  if (!token || !destination) return { ok: false, skipped: true };

  const form = new FormData();
  form.append("chat_id", destination);
  if (options.caption) form.append("caption", options.caption);
  form.append(
    "photo",
    new Blob([imageBuffer], { type: "image/png" }),
    options.filename || "weekly-schedule.png",
  );

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || "Telegram sendPhoto failed");
  }
  return result;
}

function formatBookingDate(booking) {
  const value = booking?.date || "";
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Saigon",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatBookingLine(booking) {
  return [
    `Phòng: ${booking.room || "Phòng họp"}`,
    `Ngày: ${formatBookingDate(booking)}`,
    `Giờ: ${booking.startTime || ""} - ${booking.endTime || ""}`,
    `Chủ đề: ${booking.topic || ""}`,
    `Người đặt: ${booking.ownerEmail || ""}`,
    booking.note ? `Ghi chú: ${booking.note}` : "",
  ].filter(Boolean).join("\n");
}

function bookingCreatedMessage(booking) {
  return `Đã đặt lịch phòng họp\n\n${formatBookingLine(booking)}`;
}

function bookingCancelledMessage(booking, userEmail) {
  return [
    "Đã hủy lịch phòng họp",
    "",
    formatBookingLine(booking),
    `Người hủy: ${userEmail || booking.cancelledBy || ""}`,
  ].filter(Boolean).join("\n");
}

function bookingReminderMessage(booking) {
  return `Nhắc lịch phòng họp sau 1 giờ\n\n${formatBookingLine(booking)}`;
}

module.exports = {
  TELEGRAM_COMMANDS,
  bookingCancelledMessage,
  bookingCreatedMessage,
  bookingReminderMessage,
  hasTelegramConfig,
  sendTelegramMessage,
  sendTelegramPhoto,
  setTelegramCommands,
};
