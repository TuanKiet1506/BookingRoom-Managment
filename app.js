const MEETING_ROOM = "Phòng họp";
const DEFAULT_ROOMS = [MEETING_ROOM];
const ADMIN_EMAIL = "admin@khomes.com.vn";
const TIME_SLOTS = Array.from({ length: 28 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(
    totalMinutes % 60,
  ).padStart(2, "0")}`;
});
// Materialise recurring meetings this many weeks ahead in localStorage mode.
// Mirrors RECURRING_WEEKS_AHEAD in google-apps-script.gs.
const RECURRING_WEEKS_AHEAD = 8;
const WEEKDAY_LABELS = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

const STORAGE = {
  user: "meetinghub.user",
  authToken: "meetinghub.authToken",
  bookings: "meetinghub.bookings",
  activities: "meetinghub.activities",
  scriptUrl: "meetinghub.scriptUrl",
};

const state = {
  user: localStorage.getItem(STORAGE.user) || "",
  authToken: localStorage.getItem(STORAGE.authToken) || "",
  googleClientId: "",
  serverSheetUrlEnabled: false,
  scriptUrl: localStorage.getItem(STORAGE.scriptUrl) || "",
  rooms: DEFAULT_ROOMS,
  selectedDate: todayISO(),
  roomFilter: MEETING_ROOM,
  search: "",
  bookings: [],
  activities: loadJSON(STORAGE.activities, []),
  activeView: "calendar",
};

let refreshRequestId = 0;

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  googleSignInButton: document.querySelector("#googleSignInButton"),
  loginError: document.querySelector("#loginError"),
  app: document.querySelector("#app"),
  logoutButton: document.querySelector("#logoutButton"),
  userEmail: document.querySelector("#userEmail"),
  avatarText: document.querySelector("#avatarText"),
  syncState: document.querySelector("#syncState"),
  calendarView: document.querySelector("#calendarView"),
  settingsView: document.querySelector("#settingsView"),
  navItems: document.querySelectorAll(".nav-item[data-view]"),
  roomFilter: document.querySelector("#roomFilter"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  prevDay: document.querySelector("#prevDay"),
  nextDay: document.querySelector("#nextDay"),
  todayButton: document.querySelector("#todayButton"),
  bookingCount: document.querySelector("#bookingCount"),
  totalMetric: document.querySelector("#totalMetric"),
  upcomingMetric: document.querySelector("#upcomingMetric"),
  cancelledMetric: document.querySelector("#cancelledMetric"),
  activityList: document.querySelector("#activityList"),
  calendarGrid: document.querySelector("#calendarGrid"),
  openBookingModal: document.querySelector("#openBookingModal"),
  exportExcelButton: document.querySelector("#exportExcelButton"),
  bookingModal: document.querySelector("#bookingModal"),
  bookingForm: document.querySelector("#bookingForm"),
  bookingError: document.querySelector("#bookingError"),
  roomInput: document.querySelector("#roomInput"),
  dateInput: document.querySelector("#dateInput"),
  ownerInput: document.querySelector("#ownerInput"),
  startInput: document.querySelector("#startInput"),
  endInput: document.querySelector("#endInput"),
  recurringInput: document.querySelector("#recurringInput"),
  recurringHint: document.querySelector("#recurringHint"),
  searchInput: document.querySelector("#searchInput"),
  settingsForm: document.querySelector("#settingsForm"),
  scriptUrl: document.querySelector("#scriptUrl"),
  settingsMessage: document.querySelector("#settingsMessage"),
};

bootstrap();

async function bootstrap() {
  seedLocalData();
  await loadAppConfig();
  fillStaticControls();
  bindEvents();
  initGoogleSignIn();
  renderAuth();
  if (!isAllowedUser(state.user)) handleLogout();
  if (state.user) refreshBookings();
}

async function loadAppConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const config = await response.json();
    state.googleClientId = config.googleClientId || "";
    state.serverSheetUrlEnabled = Boolean(config.hasServerSheetUrl);
  } catch {
    state.googleClientId = "";
    state.serverSheetUrlEnabled = false;
  }
}

function initGoogleSignIn() {
  if (!state.googleClientId) {
    els.loginError.textContent =
      "Chưa cấu hình GOOGLE_CLIENT_ID trên Vercel.";
    return;
  }

  const render = () => {
    if (!window.google?.accounts?.id) {
      window.setTimeout(render, 120);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: handleGoogleCredential,
    });
    const buttonWidth = Math.min(
      448,
      Math.max(280, els.googleSignInButton.parentElement.clientWidth),
    );
    window.google.accounts.id.renderButton(els.googleSignInButton, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: buttonWidth,
    });
  };

  render();
}

function fillStaticControls() {
  els.scriptUrl.value = state.scriptUrl;

  DEFAULT_ROOMS.forEach((room) => {
    els.roomFilter.append(new Option(room, room));
    els.roomInput.append(new Option(room, room));
  });
  els.roomFilter.value = MEETING_ROOM;

  TIME_SLOTS.forEach((slot) => {
    els.startInput.append(new Option(slot, slot));
    els.endInput.append(new Option(slot, slot));
  });

  els.startInput.value = "09:00";
  els.endInput.value = "10:00";
  els.dateInput.value = state.selectedDate;
  els.dateInput.min = todayISO();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", (event) => event.preventDefault());
  els.logoutButton.addEventListener("click", handleLogout);
  els.openBookingModal.addEventListener("click", openBookingModal);
  els.exportExcelButton.addEventListener("click", exportCurrentBookings);
  els.bookingForm.addEventListener("submit", handleCreateBooking);
  els.dateInput.addEventListener("change", updateRecurringHint);
  els.roomFilter.addEventListener("change", () => {
    state.roomFilter = els.roomFilter.value;
    renderCalendar();
  });
  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    renderCalendar();
  });
  els.prevDay.addEventListener("click", () => moveDay(-1));
  els.nextDay.addEventListener("click", () => moveDay(1));
  els.todayButton.addEventListener("click", () => {
    state.selectedDate = todayISO();
    refreshBookings();
  });
  els.settingsForm.addEventListener("submit", handleSaveSettings);

  document.querySelectorAll("[data-close-modal]").forEach((item) => {
    item.addEventListener("click", closeBookingModal);
  });

  els.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      state.activeView = item.dataset.view;
      renderViews();
    });
  });

  els.calendarGrid.addEventListener("click", handleCalendarAction);
}

async function handleGoogleCredential(response) {
  els.loginError.textContent = "";
  try {
    const result = await verifyGoogleCredential(response.credential);
    if (!isAllowedUser(result.email)) {
      throw new Error("Chỉ tài khoản admin@khomes.com.vn được phép truy cập.");
    }

    state.user = result.email;
    state.authToken = result.token;
    localStorage.setItem(STORAGE.user, state.user);
    localStorage.setItem(STORAGE.authToken, state.authToken);
    renderAuth();
    await refreshBookings();
  } catch (error) {
    handleLogout();
    els.loginError.textContent = formatErrorMessage(error);
  }
}

async function verifyGoogleCredential(credential) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Không xác thực được tài khoản Google.");
  }
  return result;
}

function handleLogout() {
  state.user = "";
  state.authToken = "";
  localStorage.removeItem(STORAGE.user);
  localStorage.removeItem(STORAGE.authToken);
  window.google?.accounts?.id?.disableAutoSelect();
  renderAuth();
}

function handleSaveSettings(event) {
  event.preventDefault();
  state.scriptUrl = els.scriptUrl.value.trim();

  localStorage.setItem(STORAGE.scriptUrl, state.scriptUrl);
  els.settingsMessage.textContent =
    state.scriptUrl || state.serverSheetUrlEnabled
      ? "Đã lưu cấu hình. Dữ liệu đặt/hủy lịch sẽ ghi vào Google Sheet."
      : "Đã lưu cấu hình. Web đang dùng localStorage vì chưa có Apps Script Web App URL.";
  refreshBookings();
}

async function handleCreateBooking(event) {
  event.preventDefault();
  els.bookingError.textContent = "";

  const form = new FormData(els.bookingForm);
  const booking = {
    id: crypto.randomUUID(),
    topic: form.get("topic").trim(),
    room: form.get("room"),
    date: form.get("date"),
    startTime: form.get("startTime"),
    endTime: form.get("endTime"),
    ownerEmail: state.user,
    note: form.get("note").trim(),
    status: "CONFIRMED",
    createdAt: new Date().toISOString(),
    cancelledAt: "",
    cancelledBy: "",
    telegramStatus: "PENDING",
  };

  const error = validateBooking(booking);
  if (error) {
    els.bookingError.textContent = error;
    return;
  }

  const recurring = form.get("recurring") === "on";

  try {
    if (recurring) {
      await saveRecurringBooking(booking);
      pushActivity(
        "Đặt lịch lặp lại",
        `Lặp lại ${WEEKDAY_LABELS[weekdayOf(booking.date)]} hàng tuần: ${booking.topic} (${booking.startTime}-${booking.endTime}).`,
      );
    } else {
      await saveBooking(booking);
      pushActivity("Đặt lịch", telegramPreview("dat", booking));
    }
    closeBookingModal();
    state.selectedDate = booking.date;
    await refreshBookings();
  } catch (errorSave) {
    els.bookingError.textContent = `Không lưu được lịch: ${formatErrorMessage(errorSave)}`;
  }
}

async function handleCalendarAction(event) {
  const cancelButton = event.target.closest("[data-cancel-id]");
  if (!cancelButton) return;

  const booking = state.bookings.find(
    (item) => item.id === cancelButton.dataset.cancelId,
  );
  if (!booking) return;

  const cancelled = {
    ...booking,
    status: "CANCELLED",
    cancelledAt: new Date().toISOString(),
    cancelledBy: state.user,
  };

  try {
    await cancelBooking(cancelled);
    pushActivity("Hủy lịch", telegramPreview("huy", cancelled));
    await refreshBookings();
  } catch {
    pushActivity("Lỗi", "Không hủy được lịch. Hãy kiểm tra cấu hình Sheet hoặc quyền Apps Script.");
    renderActivities();
  }
}

function openBookingModal() {
  els.bookingForm.reset();
  const minDate = todayISO();
  els.dateInput.min = minDate;
  els.dateInput.value = state.selectedDate < minDate ? minDate : state.selectedDate;
  els.ownerInput.value = state.user;
  els.roomInput.value = DEFAULT_ROOMS[0];
  els.startInput.value = "09:00";
  els.endInput.value = "10:00";
  els.bookingError.textContent = "";
  updateRecurringHint();
  els.bookingModal.classList.remove("hidden");
}

function updateRecurringHint() {
  if (!els.recurringHint) return;
  const dateValue = els.dateInput.value || state.selectedDate;
  const label = WEEKDAY_LABELS[weekdayOf(dateValue)] || "";
  els.recurringHint.textContent = label
    ? `Tự tạo lịch vào ${label} hàng tuần cho ${RECURRING_WEEKS_AHEAD} tuần tới (tự gia hạn).`
    : "";
}

function closeBookingModal() {
  els.bookingModal.classList.add("hidden");
}

async function refreshBookings() {
  const requestId = ++refreshRequestId;
  renderLoading();
  try {
    const bookings = await loadBookings();
    if (requestId !== refreshRequestId) return;
    state.bookings = bookings;
  } catch {
    if (requestId !== refreshRequestId) return;
    state.bookings = normalizeBookings(loadJSON(STORAGE.bookings, []));
    pushActivity(
      "Cảnh báo",
      "Không đọc được Google Sheet, đang dùng dữ liệu cục bộ.",
    );
  }
  renderAll();
}

function renderAuth() {
  const loggedIn = Boolean(state.user && state.authToken && isAllowedUser(state.user));
  els.loginScreen.classList.toggle("hidden", loggedIn);
  els.app.classList.toggle("hidden", !loggedIn);
  els.userEmail.textContent = state.user;
  els.avatarText.textContent = state.user ? state.user[0].toUpperCase() : "U";
  renderSyncState();
  renderViews();
}

function renderViews() {
  els.calendarView.classList.toggle("hidden", state.activeView !== "calendar");
  els.settingsView.classList.toggle("hidden", state.activeView !== "settings");
  els.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.activeView);
  });
}

function renderAll() {
  renderSyncState();
  renderCalendar();
  renderActivities();
}

function renderSyncState() {
  els.syncState.textContent = state.scriptUrl
    ? "Đang đồng bộ Google Sheet"
    : "Đang dùng bộ nhớ trình duyệt";
}

function renderLoading() {
  els.calendarGrid.style.setProperty("--room-count", DEFAULT_ROOMS.length);
  els.selectedDateLabel.textContent = formatDate(state.selectedDate);
  els.bookingCount.textContent = "Đang tải...";
  els.calendarGrid.innerHTML = `<div class="empty-note" style="grid-column: 1 / -1;">Đang tải lịch...</div>`;
}

function renderCalendar() {
  const rooms = DEFAULT_ROOMS;
  const bookings = filteredBookings();
  const activeBookings = bookings.filter((item) => item.status !== "CANCELLED");
  const cancelledBookings = state.bookings.filter(
    (item) => item.date === state.selectedDate && item.status === "CANCELLED",
  );

  els.selectedDateLabel.textContent = formatDate(state.selectedDate);
  els.bookingCount.textContent = `${bookings.length} lịch`;
  els.totalMetric.textContent = bookings.length;
  els.upcomingMetric.textContent = activeBookings.length;
  els.cancelledMetric.textContent = cancelledBookings.length;

  els.calendarGrid.style.setProperty("--room-count", rooms.length);
  els.calendarGrid.innerHTML = "";
  els.calendarGrid.append(gridCell("", "grid-header grid-time"));
  rooms.forEach((room) =>
    els.calendarGrid.append(gridCell(room, "grid-header")),
  );

  TIME_SLOTS.forEach((slot) => {
    els.calendarGrid.append(gridCell(slot, "grid-time"));
    rooms.forEach((room) => {
      const cell = gridCell("", "");
      const items = bookings.filter((booking) => {
        return booking.room === room && booking.startTime === slot;
      });
      items.forEach((booking) => cell.append(renderBookingBlock(booking)));
      els.calendarGrid.append(cell);
    });
  });

  if (bookings.length === 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.style.gridColumn = "1 / -1";
    note.textContent = "Chưa có lịch nào trong ngày hiện tại.";
    els.calendarGrid.append(note);
  }
}

function renderBookingBlock(booking) {
  const block = document.createElement("article");
  block.className = `booking-block ${booking.status === "CANCELLED" ? "cancelled" : ""}`;
  block.innerHTML = `
    <small>${booking.startTime} - ${booking.endTime}</small>
    <strong></strong>
    <small></small>
    <div class="booking-actions"></div>
  `;
  block.querySelector("strong").textContent = booking.topic;
  block.querySelectorAll("small")[1].textContent = booking.ownerEmail;

  if (booking.status !== "CANCELLED") {
    const button = document.createElement("button");
    button.className = "cancel-button";
    button.type = "button";
    button.dataset.cancelId = booking.id;
    button.textContent = "Hủy lịch";
    block.querySelector(".booking-actions").append(button);
  }

  return block;
}

function renderActivities() {
  els.activityList.innerHTML = "";
  if (state.activities.length === 0) {
    els.activityList.innerHTML = `<p class="muted">Chưa có thông báo nào.</p>`;
    return;
  }

  state.activities.slice(0, 8).forEach((activity) => {
    const item = document.createElement("article");
    item.className = "activity-item";
    item.innerHTML = `<strong></strong><p></p>`;
    item.querySelector("strong").textContent =
      `${activity.type} - ${formatDateTime(activity.createdAt)}`;
    item.querySelector("p").textContent = activity.message;
    els.activityList.append(item);
  });
}

function gridCell(text, extraClass) {
  const div = document.createElement("div");
  div.className = `grid-cell ${extraClass}`;
  div.textContent = text;
  return div;
}

function filteredBookings() {
  return state.bookings
    .filter((booking) => booking.date === state.selectedDate)
    .filter(
      (booking) =>
        normalizeRoom(booking.room) === MEETING_ROOM,
    )
    .filter((booking) => {
      if (!state.search) return true;
      return [booking.topic, booking.ownerEmail, booking.room, booking.note]
        .join(" ")
        .toLowerCase()
        .includes(state.search);
    })
    .sort(sortBookings);
}

function validateBooking(booking) {
  if (!booking.topic) return "Vui lòng nhập chủ đề.";
  if (booking.date < todayISO()) return "Không thể đặt lịch cho ngày trong quá khứ.";
  if (booking.startTime >= booking.endTime)
    return "Giờ kết thúc phải sau giờ bắt đầu.";

  const conflict = state.bookings.find((item) => {
    if (item.status === "CANCELLED") return false;
    return (
      normalizeRoom(item.room) === MEETING_ROOM &&
      item.date === booking.date &&
      booking.startTime < item.endTime &&
      booking.endTime > item.startTime
    );
  });

  if (conflict) {
    return `Bị trùng với lịch "${conflict.topic}" (${conflict.startTime}-${conflict.endTime}).`;
  }
  return "";
}

async function loadBookings() {
  if (!canUseGoogleSheet()) return normalizeBookings(loadJSON(STORAGE.bookings, []));
  const result = await sheetRequest({
    action: "list",
    date: state.selectedDate,
  });
  return normalizeBookings(result.bookings || []);
}

async function saveBooking(booking) {
  if (!canUseGoogleSheet()) {
    state.bookings = [...state.bookings, booking].sort(sortBookings);
    localStorage.setItem(STORAGE.bookings, JSON.stringify(state.bookings));
    return;
  }
  await sheetRequest({ action: "create", booking, userEmail: state.user });
}

async function saveRecurringBooking(booking) {
  const template = {
    weekday: isoWeekday(booking.date),
    startTime: booking.startTime,
    endTime: booking.endTime,
    room: booking.room,
    topic: booking.topic,
    note: booking.note,
    ownerEmail: state.user,
  };

  if (!canUseGoogleSheet()) {
    const occurrences = generateLocalRecurring(booking);
    const stored = loadJSON(STORAGE.bookings, []);
    const merged = [...stored, ...occurrences].sort(sortBookings);
    state.bookings = merged;
    localStorage.setItem(STORAGE.bookings, JSON.stringify(merged));
    return;
  }

  await sheetRequest({
    action: "createRecurring",
    template,
    userEmail: state.user,
  });
}

// localStorage fallback: expand a weekly booking into the next few weeks,
// skipping any slot that already conflicts locally.
function generateLocalRecurring(booking) {
  const stored = loadJSON(STORAGE.bookings, []);
  const active = stored.filter((item) => item.status !== "CANCELLED");
  const occurrences = [];
  const firstDate = parseDateInput(booking.date);

  for (let week = 0; week < RECURRING_WEEKS_AHEAD; week += 1) {
    const date = new Date(firstDate.getTime());
    date.setDate(date.getDate() + week * 7);
    const dateValue = toDateInputValue(date);
    if (dateValue < todayISO()) continue;

    const conflict = [...active, ...occurrences].some(
      (item) =>
        item.date === dateValue &&
        booking.startTime < item.endTime &&
        booking.endTime > item.startTime,
    );
    if (conflict) continue;

    occurrences.push({
      ...booking,
      id: crypto.randomUUID(),
      date: dateValue,
      createdAt: new Date().toISOString(),
    });
  }
  return occurrences;
}

async function cancelBooking(booking) {
  if (!canUseGoogleSheet()) {
    state.bookings = state.bookings.map((item) =>
      item.id === booking.id ? booking : item,
    );
    localStorage.setItem(STORAGE.bookings, JSON.stringify(state.bookings));
    return;
  }
  await sheetRequest({
    action: "cancel",
    id: booking.id,
    booking,
    userEmail: state.user,
  });
}

async function sheetRequest(payload) {
  const sheetPayload = {
    ...payload,
  };
  const response = await fetchSheet(state.scriptUrl, sheetPayload);
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`${response.status} ${response.statusText || "Apps Script không trả JSON"}`);
  }

  if (!response.ok) {
    throw new Error(result.error || `${response.status} ${response.statusText}`);
  }

  if (!result.ok) throw new Error(result.error || "Sheet request failed");
  return result;
}

function formatErrorMessage(error) {
  const message = String(error?.message || error || "không rõ nguyên nhân");
  if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
    return "Apps Script đang trả 401 Unauthorized. Hãy deploy Web App với quyền 'Anyone with the link' và copy đúng URL /exec mới nhất.";
  }
  if (message.includes("Company email only") || message.includes("Admin account only")) {
    return "tài khoản đăng nhập không có quyền truy cập.";
  }
  if (message.includes("Cannot book past date")) {
    return "không thể đặt lịch cho ngày trong quá khứ.";
  }
  return message;
}

function canUseGoogleSheet() {
  return Boolean(state.authToken && (state.serverSheetUrlEnabled || state.scriptUrl));
}

async function fetchSheet(scriptUrl, payload) {
  if (location.protocol !== "file:") {
    try {
      const proxyResponse = await fetch("/api/sheets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.authToken}`,
        },
        body: JSON.stringify({ scriptUrl, payload }),
      });
      if (proxyResponse.ok) return proxyResponse;
    } catch {
      // Fall back to direct Apps Script call for non-Vercel previews.
    }
  }

  if (!scriptUrl) {
    throw new Error("Chưa cấu hình Apps Script Web App URL.");
  }

  return fetch(scriptUrl, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function pushActivity(type, message) {
  state.activities = [
    {
      id: crypto.randomUUID(),
      type,
      message,
      createdAt: new Date().toISOString(),
    },
    ...state.activities,
  ];
  localStorage.setItem(STORAGE.activities, JSON.stringify(state.activities));
}

function exportCurrentBookings() {
  const rows = filteredBookings();
  const headers = [
    "Ngày",
    "Bắt đầu",
    "Kết thúc",
    "Phòng",
    "Chủ đề",
    "Người đặt",
    "Ghi chú",
    "Trạng thái",
    "Ngày tạo",
    "Người hủy",
    "Ngày hủy",
  ];
  const records = rows.map((booking) => [
    booking.date,
    booking.startTime,
    booking.endTime,
    booking.room,
    booking.topic,
    booking.ownerEmail,
    booking.note,
    booking.status,
    booking.createdAt,
    booking.cancelledBy,
    booking.cancelledAt,
  ]);
  const csv = [headers, ...records].map(toCsvRow).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich-phong-hop-${state.selectedDate}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsvRow(row) {
  return row
    .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
    .join(",");
}

function telegramPreview(action, booking) {
  const common = `${booking.room} | ${formatDate(booking.date)} ${booking.startTime}-${booking.endTime} | ${booking.topic}`;
  if (action === "huy")
    return `[Telegram sau này] Hủy lịch: ${common}. Người hủy: ${state.user}.`;
  return `[Telegram sau này] Đặt lịch: ${common}. Người đặt: ${booking.ownerEmail}.`;
}

function moveDay(delta) {
  const date = parseDateInput(state.selectedDate);
  date.setDate(date.getDate() + delta);
  state.selectedDate = toDateInputValue(date);
  els.selectedDateLabel.textContent = formatDate(state.selectedDate);
  refreshBookings();
}

function isAllowedUser(email) {
  return String(email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

function seedLocalData() {
  if (localStorage.getItem(STORAGE.bookings)) return;
  const demo = [
    {
      id: crypto.randomUUID(),
      topic: "Họp kế hoạch tuần",
      room: MEETING_ROOM,
      date: todayISO(),
      startTime: "09:00",
      endTime: "10:00",
      ownerEmail: ADMIN_EMAIL,
      note: "Rà soát việc đang chạy",
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      cancelledAt: "",
      cancelledBy: "",
      telegramStatus: "PENDING",
    },
    {
      id: crypto.randomUUID(),
      topic: "Review thiết kế",
      room: MEETING_ROOM,
      date: todayISO(),
      startTime: "14:00",
      endTime: "15:00",
      ownerEmail: ADMIN_EMAIL,
      note: "",
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      cancelledAt: "",
      cancelledBy: "",
      telegramStatus: "PENDING",
    },
  ];
  localStorage.setItem(STORAGE.bookings, JSON.stringify(demo));
}

function normalizeBookings(bookings) {
  return bookings.map((booking) => ({
    ...booking,
    date: normalizeDateValue(booking.date),
    startTime: normalizeTimeValue(booking.startTime),
    endTime: normalizeTimeValue(booking.endTime),
    room: MEETING_ROOM,
  }));
}

function normalizeDateValue(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const usDateMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usDateMatch) {
      return `${usDateMatch[3]}-${usDateMatch[1].padStart(2, "0")}-${usDateMatch[2].padStart(2, "0")}`;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : toDateInputValue(date);
}

function normalizeTimeValue(value) {
  if (!value) return "";
  const text = String(value);
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeRoom() {
  return MEETING_ROOM;
}

function loadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sortBookings(a, b) {
  return `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`);
}

function todayISO() {
  return toDateInputValue(new Date());
}

// JS weekday index (0=Sun..6=Sat) for a YYYY-MM-DD string.
function weekdayOf(dateValue) {
  return parseDateInput(dateValue).getDay();
}

// ISO weekday (1=Mon..7=Sun) to match the Apps Script recurring template format.
function isoWeekday(dateValue) {
  const day = weekdayOf(dateValue);
  return day === 0 ? 7 : day;
}

function parseDateInput(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
