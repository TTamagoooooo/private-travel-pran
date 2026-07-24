// 宿泊台帳 — frontend logic. No build step: plain fetch calls to /api/*,
// which are handled by the Worker (src/index.js) backed by Cloudflare KV.

const state = {
  trips: [],
  selectedId: null,
  hotels: {},    // tripId -> hotel[]
  transport: {}, // tripId -> transport[]
  expenses: {},  // tripId -> expense[]
  loading: false,
  activeTab: "hotels", // hotels | transport | expenses
};

const el = {
  tripStrip: document.getElementById("trip-strip"),
  tripForm: document.getElementById("trip-form"),
  mainPanel: document.getElementById("main-panel"),
};

const TRANSPORT_TYPES = ["新幹線", "飛行機", "電車", "バス", "レンタカー", "その他"];
const EXPENSE_CATEGORIES = ["食事", "観光", "お土産", "その他"];

// ---------------------------------------------------------------- API ----
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("認証が切れました。再ログインします。");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || `API error ${res.status}`);
  return data;
}

async function loadTrips() {
  try {
    state.trips = await api("/trips");
    if (!state.selectedId && state.trips.length > 0) state.selectedId = state.trips[0].id;
    render();
  } catch (e) {
    console.error(e);
    el.mainPanel.innerHTML = `<div class="error-banner"><p>読み込みに失敗しました。</p><p class="error-detail">${escapeHtml(e.message)}</p></div>`;
  }
}

async function loadTripData(tripId) {
  state.loading = true;
  render();
  try {
    const [hotels, transport, expenses] = await Promise.all([
      api(`/hotels?tripId=${tripId}`),
      api(`/transport?tripId=${tripId}`),
      api(`/expenses?tripId=${tripId}`),
    ]);
    state.hotels[tripId] = hotels;
    state.transport[tripId] = transport;
    state.expenses[tripId] = expenses;
  } catch (e) {
    console.error(e);
  } finally {
    state.loading = false;
    render();
  }
}

// ------------------------------------------------------------- actions ---
async function createTrip(payload) {
  const trip = await api("/trips", { method: "POST", body: JSON.stringify(payload) });
  state.trips.unshift(trip);
  state.selectedId = trip.id;
  el.tripForm.classList.add("hidden");
  render();
  loadTripData(trip.id);
}

async function deleteTrip(id) {
  state.trips = state.trips.filter((t) => t.id !== id);
  if (state.selectedId === id) state.selectedId = state.trips[0]?.id ?? null;
  render();
  await api(`/trips/${id}`, { method: "DELETE" }).catch(console.error);
}

async function saveTripNotes(id, notes) {
  await api(`/trips/${id}`, { method: "PATCH", body: JSON.stringify({ notes }) }).catch(console.error);
}

// hotels
async function addManualHotel(trip, entry) {
  const hotel = await api("/hotels", { method: "POST", body: JSON.stringify({ tripId: trip.id, ...entry }) });
  state.hotels[trip.id] = [...(state.hotels[trip.id] || []), hotel];
  render();
}
async function toggleHotelDecided(trip, item) {
  item.decided = !item.decided;
  render();
  await api(`/hotels/${item.id}?tripId=${trip.id}`, { method: "PATCH", body: JSON.stringify({ decided: item.decided }) }).catch(console.error);
}
async function deleteHotelItem(trip, item) {
  state.hotels[trip.id] = (state.hotels[trip.id] || []).filter((h) => h.id !== item.id);
  render();
  await api(`/hotels/${item.id}?tripId=${trip.id}`, { method: "DELETE" }).catch(console.error);
}

// transport
async function addTransport(trip, entry) {
  const item = await api("/transport", { method: "POST", body: JSON.stringify({ tripId: trip.id, ...entry }) });
  state.transport[trip.id] = [...(state.transport[trip.id] || []), item];
  render();
}
async function toggleTransportDecided(trip, item) {
  item.decided = !item.decided;
  render();
  await api(`/transport/${item.id}?tripId=${trip.id}`, { method: "PATCH", body: JSON.stringify({ decided: item.decided }) }).catch(console.error);
}
async function deleteTransportItem(trip, item) {
  state.transport[trip.id] = (state.transport[trip.id] || []).filter((t) => t.id !== item.id);
  render();
  await api(`/transport/${item.id}?tripId=${trip.id}`, { method: "DELETE" }).catch(console.error);
}

// expenses
async function addExpense(trip, entry) {
  const item = await api("/expenses", { method: "POST", body: JSON.stringify({ tripId: trip.id, ...entry }) });
  state.expenses[trip.id] = [...(state.expenses[trip.id] || []), item];
  render();
}
async function deleteExpenseItem(trip, item) {
  state.expenses[trip.id] = (state.expenses[trip.id] || []).filter((e) => e.id !== item.id);
  render();
  await api(`/expenses/${item.id}?tripId=${trip.id}`, { method: "DELETE" }).catch(console.error);
}

// -------------------------------------------------------------- render ---
function fmtYen(n) {
  if (n === null || n === undefined) return "—";
  return `¥${Number(n).toLocaleString()}`;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTripStrip() {
  el.tripStrip.innerHTML = "";
  state.trips.forEach((t) => {
    const tag = document.createElement("div");
    tag.className = "trip-tag" + (t.id === state.selectedId ? " active" : "");
    tag.innerHTML = `
      <span class="hole"></span>
      <div class="dates">🧳 ${t.checkin || "----"} → ${t.checkout || "----"}</div>
      <div class="name">${escapeHtml(t.title)}</div>
      <div class="dest">${escapeHtml(t.destination)}</div>
      <span class="close">✕</span>
    `;
    tag.addEventListener("click", (e) => {
      if (e.target.classList.contains("close")) return;
      state.selectedId = t.id;
      state.activeTab = "hotels";
      render();
      if (!state.hotels[t.id]) loadTripData(t.id);
    });
    tag.querySelector(".close").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`「${t.title}」を削除しますか？`)) deleteTrip(t.id);
    });
    el.tripStrip.appendChild(tag);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "trip-add";
  addBtn.innerHTML = "＋ 旅程を追加";
  addBtn.addEventListener("click", () => el.tripForm.classList.toggle("hidden"));
  el.tripStrip.appendChild(addBtn);
}

function calcSummary(trip) {
  const hotels = state.hotels[trip.id] || [];
  const transport = state.transport[trip.id] || [];
  const expenses = state.expenses[trip.id] || [];
  const hotelTotal = hotels.filter((h) => h.decided).reduce((s, h) => s + (h.price || 0), 0);
  const transportTotal = transport.filter((t) => t.decided).reduce((s, t) => s + (t.price || 0), 0);
  const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  return { hotelTotal, transportTotal, expenseTotal, grandTotal: hotelTotal + transportTotal + expenseTotal };
}

function renderMain() {
  const trip = state.trips.find((t) => t.id === state.selectedId);
  if (!trip) {
    el.mainPanel.innerHTML = `<div class="empty-state bordered">旅程を追加して、記録を始めましょう。</div>`;
    return;
  }

  const summary = calcSummary(trip);
  const overBudget = trip.budget && summary.grandTotal > trip.budget;

  el.mainPanel.innerHTML = `
    <div class="trip-header">
      <div>
        <h2>📍 ${escapeHtml(trip.destination)}</h2>
        <div class="trip-meta">
          ${trip.checkin || trip.checkout ? `<span>🗓 ${trip.checkin || "未定"} 〜 ${trip.checkout || "未定"}</span>` : ""}
          <span>👥 ${trip.guests}名</span>
          ${trip.budget ? `<span>💰 予算 ${fmtYen(trip.budget)}</span>` : ""}
        </div>
      </div>
    </div>

    <div>
      <p class="notes-label">📝 旅程メモ</p>
      <textarea class="notes-box" id="trip-notes" rows="2" placeholder="移動手段、集合場所、持ち物、気になることなど自由に記録できます">${escapeHtml(trip.notes)}</textarea>
    </div>

    <div class="cost-summary ${overBudget ? "over" : ""}">
      <div class="cost-item"><span class="cost-label">🏨 宿泊(決定分)</span><span class="cost-value">${fmtYen(summary.hotelTotal)}</span></div>
      <div class="cost-item"><span class="cost-label">🚄 交通(決定分)</span><span class="cost-value">${fmtYen(summary.transportTotal)}</span></div>
      <div class="cost-item"><span class="cost-label">💴 その他費用</span><span class="cost-value">${fmtYen(summary.expenseTotal)}</span></div>
      <div class="cost-item total"><span class="cost-label">合計</span><span class="cost-value">${fmtYen(summary.grandTotal)}</span></div>
      ${trip.budget ? `<div class="cost-item budget"><span class="cost-label">予算まで</span><span class="cost-value">${fmtYen(trip.budget - summary.grandTotal)}</span></div>` : ""}
    </div>

    <div class="tab-bar">
      <button class="tab-btn ${state.activeTab === "hotels" ? "active" : ""}" data-tab="hotels">🏨 宿泊</button>
      <button class="tab-btn ${state.activeTab === "transport" ? "active" : ""}" data-tab="transport">🚄 交通</button>
      <button class="tab-btn ${state.activeTab === "expenses" ? "active" : ""}" data-tab="expenses">💴 費用</button>
    </div>

    <div id="tab-content">
      ${state.loading ? `<div class="empty-state"><span class="spin">⟳</span> 読み込み中…</div>` : renderTabContent(trip)}
    </div>
  `;

  document.getElementById("trip-notes").addEventListener("blur", (e) => saveTripNotes(trip.id, e.target.value));
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  });

  wireTabEvents(trip);
}

function renderTabContent(trip) {
  if (state.activeTab === "hotels") return renderHotelsTab(trip);
  if (state.activeTab === "transport") return renderTransportTab(trip);
  if (state.activeTab === "expenses") return renderExpensesTab(trip);
  return "";
}

// ---- hotels tab ----
function renderHotelsTab(trip) {
  const hotels = state.hotels[trip.id] || [];
  return `
    <button class="btn-outline add-toggle" id="btn-add-hotel">＋ 候補を追加</button>
    <div id="form-hotel" class="panel hidden">
      <input id="h-name" placeholder="ホテル名" class="col-2" />
      <input id="h-price" type="number" placeholder="価格(円)" />
      <input id="h-rating" type="number" min="0" max="5" placeholder="評価(0〜5・任意)" />
      <input id="h-distance" placeholder="距離(例: 駅から600m)" />
      <input id="h-access" placeholder="アクセス(例: 徒歩5分)" />
      <input id="h-note" placeholder="メモ" class="col-2" />
      <input id="h-url" placeholder="URL(予約ページなど・任意)" class="col-2" />
      <button class="btn-primary col-2" id="h-save">この候補を追加</button>
    </div>
    ${hotels.length === 0 ? `<div class="empty-state">まだ宿泊候補がありません。</div>` : `
      <div class="hotel-list">
        ${hotels.map((h) => hotelCardHtml(h)).join("")}
      </div>
    `}
  `;
}

function hotelCardHtml(h) {
  return `
    <div class="hotel-card ${h.decided ? "decided" : ""}">
      <div class="actions">
        <span data-pin="${h.id}" class="${h.decided ? "pinned" : ""}" title="決定にする">📌</span>
        <span data-del="${h.id}" title="削除">✕</span>
      </div>
      <div class="hotel-body">
        <div class="hotel-name-row">
          <span class="hotel-name">${escapeHtml(h.name)}</span>
          ${h.decided ? `<span class="badge decided">決定</span>` : ""}
        </div>
        <div class="hotel-area">📍 ${h.distance ? escapeHtml(h.distance) : ""}</div>
        ${h.access ? `<div class="hotel-access">${escapeHtml(h.access)}</div>` : ""}
        ${h.note ? `<div class="hotel-note">${escapeHtml(h.note)}</div>` : ""}
        <div class="hotel-footer">
          ${h.url ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noreferrer">詳細を見る ↗</a>` : ""}
          <span class="added">記録: ${fmtDate(h.createdAt)}</span>
        </div>
      </div>
      <div class="hotel-price-col">
        <div class="hotel-price">${fmtYen(h.price)}</div>
        <div class="hotel-price-label">合計金額</div>
        ${starsHtml(h.rating)}
      </div>
    </div>
  `;
}

// ---- transport tab ----
function renderTransportTab(trip) {
  const items = state.transport[trip.id] || [];
  return `
    <button class="btn-outline add-toggle" id="btn-add-transport">＋ 交通手段を追加</button>
    <div id="form-transport" class="panel hidden">
      <label class="field col-2">種類
        <select id="t-type">${TRANSPORT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
      </label>
      <input id="t-from" placeholder="出発地(例: 東京駅)" />
      <input id="t-to" placeholder="到着地(例: 山形駅)" />
      <label class="field">出発日<input id="t-depart-date" type="date" /></label>
      <label class="field">出発時刻<input id="t-depart-time" type="time" /></label>
      <label class="field">到着日<input id="t-arrive-date" type="date" /></label>
      <label class="field">到着時刻<input id="t-arrive-time" type="time" /></label>
      <input id="t-price" type="number" placeholder="料金(円)" />
      <input id="t-note" placeholder="メモ(例: 便名、号車)" />
      <input id="t-url" placeholder="URL(予約ページなど・任意)" class="col-2" />
      <button class="btn-primary col-2" id="t-save">この交通手段を追加</button>
    </div>
    ${items.length === 0 ? `<div class="empty-state">まだ交通手段が登録されていません。</div>` : `
      <div class="hotel-list">
        ${items.map((t) => transportCardHtml(t)).join("")}
      </div>
    `}
  `;
}

function transportCardHtml(t) {
  const typeIcon = { 新幹線: "🚄", 飛行機: "✈️", 電車: "🚃", バス: "🚌", レンタカー: "🚗" }[t.type] || "🧭";
  return `
    <div class="hotel-card ${t.decided ? "decided" : ""}">
      <div class="actions">
        <span data-pin="${t.id}" class="${t.decided ? "pinned" : ""}" title="決定にする">📌</span>
        <span data-del="${t.id}" title="削除">✕</span>
      </div>
      <div class="hotel-body">
        <div class="hotel-name-row">
          <span class="hotel-name">${typeIcon} ${escapeHtml(t.from)} → ${escapeHtml(t.to)}</span>
          ${t.decided ? `<span class="badge decided">決定</span>` : ""}
        </div>
        <div class="hotel-area">🕐 ${t.departDate || ""} ${t.departTime || ""} 発 → ${t.arriveDate || ""} ${t.arriveTime || ""} 着</div>
        ${t.note ? `<div class="hotel-note">${escapeHtml(t.note)}</div>` : ""}
        <div class="hotel-footer">
          ${t.url ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noreferrer">詳細を見る ↗</a>` : ""}
          <span class="added">記録: ${fmtDate(t.createdAt)}</span>
        </div>
      </div>
      <div class="hotel-price-col">
        <div class="hotel-price">${fmtYen(t.price)}</div>
        <div class="hotel-price-label">${escapeHtml(t.type)}</div>
      </div>
    </div>
  `;
}

// ---- expenses tab ----
function renderExpensesTab(trip) {
  const items = state.expenses[trip.id] || [];
  const total = items.reduce((s, e) => s + (e.amount || 0), 0);
  return `
    <button class="btn-outline add-toggle" id="btn-add-expense">＋ 費用を追加</button>
    <div id="form-expense" class="panel hidden">
      <label class="field">カテゴリ
        <select id="e-category">${EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
      </label>
      <input id="e-label" placeholder="内容(例: 夕食、お土産)" />
      <input id="e-amount" type="number" placeholder="金額(円)" class="col-2" />
      <input id="e-note" placeholder="メモ(任意)" class="col-2" />
      <button class="btn-primary col-2" id="e-save">この費用を追加</button>
    </div>
    ${items.length === 0 ? `<div class="empty-state">まだ費用が登録されていません。</div>` : `
      <div class="expense-list">
        ${items.map((e) => expenseRowHtml(e)).join("")}
        <div class="expense-row total-row"><span>合計</span><span>${fmtYen(total)}</span></div>
      </div>
    `}
  `;
}

function expenseRowHtml(e) {
  return `
    <div class="expense-row">
      <span class="expense-cat">${escapeHtml(e.category)}</span>
      <span class="expense-label">${escapeHtml(e.label)}${e.note ? ` <span class="expense-note">(${escapeHtml(e.note)})</span>` : ""}</span>
      <span class="expense-amount">${fmtYen(e.amount)}</span>
      <span data-del="${e.id}" class="expense-del" title="削除">✕</span>
    </div>
  `;
}

function starsHtml(rating) {
  if (!rating) return "";
  const r = Math.round(rating);
  let s = '<div class="stars">';
  for (let i = 0; i < 5; i++) s += i < r ? "★" : "☆";
  s += "</div>";
  return s;
}

// ---- wire up events for whichever tab is showing ----
function wireTabEvents(trip) {
  if (state.activeTab === "hotels") {
    const addBtn = document.getElementById("btn-add-hotel");
    if (addBtn) addBtn.addEventListener("click", () => document.getElementById("form-hotel").classList.toggle("hidden"));
    const save = document.getElementById("h-save");
    if (save) save.addEventListener("click", () => {
      const name = document.getElementById("h-name").value.trim();
      if (!name) return;
      addManualHotel(trip, {
        name,
        price: document.getElementById("h-price").value || null,
        rating: document.getElementById("h-rating").value || null,
        distance: document.getElementById("h-distance").value.trim(),
        access: document.getElementById("h-access").value.trim(),
        note: document.getElementById("h-note").value.trim(),
        url: document.getElementById("h-url").value.trim(),
      });
    });
    (state.hotels[trip.id] || []).forEach((h) => {
      const pin = document.querySelector(`[data-pin="${h.id}"]`);
      const del = document.querySelector(`[data-del="${h.id}"]`);
      if (pin) pin.addEventListener("click", () => toggleHotelDecided(trip, h));
      if (del) del.addEventListener("click", () => { if (confirm(`「${h.name}」を削除しますか？`)) deleteHotelItem(trip, h); });
    });
  }

  if (state.activeTab === "transport") {
    const addBtn = document.getElementById("btn-add-transport");
    if (addBtn) addBtn.addEventListener("click", () => document.getElementById("form-transport").classList.toggle("hidden"));
    const save = document.getElementById("t-save");
    if (save) save.addEventListener("click", () => {
      const from = document.getElementById("t-from").value.trim();
      const to = document.getElementById("t-to").value.trim();
      if (!from || !to) return;
      addTransport(trip, {
        type: document.getElementById("t-type").value,
        from,
        to,
        departDate: document.getElementById("t-depart-date").value,
        departTime: document.getElementById("t-depart-time").value,
        arriveDate: document.getElementById("t-arrive-date").value,
        arriveTime: document.getElementById("t-arrive-time").value,
        price: document.getElementById("t-price").value || null,
        note: document.getElementById("t-note").value.trim(),
        url: document.getElementById("t-url").value.trim(),
      });
    });
    (state.transport[trip.id] || []).forEach((t) => {
      const pin = document.querySelector(`[data-pin="${t.id}"]`);
      const del = document.querySelector(`[data-del="${t.id}"]`);
      if (pin) pin.addEventListener("click", () => toggleTransportDecided(trip, t));
      if (del) del.addEventListener("click", () => { if (confirm(`削除しますか？`)) deleteTransportItem(trip, t); });
    });
  }

  if (state.activeTab === "expenses") {
    const addBtn = document.getElementById("btn-add-expense");
    if (addBtn) addBtn.addEventListener("click", () => document.getElementById("form-expense").classList.toggle("hidden"));
    const save = document.getElementById("e-save");
    if (save) save.addEventListener("click", () => {
      const label = document.getElementById("e-label").value.trim();
      const amount = document.getElementById("e-amount").value;
      if (!label || !amount) return;
      addExpense(trip, {
        category: document.getElementById("e-category").value,
        label,
        amount,
        note: document.getElementById("e-note").value.trim(),
      });
    });
    (state.expenses[trip.id] || []).forEach((e) => {
      const del = document.querySelector(`[data-del="${e.id}"]`);
      if (del) del.addEventListener("click", () => { if (confirm(`削除しますか？`)) deleteExpenseItem(trip, e); });
    });
  }
}

function render() {
  renderTripStrip();
  renderMain();
}

// ------------------------------------------------------------- trip form ---
document.getElementById("f-save").addEventListener("click", () => {
  const titleVal = document.getElementById("f-title").value.trim();
  const destination = document.getElementById("f-destination").value.trim();
  if (!titleVal || !destination) return;
  const payload = {
    title: titleVal,
    destination,
    checkin: document.getElementById("f-checkin").value,
    checkout: document.getElementById("f-checkout").value,
    guests: document.getElementById("f-guests").value || 1,
    budget: document.getElementById("f-budget").value || null,
    notes: document.getElementById("f-notes").value.trim(),
  };
  createTrip(payload);
  ["f-title", "f-destination", "f-checkin", "f-checkout", "f-notes"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("f-guests").value = 1;
  document.getElementById("f-budget").value = "";
});

// ------------------------------------------------------------------ init ---
document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login.html";
});

loadTrips().then(() => {
  if (state.selectedId) loadTripData(state.selectedId);
});
