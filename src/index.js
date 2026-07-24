import { getJSON, putJSON, deleteKey } from "./kv.js";
import { verifySession, createSession } from "./auth.js";
import { json } from "./util.js";

const PUBLIC_PATHS = new Set(["/login.html", "/style.css", "/api/login"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- auth gate (runs before everything else, including static assets) ----
    if (!PUBLIC_PATHS.has(path)) {
      const cookieHeader = request.headers.get("Cookie") || "";
      const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      const valid = await verifySession(token, env.SESSION_SECRET);
      if (!valid) {
        if (path.startsWith("/api/")) return json({ error: "認証が必要です" }, 401);
        return Response.redirect(`${url.origin}/login.html`, 302);
      }
    }

    try {
      // ---- auth endpoints ----
      if (path === "/api/login" && request.method === "POST") return handleLogin(request, env);
      if (path === "/api/logout" && request.method === "POST") return handleLogout();

      // ---- trips ----
      if (path === "/api/trips" && request.method === "GET") return listTrips(env);
      if (path === "/api/trips" && request.method === "POST") return createTrip(request, env);
      const tripMatch = path.match(/^\/api\/trips\/([^/]+)$/);
      if (tripMatch && request.method === "PATCH") return updateTrip(request, env, tripMatch[1]);
      if (tripMatch && request.method === "DELETE") return deleteTrip(env, tripMatch[1]);

      // ---- hotels ----
      if (path === "/api/hotels" && request.method === "GET") return listHotels(url, env);
      if (path === "/api/hotels" && request.method === "POST") return createHotel(request, env);
      const hotelMatch = path.match(/^\/api\/hotels\/([^/]+)$/);
      if (hotelMatch && request.method === "PATCH") return updateHotel(request, env, url, hotelMatch[1]);
      if (hotelMatch && request.method === "DELETE") return deleteHotel(env, url, hotelMatch[1]);

      // ---- transport ----
      if (path === "/api/transport" && request.method === "GET") return listTransport(url, env);
      if (path === "/api/transport" && request.method === "POST") return createTransport(request, env);
      const transportMatch = path.match(/^\/api\/transport\/([^/]+)$/);
      if (transportMatch && request.method === "PATCH") return updateTransport(request, env, url, transportMatch[1]);
      if (transportMatch && request.method === "DELETE") return deleteTransport(env, url, transportMatch[1]);

      // ---- expenses ----
      if (path === "/api/expenses" && request.method === "GET") return listExpenses(url, env);
      if (path === "/api/expenses" && request.method === "POST") return createExpense(request, env);
      const expenseMatch = path.match(/^\/api\/expenses\/([^/]+)$/);
      if (expenseMatch && request.method === "PATCH") return updateExpense(request, env, url, expenseMatch[1]);
      if (expenseMatch && request.method === "DELETE") return deleteExpense(env, url, expenseMatch[1]);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }

    // ---- everything else: static assets (index.html, style.css, app.js, ...) ----
    return env.ASSETS.fetch(request);
  },
};

// ------------------------------------------------------------- auth ---
async function handleLogin(request, env) {
  if (!env.SITE_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "SITE_PASSWORD / SESSION_SECRET が設定されていません" }, 500);
  }
  const body = await request.json().catch(() => ({}));
  if (body.password !== env.SITE_PASSWORD) {
    return json({ error: "パスワードが違います" }, 401);
  }
  const token = await createSession(env.SESSION_SECRET, 30);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function handleLogout() {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ------------------------------------------------------------ trips ---
async function listTrips(env) {
  const trips = await getJSON(env, "trips", []);
  trips.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return json(trips);
}

async function createTrip(request, env) {
  const body = await request.json();
  if (!body.title || !body.destination) return json({ error: "title and destination are required" }, 400);
  const trip = {
    id: crypto.randomUUID(),
    title: body.title,
    destination: body.destination,
    checkin: body.checkin || "",
    checkout: body.checkout || "",
    guests: body.guests ? Number(body.guests) : 1,
    budget: body.budget ? Number(body.budget) : null,
    notes: body.notes || "",
    createdAt: new Date().toISOString(),
  };
  const trips = await getJSON(env, "trips", []);
  trips.push(trip);
  await putJSON(env, "trips", trips);
  return json(trip);
}

async function updateTrip(request, env, id) {
  const body = await request.json();
  const trips = await getJSON(env, "trips", []);
  const idx = trips.findIndex((t) => t.id === id);
  if (idx === -1) return json({ error: "見つかりません" }, 404);
  const updated = { ...trips[idx] };
  if (body.title !== undefined) updated.title = body.title;
  if (body.destination !== undefined) updated.destination = body.destination;
  if (body.checkin !== undefined) updated.checkin = body.checkin;
  if (body.checkout !== undefined) updated.checkout = body.checkout;
  if (body.guests !== undefined) updated.guests = Number(body.guests);
  if (body.budget !== undefined) updated.budget = body.budget ? Number(body.budget) : null;
  if (body.notes !== undefined) updated.notes = body.notes;
  trips[idx] = updated;
  await putJSON(env, "trips", trips);
  return json(updated);
}

async function deleteTrip(env, id) {
  const trips = await getJSON(env, "trips", []);
  const next = trips.filter((t) => t.id !== id);
  await putJSON(env, "trips", next);
  await deleteKey(env, `hotels:${id}`);
  await deleteKey(env, `transport:${id}`);
  await deleteKey(env, `expenses:${id}`);
  return json({ ok: true });
}

// ----------------------------------------------------------- hotels ---
async function listHotels(url, env) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const hotels = await getJSON(env, `hotels:${tripId}`, []);
  return json(hotels);
}

async function createHotel(request, env) {
  const body = await request.json();
  if (!body.tripId || !body.name) return json({ error: "tripId and name are required" }, 400);
  const hotel = {
    id: crypto.randomUUID(),
    name: body.name,
    price: body.price ? Number(body.price) : null,
    rating: body.rating ? Number(body.rating) : 0,
    distance: body.distance || "",
    access: body.access || "",
    note: body.note || "",
    url: body.url || "",
    decided: false,
    createdAt: new Date().toISOString(),
  };
  const key = `hotels:${body.tripId}`;
  const hotels = await getJSON(env, key, []);
  hotels.push(hotel);
  await putJSON(env, key, hotels);
  return json(hotel);
}

async function updateHotel(request, env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const body = await request.json();
  const key = `hotels:${tripId}`;
  const hotels = await getJSON(env, key, []);
  const idx = hotels.findIndex((h) => h.id === id);
  if (idx === -1) return json({ error: "見つかりません" }, 404);
  const updated = { ...hotels[idx] };
  if (body.name !== undefined) updated.name = body.name;
  if (body.price !== undefined) updated.price = body.price ? Number(body.price) : null;
  if (body.rating !== undefined) updated.rating = body.rating ? Number(body.rating) : null;
  if (body.distance !== undefined) updated.distance = body.distance;
  if (body.access !== undefined) updated.access = body.access;
  if (body.note !== undefined) updated.note = body.note;
  if (body.url !== undefined) updated.url = body.url;
  if (body.decided !== undefined) updated.decided = !!body.decided;
  hotels[idx] = updated;
  await putJSON(env, key, hotels);
  return json(updated);
}

async function deleteHotel(env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const key = `hotels:${tripId}`;
  const hotels = await getJSON(env, key, []);
  const next = hotels.filter((h) => h.id !== id);
  await putJSON(env, key, next);
  return json({ ok: true });
}

// --------------------------------------------------------- transport ---
async function listTransport(url, env) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const items = await getJSON(env, `transport:${tripId}`, []);
  items.sort((a, b) => `${a.departDate}${a.departTime}`.localeCompare(`${b.departDate}${b.departTime}`));
  return json(items);
}

async function createTransport(request, env) {
  const body = await request.json();
  if (!body.tripId || !body.from || !body.to) {
    return json({ error: "tripId, from and to are required" }, 400);
  }
  const item = {
    id: crypto.randomUUID(),
    type: body.type || "その他",
    from: body.from,
    to: body.to,
    departDate: body.departDate || "",
    departTime: body.departTime || "",
    arriveDate: body.arriveDate || "",
    arriveTime: body.arriveTime || "",
    price: body.price ? Number(body.price) : null,
    note: body.note || "",
    url: body.url || "",
    decided: false,
    createdAt: new Date().toISOString(),
  };
  const key = `transport:${body.tripId}`;
  const items = await getJSON(env, key, []);
  items.push(item);
  await putJSON(env, key, items);
  return json(item);
}

async function updateTransport(request, env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const body = await request.json();
  const key = `transport:${tripId}`;
  const items = await getJSON(env, key, []);
  const idx = items.findIndex((t) => t.id === id);
  if (idx === -1) return json({ error: "見つかりません" }, 404);
  const updated = { ...items[idx] };
  if (body.type !== undefined) updated.type = body.type;
  if (body.from !== undefined) updated.from = body.from;
  if (body.to !== undefined) updated.to = body.to;
  if (body.departDate !== undefined) updated.departDate = body.departDate;
  if (body.departTime !== undefined) updated.departTime = body.departTime;
  if (body.arriveDate !== undefined) updated.arriveDate = body.arriveDate;
  if (body.arriveTime !== undefined) updated.arriveTime = body.arriveTime;
  if (body.price !== undefined) updated.price = body.price ? Number(body.price) : null;
  if (body.note !== undefined) updated.note = body.note;
  if (body.url !== undefined) updated.url = body.url;
  if (body.decided !== undefined) updated.decided = !!body.decided;
  items[idx] = updated;
  await putJSON(env, key, items);
  return json(updated);
}

async function deleteTransport(env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const key = `transport:${tripId}`;
  const items = await getJSON(env, key, []);
  const next = items.filter((t) => t.id !== id);
  await putJSON(env, key, next);
  return json({ ok: true });
}

// ---------------------------------------------------------- expenses ---
async function listExpenses(url, env) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const items = await getJSON(env, `expenses:${tripId}`, []);
  return json(items);
}

async function createExpense(request, env) {
  const body = await request.json();
  if (!body.tripId || !body.label || !body.amount) {
    return json({ error: "tripId, label and amount are required" }, 400);
  }
  const item = {
    id: crypto.randomUUID(),
    category: body.category || "その他",
    label: body.label,
    amount: Number(body.amount),
    note: body.note || "",
    createdAt: new Date().toISOString(),
  };
  const key = `expenses:${body.tripId}`;
  const items = await getJSON(env, key, []);
  items.push(item);
  await putJSON(env, key, items);
  return json(item);
}

async function updateExpense(request, env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const body = await request.json();
  const key = `expenses:${tripId}`;
  const items = await getJSON(env, key, []);
  const idx = items.findIndex((e) => e.id === id);
  if (idx === -1) return json({ error: "見つかりません" }, 404);
  const updated = { ...items[idx] };
  if (body.category !== undefined) updated.category = body.category;
  if (body.label !== undefined) updated.label = body.label;
  if (body.amount !== undefined) updated.amount = Number(body.amount);
  if (body.note !== undefined) updated.note = body.note;
  items[idx] = updated;
  await putJSON(env, key, items);
  return json(updated);
}

async function deleteExpense(env, url, id) {
  const tripId = url.searchParams.get("tripId");
  if (!tripId) return json({ error: "tripId is required" }, 400);
  const key = `expenses:${tripId}`;
  const items = await getJSON(env, key, []);
  const next = items.filter((e) => e.id !== id);
  await putJSON(env, key, next);
  return json({ ok: true });
}
