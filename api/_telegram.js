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

async function sendTelegramMessage(text) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) return { ok: false, skipped: true };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
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
  bookingCancelledMessage,
  bookingCreatedMessage,
  bookingReminderMessage,
  hasTelegramConfig,
  sendTelegramMessage,
};
