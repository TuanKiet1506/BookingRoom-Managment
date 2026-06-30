const fs = require("fs/promises");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const { listBookingsByDates } = require("../_appsScript");
const { sendTelegramPhoto } = require("../_telegram");

const TIME_ZONE = "Asia/Saigon";
const WIDTH = 1360;
const GRID_X = 80;
const TIME_COL_W = 64;
const DAY_COL_X = GRID_X + TIME_COL_W;  // 144
const DAY_W = 160;
const GRID_W = TIME_COL_W + DAY_W * 7;  // 1184
const HOURS_START = 7;
const HOURS_END = 21;
const N_HOURS = HOURS_END - HOURS_START; // 14
const HOUR_H = 60;
const DAY_HDR_H = 70;
const GRID_BODY_H = N_HOURS * HOUR_H;   // 840
const HEADER_H = 212;
const FOOTER_H = 86;
const SVG_H = HEADER_H + DAY_HDR_H + GRID_BODY_H + FOOTER_H; // 1208

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

    if (req.query.preview) {
      res.setHeader("Content-Type", "image/png");
      res.send(image);
      return;
    }

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
  const allBookings = await listBookingsByDates(dates);
  return dates.reduce((result, date) => {
    result[date] = allBookings
      .filter((booking) => booking.date === date && booking.status !== "CANCELLED")
      .sort(sortBookings);
    return result;
  }, {});
}

async function renderWeeklyScheduleImage(dates, bookingsByDate) {
  const fonts = await ensureFonts();
  const svg = renderSvg(dates, bookingsByDate);
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

function renderSvg(dates, bookingsByDate) {
  const generatedAt = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(new Date());

  const gridY = HEADER_H;
  const bodyY = gridY + DAY_HDR_H;

  const timeLines = buildTimeLines(bodyY);
  const vertSeparators = buildVerticalSeparators(gridY);
  const headerSeparator = `<line x1="${GRID_X}" y1="${bodyY}" x2="${GRID_X + GRID_W}" y2="${bodyY}" stroke="#333333" stroke-width="1"/>`;

  return `
<svg width="${WIDTH}" height="${SVG_H}" viewBox="0 0 ${WIDTH} ${SVG_H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bookingBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563EB" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#22C55E" stop-opacity="0.12"/>
    </linearGradient>
    <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000000" flood-opacity="0.32"/>
    </filter>
    <clipPath id="gridClip">
      <rect x="${GRID_X}" y="${gridY}" width="${GRID_W}" height="${DAY_HDR_H + GRID_BODY_H}" rx="12"/>
    </clipPath>
  </defs>

  <rect width="${WIDTH}" height="${SVG_H}" fill="#0A0A0A"/>
  <circle cx="172" cy="0" r="300" fill="#22C55E" opacity="0.10"/>
  <rect x="48" y="40" width="${WIDTH - 96}" height="${SVG_H - 80}" rx="18" fill="#171717" stroke="#262626" filter="url(#softShadow)"/>
  <rect x="48" y="40" width="${WIDTH - 96}" height="82" rx="18" fill="#171717" stroke="#262626"/>
  <rect x="86" y="62" width="42" height="42" rx="10" fill="#22C55E"/>
  <text x="107" y="90" text-anchor="middle" font-family="Noto Sans" font-size="20" font-weight="700" fill="#04120A">M</text>
  <text x="146" y="91" font-family="Noto Sans" font-size="25" font-weight="700" fill="#22C55E">MeetingHub</text>
  <text x="${WIDTH - 90}" y="91" text-anchor="end" font-family="Noto Sans" font-size="17" fill="#A3A3A3">Đang đồng bộ Google Sheet</text>

  <text x="80" y="166" font-family="Noto Sans" font-size="38" font-weight="700" fill="#FAFAFA">Lịch phòng họp 7 ngày tới</text>
  <text x="80" y="196" font-family="Noto Sans" font-size="18" fill="#A3A3A3">Ảnh chụp tự động từ dữ liệu đặt phòng họp • Cập nhật lúc ${escapeXml(generatedAt)}</text>
  <rect x="${WIDTH - 280}" y="150" width="200" height="48" rx="9" fill="#262626" stroke="#303030"/>
  <text x="${WIDTH - 180}" y="180" text-anchor="middle" font-family="Noto Sans" font-size="16" font-weight="700" fill="#A3A3A3">${escapeXml(formatDateRange(dates))}</text>

  <!-- Grid outer border -->
  <rect x="${GRID_X}" y="${gridY}" width="${GRID_W}" height="${DAY_HDR_H + GRID_BODY_H}" rx="12" fill="#171717" stroke="#262626"/>

  <g clip-path="url(#gridClip)">
    <!-- Time column background -->
    <rect x="${GRID_X}" y="${gridY}" width="${TIME_COL_W}" height="${DAY_HDR_H + GRID_BODY_H}" fill="#111111"/>

    <!-- Day header backgrounds -->
    <rect x="${DAY_COL_X}" y="${gridY}" width="${DAY_W * 7}" height="${DAY_HDR_H}" fill="#1E1E1E"/>

    <!-- Time column header label -->
    <text x="${GRID_X + TIME_COL_W / 2}" y="${gridY + 44}" text-anchor="middle" font-family="Noto Sans" font-size="11" fill="#4B4B4B">GIỜ</text>

    <!-- Horizontal hour lines + time labels -->
    ${timeLines}

    <!-- Header / body separator -->
    ${headerSeparator}

    <!-- Day columns (headers + booking cards) -->
    ${dates.map((date, index) => renderDayColumn(date, bookingsByDate[date] || [], DAY_COL_X + index * DAY_W, gridY, bodyY)).join("")}

    <!-- Vertical day separators -->
    ${vertSeparators}
  </g>

  <text x="${WIDTH - 80}" y="${SVG_H - 48}" text-anchor="end" font-family="Noto Sans" font-size="15" fill="#737373">MeetingHub - K-Homes</text>
</svg>`;
}

function buildTimeLines(bodyY) {
  const lines = [];
  for (let h = HOURS_START; h <= HOURS_END; h++) {
    const y = bodyY + (h - HOURS_START) * HOUR_H;
    const label = `${String(h).padStart(2, "0")}:00`;
    lines.push(`<line x1="${DAY_COL_X}" y1="${y}" x2="${DAY_COL_X + DAY_W * 7}" y2="${y}" stroke="#2A2A2A" stroke-width="1"/>`);
    lines.push(`<text x="${DAY_COL_X - 8}" y="${y + 4}" text-anchor="end" font-family="Noto Sans" font-size="11" fill="#555555">${label}</text>`);
  }
  for (let h = HOURS_START; h < HOURS_END; h++) {
    const y = bodyY + (h - HOURS_START) * HOUR_H + HOUR_H / 2;
    lines.push(`<line x1="${DAY_COL_X}" y1="${y}" x2="${DAY_COL_X + DAY_W * 7}" y2="${y}" stroke="#1E1E1E" stroke-width="1" stroke-dasharray="3 5"/>`);
  }
  return lines.join("\n    ");
}

function buildVerticalSeparators(gridY) {
  return Array.from({ length: 6 }, (_, i) => {
    const x = DAY_COL_X + (i + 1) * DAY_W;
    return `<line x1="${x}" y1="${gridY}" x2="${x}" y2="${gridY + DAY_HDR_H + GRID_BODY_H}" stroke="#262626" stroke-width="1"/>`;
  }).join("\n    ");
}

function renderDayColumn(date, bookings, x, headerY, bodyY) {
  const isToday = date === todayISO();
  const headerFill = isToday ? "#1A2A1A" : "#1E1E1E";
  const weekdayColor = isToday ? "#22C55E" : "#FAFAFA";

  return `
  <rect x="${x}" y="${headerY}" width="${DAY_W}" height="${DAY_HDR_H}" fill="${headerFill}"/>
  <text x="${x + DAY_W / 2}" y="${headerY + 30}" text-anchor="middle" font-family="Noto Sans" font-size="17" font-weight="700" fill="${weekdayColor}">${escapeXml(formatWeekday(date))}</text>
  <text x="${x + DAY_W / 2}" y="${headerY + 53}" text-anchor="middle" font-family="Noto Sans" font-size="12" fill="#737373">${escapeXml(formatShortDate(date))}${bookings.length > 0 ? ` • ${bookings.length} lịch` : ""}</text>
  ${bookings.map((booking) => renderBookingCard(booking, x, bodyY)).join("")}`;
}

function renderBookingCard(booking, colX, bodyY) {
  const [sh, sm] = parseTimeParts(booking.startTime);
  const [eh, em] = parseTimeParts(booking.endTime);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const clampedStart = Math.max(startMin, HOURS_START * 60);
  const clampedEnd = Math.min(endMin, HOURS_END * 60);
  if (clampedEnd <= clampedStart) return "";

  const offsetPx = ((clampedStart - HOURS_START * 60) / 60) * HOUR_H;
  const durationPx = ((clampedEnd - clampedStart) / 60) * HOUR_H;
  const cardX = colX + 3;
  const cardY = bodyY + offsetPx + 1;
  const cardW = DAY_W - 6;
  const cardH = Math.max(durationPx - 2, 22);
  const compact = cardH < 44;
  const showOwner = cardH >= 56;

  return `
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="5" fill="url(#bookingBg)" stroke="#3B82F6" stroke-opacity="0.70"/>
  <rect x="${cardX}" y="${cardY}" width="4" height="${cardH}" rx="2" fill="#3B82F6"/>
  <text x="${cardX + 9}" y="${cardY + 14}" font-family="Noto Sans" font-size="11" font-weight="700" fill="#BFDBFE">${escapeXml(booking.startTime || "")} - ${escapeXml(booking.endTime || "")}</text>
  ${!compact ? `<text x="${cardX + 9}" y="${cardY + 29}" font-family="Noto Sans" font-size="12" font-weight="700" fill="#FAFAFA">${escapeXml(truncate(booking.topic || "", 18))}</text>` : ""}
  ${showOwner ? `<text x="${cardX + 9}" y="${cardY + 43}" font-family="Noto Sans" font-size="10" fill="#A3A3A3">${escapeXml(truncate(booking.ownerEmail || "", 22))}</text>` : ""}`;
}

function parseTimeParts(value) {
  const parts = String(value || "0:00").split(":").map(Number);
  return [parts[0] || 0, parts[1] || 0];
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
  return getZonedDate(new Date());
}

function getZonedDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
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
