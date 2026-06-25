const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const { listBookings } = require("../_appsScript");
const { sendTelegramPhoto } = require("../_telegram");

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

  let browser;
  try {
    const startDate = todayISO();
    const dates = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
    const bookingsByDate = await loadWeekBookings(dates);
    const html = renderSnapshotHtml(dates, bookingsByDate);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1400, height: 1600, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const element = await page.$("#snapshot");
    const image = await element.screenshot({ type: "png" });

    await sendTelegramPhoto(image, {
      caption: `Lịch phòng họp 7 ngày tới (${formatDateRange(dates)})`,
      filename: `lich-phong-hop-${startDate}.png`,
    });

    res.status(200).json({
      ok: true,
      sent: true,
      renderer: "chromium",
      dates,
      total: Object.values(bookingsByDate).flat().length,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error.message || error),
    });
  } finally {
    if (browser) await browser.close();
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

function renderSnapshotHtml(dates, bookingsByDate) {
  const generatedAt = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(new Date());

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #0a0a0a;
      color: #fafafa;
      font-family: Inter, Arial, "Helvetica Neue", sans-serif;
    }
    #snapshot {
      width: 1360px;
      min-height: 1520px;
      background:
        radial-gradient(circle at 16% 0%, rgba(34, 197, 94, 0.12), transparent 34%),
        linear-gradient(180deg, rgba(255,255,255,0.035), transparent 280px),
        #0a0a0a;
      padding: 34px;
    }
    .shell {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      background: #171717;
      box-shadow: 0 22px 70px rgba(0,0,0,0.38);
      overflow: hidden;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 76px;
      padding: 0 28px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(23,23,23,0.96);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 9px;
      background: #22c55e;
      color: #04120a;
      font-weight: 900;
    }
    .brand strong { color: #22c55e; font-size: 24px; }
    .sync {
      color: #a3a3a3;
      font-size: 16px;
    }
    .content { padding: 30px; }
    .heading {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 22px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.1;
    }
    .heading p {
      margin: 0;
      color: #a3a3a3;
      font-size: 17px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 46px;
      border: 1px solid #262626;
      border-radius: 8px;
      background: #262626;
      padding: 0 16px;
      color: #a3a3a3;
      font-weight: 800;
      white-space: nowrap;
    }
    .week-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      background: #171717;
      overflow: hidden;
    }
    .day {
      min-height: 1120px;
      border-right: 1px solid rgba(38,38,38,0.9);
      background: #171717;
    }
    .day:last-child { border-right: 0; }
    .day-head {
      min-height: 88px;
      border-bottom: 1px solid rgba(38,38,38,0.9);
      background: #262626;
      padding: 14px 12px;
      text-align: center;
    }
    .day-head strong {
      display: block;
      font-size: 18px;
      color: #fafafa;
      line-height: 1.25;
    }
    .day-head span {
      display: block;
      margin-top: 5px;
      color: #a3a3a3;
      font-size: 13px;
      font-weight: 800;
    }
    .day-body {
      display: grid;
      gap: 10px;
      padding: 12px;
    }
    .booking {
      display: grid;
      gap: 5px;
      min-height: 104px;
      border: 1px solid rgba(59,130,246,0.68);
      border-left: 4px solid #3b82f6;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(34,197,94,0.08));
      color: #dbeafe;
      padding: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.22);
    }
    .booking time {
      color: rgba(250,250,250,0.72);
      font-size: 13px;
      font-weight: 800;
    }
    .booking strong {
      color: #fafafa;
      font-size: 15px;
      line-height: 1.25;
    }
    .booking small {
      color: rgba(250,250,250,0.72);
      font-size: 12px;
      line-height: 1.35;
    }
    .empty {
      display: grid;
      min-height: 220px;
      place-items: center;
      color: #737373;
      text-align: center;
      font-size: 14px;
      line-height: 1.45;
      border: 1px dashed rgba(255,255,255,0.08);
      border-radius: 8px;
    }
    .footer {
      margin-top: 18px;
      color: #737373;
      font-size: 14px;
      text-align: right;
    }
  </style>
</head>
<body>
  <main id="snapshot">
    <section class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">M</div>
          <strong>MeetingHub</strong>
        </div>
        <div class="sync">Đang đồng bộ Google Sheet</div>
      </header>
      <section class="content">
        <div class="heading">
          <div>
            <h1>Lịch phòng họp 7 ngày tới</h1>
            <p>Ảnh chụp tự động từ dữ liệu đặt phòng họp • Cập nhật lúc ${escapeHtml(generatedAt)}</p>
          </div>
          <div class="pill">${escapeHtml(formatDateRange(dates))}</div>
        </div>
        <section class="week-grid">
          ${dates.map((date) => renderDayColumn(date, bookingsByDate[date] || [])).join("")}
        </section>
        <div class="footer">MeetingHub — K-Homes</div>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function renderDayColumn(date, bookings) {
  return `<article class="day">
    <header class="day-head">
      <strong>${escapeHtml(formatWeekday(date))}</strong>
      <span>${escapeHtml(formatShortDate(date))} • ${bookings.length} lịch</span>
    </header>
    <div class="day-body">
      ${
        bookings.length
          ? bookings.map(renderBookingCard).join("")
          : `<div class="empty">Chưa có lịch họp</div>`
      }
    </div>
  </article>`;
}

function renderBookingCard(booking) {
  return `<article class="booking">
    <time>${escapeHtml(booking.startTime || "")} - ${escapeHtml(booking.endTime || "")}</time>
    <strong>${escapeHtml(booking.topic || "")}</strong>
    <small>${escapeHtml(booking.ownerEmail || "")}</small>
    ${booking.note ? `<small>${escapeHtml(booking.note)}</small>` : ""}
  </article>`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
