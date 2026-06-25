const sharp = require("sharp");
const { listBookings } = require("../_appsScript");
const { sendTelegramPhoto } = require("../_telegram");

const TIME_ZONE = "Asia/Saigon";
const WIDTH = 1200;
const CARD_HEIGHT = 164;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedCron(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const startDate = todayISO();
    const dates = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
    const bookingsByDate = await loadWeekBookings(dates);
    const image = await renderWeeklyScheduleImage(dates, bookingsByDate);

    await sendTelegramPhoto(image, {
      caption: `Lịch phòng họp 7 ngày tới (${formatDateRange(dates)})`,
      filename: `lich-phong-hop-${startDate}.png`,
    });

    res.status(200).json({
      ok: true,
      sent: true,
      dates,
      total: Object.values(bookingsByDate).flat().length,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error.message || error),
    });
  }
};

async function loadWeekBookings(dates) {
  const rows = await Promise.all(dates.map(listBookings));
  return dates.reduce((result, date, index) => {
    result[date] = rows[index]
      .filter((booking) => booking.status !== "CANCELLED")
      .sort(sortBookings);
    return result;
  }, {});
}

async function renderWeeklyScheduleImage(dates, bookingsByDate) {
  const height = 238 + dates.length * CARD_HEIGHT;
  const svg = renderSvg(dates, bookingsByDate, height);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderSvg(dates, bookingsByDate, height) {
  const generatedAt = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(new Date());

  const cards = dates.map((date, index) => {
    const y = 182 + index * CARD_HEIGHT;
    return renderDayCard(date, bookingsByDate[date] || [], y);
  }).join("");

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${height}" fill="#F6F8FC"/>
  <rect x="48" y="42" width="1104" height="${height - 84}" rx="34" fill="#FFFFFF" stroke="#DFE7F3"/>
  <text x="86" y="104" fill="#102458" font-family="Arial, sans-serif" font-size="42" font-weight="800">Lịch phòng họp 7 ngày tới</text>
  <text x="86" y="142" fill="#7280A3" font-family="Arial, sans-serif" font-size="22">Cập nhật lúc ${escapeXml(generatedAt)} • MeetingHub</text>
  ${cards}
</svg>`;
}

function renderDayCard(date, bookings, y) {
  const activeCount = bookings.length;
  const rows = bookings.slice(0, 3);
  const overflow = activeCount - rows.length;
  const rowSvg = rows.length
    ? rows.map((booking, index) => renderBookingRow(booking, y + 56 + index * 32)).join("")
    : `<text x="332" y="${y + 92}" fill="#94A3B8" font-family="Arial, sans-serif" font-size="22">Không có lịch họp</text>`;
  const overflowSvg = overflow > 0
    ? `<text x="332" y="${y + 154}" fill="#64748B" font-family="Arial, sans-serif" font-size="19">+${overflow} lịch khác</text>`
    : "";

  return `
  <rect x="86" y="${y}" width="1028" height="136" rx="22" fill="#F8FBFF" stroke="#E2E8F0"/>
  <text x="122" y="${y + 48}" fill="#102458" font-family="Arial, sans-serif" font-size="28" font-weight="800">${escapeXml(formatDateLabel(date))}</text>
  <text x="122" y="${y + 84}" fill="#0F766E" font-family="Arial, sans-serif" font-size="20" font-weight="700">${activeCount} lịch</text>
  <line x1="292" y1="${y + 24}" x2="292" y2="${y + 112}" stroke="#E2E8F0" stroke-width="2"/>
  ${rowSvg}
  ${overflowSvg}`;
}

function renderBookingRow(booking, y) {
  return `
  <circle cx="316" cy="${y - 7}" r="5" fill="#22C55E"/>
  <text x="332" y="${y}" fill="#102458" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(booking.startTime || "")} - ${escapeXml(booking.endTime || "")}</text>
  <text x="470" y="${y}" fill="#334155" font-family="Arial, sans-serif" font-size="21">${escapeXml(truncate(booking.topic || "", 54))}</text>`;
}

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

function todayISO() {
  return getZonedParts(new Date()).date;
}

function getZonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(new Date(`${date}T00:00:00+07:00`));
}

function formatDateRange(dates) {
  return `${formatShortDate(dates[0])} - ${formatShortDate(dates[dates.length - 1])}`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(`${date}T00:00:00+07:00`));
}

function sortBookings(a, b) {
  return `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
