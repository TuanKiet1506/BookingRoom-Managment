const fs = require("fs/promises");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const { listBookings } = require("../_appsScript");
const { sendTelegramPhoto } = require("../_telegram");

const TIME_ZONE = "Asia/Saigon";
const WIDTH = 1360;
const DAY_WIDTH = 172;
const FONT_REGULAR_URL =
  "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const FONT_BOLD_URL =
  "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";

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
      renderer: "resvg",
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
  const fonts = await ensureFonts();
  const maxBookings = Math.max(
    1,
    ...Object.values(bookingsByDate).map((bookings) => bookings.length),
  );
  const height = 318 + Math.max(820, maxBookings * 132);
  const svg = renderSvg(dates, bookingsByDate, height);
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      fontFiles: fonts,
      loadSystemFonts: false,
      defaultFontFamily: "Noto Sans",
    },
  });
  return renderer.render().asPng();
}

async function ensureFonts() {
  const regular = await ensureFont("NotoSans-Regular.ttf", FONT_REGULAR_URL);
  const bold = await ensureFont("NotoSans-Bold.ttf", FONT_BOLD_URL);
  return [regular, bold];
}

async function ensureFont(filename, url) {
  const target = path.join("/tmp", filename);
  try {
    await fs.access(target);
    return target;
  } catch {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cannot download font ${filename}: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(target, buffer);
    return target;
  }
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
  const gridX = 80;
  const gridY = 212;
  const dayHeight = height - gridY - 86;

  return `
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bookingBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563EB" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#22C55E" stop-opacity="0.12"/>
    </linearGradient>
    <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000000" flood-opacity="0.32"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="#0A0A0A"/>
  <circle cx="172" cy="0" r="300" fill="#22C55E" opacity="0.10"/>
  <rect x="48" y="40" width="${WIDTH - 96}" height="${height - 80}" rx="18" fill="#171717" stroke="#262626" filter="url(#softShadow)"/>
  <rect x="48" y="40" width="${WIDTH - 96}" height="82" rx="18" fill="#171717" stroke="#262626"/>
  <rect x="86" y="62" width="42" height="42" rx="10" fill="#22C55E"/>
  <text x="107" y="90" text-anchor="middle" font-family="Noto Sans" font-size="20" font-weight="700" fill="#04120A">M</text>
  <text x="146" y="91" font-family="Noto Sans" font-size="25" font-weight="700" fill="#22C55E">MeetingHub</text>
  <text x="${WIDTH - 90}" y="91" text-anchor="end" font-family="Noto Sans" font-size="17" fill="#A3A3A3">Đang đồng bộ Google Sheet</text>

  <text x="80" y="166" font-family="Noto Sans" font-size="38" font-weight="700" fill="#FAFAFA">Lịch phòng họp 7 ngày tới</text>
  <text x="80" y="196" font-family="Noto Sans" font-size="18" fill="#A3A3A3">Ảnh chụp tự động từ dữ liệu đặt phòng họp • Cập nhật lúc ${escapeXml(generatedAt)}</text>
  <rect x="${WIDTH - 280}" y="150" width="200" height="48" rx="9" fill="#262626" stroke="#303030"/>
  <text x="${WIDTH - 180}" y="180" text-anchor="middle" font-family="Noto Sans" font-size="16" font-weight="700" fill="#A3A3A3">${escapeXml(formatDateRange(dates))}</text>

  <rect x="${gridX}" y="${gridY}" width="${DAY_WIDTH * 7}" height="${dayHeight}" rx="12" fill="#171717" stroke="#262626"/>
  ${dates.map((date, index) => renderDayColumn(date, bookingsByDate[date] || [], gridX + index * DAY_WIDTH, gridY, dayHeight)).join("")}
  <text x="${WIDTH - 80}" y="${height - 48}" text-anchor="end" font-family="Noto Sans" font-size="15" fill="#737373">MeetingHub - K-Homes</text>
</svg>`;
}

function renderDayColumn(date, bookings, x, y, height) {
  const bodyY = y + 88;
  const bodyHeight = height - 88;
  const visible = bookings.slice(0, 8);
  const overflow = bookings.length - visible.length;
  return `
  <rect x="${x}" y="${y}" width="${DAY_WIDTH}" height="${height}" fill="#171717" stroke="#262626"/>
  <rect x="${x}" y="${y}" width="${DAY_WIDTH}" height="88" fill="#262626" stroke="#262626"/>
  <text x="${x + DAY_WIDTH / 2}" y="${y + 34}" text-anchor="middle" font-family="Noto Sans" font-size="19" font-weight="700" fill="#FAFAFA">${escapeXml(formatWeekday(date))}</text>
  <text x="${x + DAY_WIDTH / 2}" y="${y + 61}" text-anchor="middle" font-family="Noto Sans" font-size="13" font-weight="700" fill="#A3A3A3">${escapeXml(formatShortDate(date))} • ${bookings.length} lịch</text>
  ${
    visible.length
      ? visible.map((booking, index) => renderBookingCard(booking, x + 10, bodyY + 12 + index * 118)).join("")
      : renderEmptyState(x + 12, bodyY + 26)
  }
  ${overflow > 0 ? `<text x="${x + 16}" y="${bodyY + bodyHeight - 24}" font-family="Noto Sans" font-size="13" fill="#A3A3A3">+${overflow} lịch khác</text>` : ""}`;
}

function renderBookingCard(booking, x, y) {
  return `
  <rect x="${x}" y="${y}" width="${DAY_WIDTH - 20}" height="104" rx="9" fill="url(#bookingBg)" stroke="#3B82F6" stroke-opacity="0.70"/>
  <rect x="${x}" y="${y}" width="5" height="104" rx="3" fill="#3B82F6"/>
  <text x="${x + 14}" y="${y + 24}" font-family="Noto Sans" font-size="13" font-weight="700" fill="#BFDBFE">${escapeXml(booking.startTime || "")} - ${escapeXml(booking.endTime || "")}</text>
  <text x="${x + 14}" y="${y + 50}" font-family="Noto Sans" font-size="14" font-weight="700" fill="#FAFAFA">${escapeXml(truncate(booking.topic || "", 19))}</text>
  <text x="${x + 14}" y="${y + 74}" font-family="Noto Sans" font-size="12" fill="#D4D4D4">${escapeXml(truncate(booking.ownerEmail || "", 24))}</text>
  ${booking.note ? `<text x="${x + 14}" y="${y + 94}" font-family="Noto Sans" font-size="11" fill="#A3A3A3">${escapeXml(truncate(booking.note, 24))}</text>` : ""}
  `;
}

function renderEmptyState(x, y) {
  return `
  <rect x="${x}" y="${y}" width="${DAY_WIDTH - 24}" height="168" rx="9" fill="#171717" stroke="#303030" stroke-dasharray="5 6"/>
  <text x="${x + (DAY_WIDTH - 24) / 2}" y="${y + 78}" text-anchor="middle" font-family="Noto Sans" font-size="13" fill="#737373">Chưa có</text>
  <text x="${x + (DAY_WIDTH - 24) / 2}" y="${y + 101}" text-anchor="middle" font-family="Noto Sans" font-size="13" fill="#737373">lịch họp</text>
  `;
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

function formatWeekday(date) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(`${date}T00:00:00+07:00`));
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(`${date}T00:00:00+07:00`));
}

function formatDateRange(dates) {
  return `${formatShortDate(dates[0])} - ${formatShortDate(dates[dates.length - 1])}`;
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
  return String(value).length > maxLength
    ? `${String(value).slice(0, maxLength - 1)}…`
    : String(value);
}
