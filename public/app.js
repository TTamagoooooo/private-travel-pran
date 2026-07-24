// 宿泊台帳 — frontend logic. No build step: plain fetch calls to /api/*,
// which are handled by the Worker (src/index.js) backed by Cloudflare KV.

const state = {
  trips: [],
  selectedId: null,
  hotels: {}, // tripId -> hotel[]
  loadingHotels: false,
};

const el = {
  tripStrip: document.getElementById("trip-strip"),
  tripForm: document.getElementById("trip-form"),
  mainPanel: document.getElementById("main-panel"),
};

// ---------------------------------------------------------------- API ----
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || `API error ${res.status}`);
  return data;
}

async function loadTrips() {
  state.trips = await api("/trips");
  if (!state.selectedId && state.trips.length > 0) state.selectedId = state.trips[0].id;
  render();
}

async function loadHotels(tripId) {
  state.loadingHotels = true;
  render();
  try {
    state.hotels[tripId] = await api(`/hotels?tripId=${tripId}`);
  } catch (e) {
    console.error(e);
  } finally {
    state.loadingHotels = false;
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
  loadHotels(trip.id);
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

async function addManualHotel(trip, entry) {
  const hotel = await api("/hotels", {
    method: "POST",
    body: JSON.stringify({ tripId: trip.id, ...entry }),
  });
  state.hotels[trip.id] = [...(state.hotels[trip.id] || []), hotel];
  render();
}

async function toggleDecided(trip, hotel) {
  hotel.decided = !hotel.decided;
  render();
  await api(`/hotels/${hotel.id}?tripId=${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ decided: hotel.decided }),
  }).catch(console.error);
}

async function deleteHotel(trip, hotel) {
  state.hotels[trip.id] = (state.hotels[trip.id] || []).filter((h) => h.id !== hotel.id);
  render();
  await api(`/hotels/${hotel.id}?tripId=${trip.id}`, { method: "DELETE" }).catch(console.error);
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
      render();
      if (!state.hotels[t.id]) loadHotels(t.id);
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

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMain() {
  const trip = state.trips.find((t) => t.id === state.selectedId);
  if (!trip) {
    el.mainPanel.innerHTML = `<div class="empty-state bordered">旅程を追加して、宿を記録し始めましょう。</div>`;
    return;
  }

  const hotels = state.hotels[trip.id];

  el.mainPanel.innerHTML = `
    <div class="trip-header">
      <div>
        <h2>📍 ${escapeHtml(trip.destination)}</h2>
        <div class="trip-meta">
          ${trip.checkin || trip.checkout ? `<span>🗓 ${trip.checkin || "未定"} 〜 ${trip.checkout || "未定"}</span>` : ""}
          <span>👥 ${trip.guests}名</span>
          ${trip.budget ? `<span>💰 上限 ${fmtYen(trip.budget)}/泊</span>` : ""}
        </div>
      </div>
      <div>
        <button class="btn-outline" id="btn-manual">＋ 候補を追加</button>
      </div>
    </div>

    <div>
      <p class="notes-label">📝 旅程メモ</p>
      <textarea class="notes-box" id="trip-notes" rows="2" placeholder="移動手段、集合場所、持ち物、気になることなど自由に記録できます">${escapeHtml(trip.notes)}</textarea>
    </div>

    <div id="manual-form" class="panel hidden">
      <input id="m-name" placeholder="ホテル名" class="col-2" />
      <input id="m-price" type="number" placeholder="価格(1泊/円)" />
      <input id="m-rating" type="number" min="0" max="5" placeholder="評価(0〜5・任意)" />
      <input id="m-distance" placeholder="距離(例: 駅から600m)" />
      <input id="m-access" placeholder="アクセス(例: 徒歩5分)" />
      <input id="m-note" placeholder="メモ" class="col-2" />
      <input id="m-url" placeholder="URL(予約ページなど・任意)" class="col-2" />
      <button class="btn-primary col-2" id="m-save">この候補を追加</button>
    </div>

    ${state.loadingHotels ? `<div class="empty-state"><span class="spin">⟳</span> 読み込み中…</div>` : ""}

    ${!state.loadingHotels && hotels && hotels.length === 0 ? `
      <div class="empty-state">まだ候補がありません。「候補を追加」で記録を始めましょう。</div>
    ` : ""}

    ${hotels && hotels.length > 0 ? `
      <div class="hotel-list">
        ${hotels.map((h) => hotelCardHtml(trip, h)).join("")}
      </div>
    ` : ""}
  `;

  // wire up events
  document.getElementById("btn-manual").addEventListener("click", () => {
    document.getElementById("manual-form").classList.toggle("hidden");
  });
  document.getElementById("trip-notes").addEventListener("blur", (e) => saveTripNotes(trip.id, e.target.value));

  const mSave = document.getElementById("m-save");
  if (mSave) {
    mSave.addEventListener("click", () => {
      const name = document.getElementById("m-name").value.trim();
      if (!name) return;
      const entry = {
        name,
        price: document.getElementById("m-price").value || null,
        rating: document.getElementById("m-rating").value || null,
        distance: document.getElementById("m-distance").value.trim(),
        access: document.getElementById("m-access").value.trim(),
        note: document.getElementById("m-note").value.trim(),
        url: document.getElementById("m-url").value.trim(),
      };
      addManualHotel(trip, entry);
      document.getElementById("manual-form").classList.add("hidden");
    });
  }

  (hotels || []).forEach((h) => {
    const pin = document.getElementById(`pin-${h.id}`);
    const del = document.getElementById(`del-${h.id}`);
    if (pin) pin.addEventListener("click", () => toggleDecided(trip, h));
    if (del) del.addEventListener("click", () => {
      if (confirm(`「${h.name}」を削除しますか？`)) deleteHotel(trip, h);
    });
  });
}

function hotelCardHtml(trip, h) {
  const overBudget = trip.budget && h.price && Number(h.price) > trip.budget;
  return `
    <div class="hotel-card ${h.decided ? "decided" : ""}">
      <div class="actions">
        <span id="pin-${h.id}" class="${h.decided ? "pinned" : ""}" title="決定にする">📌</span>
        <span id="del-${h.id}" title="削除">✕</span>
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
        ${overBudget ? `<div class="over-budget">予算オーバー</div>` : ""}
        <div class="hotel-price">${fmtYen(h.price)}</div>
        <div class="hotel-price-label">1泊あたり</div>
        ${starsHtml(h.rating)}
      </div>
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
  if (state.selectedId) loadHotels(state.selectedId);
});
