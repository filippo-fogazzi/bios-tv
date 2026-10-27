/* BIOS TV — launcher UI. Talks to Android through window.Android (see MainActivity.Bridge).
   Opened in a normal browser it falls back to a mock bridge, for previewing the design. */
(function () {
  "use strict";
  const J = window.Jarvis;
  const $ = id => document.getElementById(id);
  const stage = $("stage");

  /* ------------------------------------------------------------------ bridge */
  const PREVIEW = !window.Android;
  const B = window.Android || makeMock();

  const pending = {};
  let reqId = 0;
  function http(url) {
    return new Promise((resolve, reject) => {
      const id = "r" + (++reqId);
      pending[id] = { resolve, reject };
      B.httpGet(id, url);
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 15000);
    });
  }
  async function getJSON(url) { return JSON.parse(await http(url)); }

  const store = {
    get(k, d) { try { const v = localStorage.getItem("bios." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bios." + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  /* ------------------------------------------------------------------ state */
  const S = {
    data: null,
    allApps: [],
    apps: [],
    weather: null,
    focus: { row: "apps", idx: 0 },
    rowIdx: { top: 0, cards: 0, apps: 0 },
    moveMode: false,
    panel: null,
    lastGreetAt: store.get("lastGreetAt", 0),
    lastSpokenAt: store.get("lastSpokenAt", 0),
    woke: false,
    tints: {},
    typing: null
  };

  function loadData() {
    let d;
    try { d = JSON.parse(B.getData()); } catch (e) { d = {}; }
    d.profile = Object.assign({ name: "", city: "", voice: true, quietFrom: "", quietTo: "", theme: "landscape", wallpaper: "" }, d.profile);
    d.events = d.events || [];
    d.training = Object.assign({ target: 4, plan: {}, done: [] }, d.training);
    d.focus = d.focus || { title: "", note: "" };
    d.countdowns = d.countdowns || [];
    d.apps = Object.assign({ order: [], hidden: [] }, d.apps);
    S.data = d;
    return d;
  }
  function updateData(mutate) {
    const d = loadData();
    mutate(d);
    B.saveData(JSON.stringify(d));
    S.data = d;
  }

  /* ------------------------------------------------------------------ helpers */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseEvent(e) {
    if (!e || !e.date) return null;
    const [y, m, d] = e.date.split("-").map(Number);
    const [sh, sm] = (e.start || "00:00").split(":").map(Number);
    const start = new Date(y, m - 1, d, sh || 0, sm || 0);
    let end = null;
    if (e.end) { const [eh, em] = e.end.split(":").map(Number); end = new Date(y, m - 1, d, eh || 0, em || 0); if (end < start) end.setDate(end.getDate() + 1); }
    return { title: e.title || "Impegno", start, end, kind: e.kind || "" };
  }
  function upcomingEvents() {
    const now = new Date();
    return S.data.events.map(parseEvent).filter(e => e && (e.end || new Date(e.start.getTime() + 3600000)) > now)
      .sort((a, b) => a.start - b.start);
  }
  function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function trainingInfo() {
    const now = new Date(), t = S.data.training;
    const ws = weekStart(now);
    const done = (t.done || []);
    const doneWeek = done.filter(s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) >= ws; }).length;
    return {
      planToday: (t.plan && t.plan[String(now.getDay())] || "").trim(),
      doneToday: done.includes(ymd(now)),
      doneWeek, target: Number(t.target) || 0
    };
  }
  function countdowns() {
    return S.data.countdowns.filter(c => c && c.date).map(c => { const [y, m, d] = c.date.split("-").map(Number); return { title: c.title, date: new Date(y, m - 1, d) }; });
  }
  function relDay(d) {
    const now = new Date();
    if (J.sameDay(d, now)) return "oggi";
    const t = new Date(now); t.setDate(now.getDate() + 1);
    if (J.sameDay(d, t)) return "domani";
    return J.DAYS[d.getDay()].slice(0, 3) + " " + d.getDate();
  }
  function toMin(s) { if (!s) return null; const [h, m] = s.split(":").map(Number); return isNaN(h) ? null : h * 60 + (m || 0); }
  function inQuiet(now) {
    const a = toMin(S.data.profile.quietFrom), b = toMin(S.data.profile.quietTo);
    if (a == null || b == null || a === b) return false;
    const n = now.getHours() * 60 + now.getMinutes();
    return a < b ? (n >= a && n < b) : (n >= a || n < b);
  }
  function voiceAllowed() { return S.data.profile.voice !== false && !inQuiet(new Date()); }

  let toastT;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ------------------------------------------------------------------ clock + hero */
  function renderClock() {
    const now = new Date();
    $("clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const w = S.weather;
    const wx = isLandscape() && w ? `  ·  ${Math.round(w.temp)}° ${J.wmo(w.code).text}` : "";
    $("date").textContent = (J.longDate(now) + wx).toUpperCase();
    const h = now.getHours();
    document.body.classList.toggle("night", h < 5 || h >= 22);
    document.body.classList.toggle("morning", h >= 5 && h < 11);
  }

  function typeHTML(el, html) {
    if (S.typing) clearInterval(S.typing);
    const segs = html.split(/(<[^>]+>)/);
    const total = segs.reduce((n, s) => n + (s.startsWith("<") ? 0 : s.length), 0);
    let shown = 0;
    const frame = () => {
      let left = shown, out = "";
      for (const s of segs) {
        if (s.startsWith("<")) { out += s; continue; }
        if (left <= 0) break;
        out += s.slice(0, left); left -= s.length;
      }
      el.innerHTML = out + (shown < total ? '<span class="caret"></span>' : "");
    };
    S.typing = setInterval(() => { shown += 2; frame(); if (shown >= total) { clearInterval(S.typing); S.typing = null; } }, 26);
    frame();
  }

  function briefing(returning) {
    return J.compose({
      now: new Date(), name: S.data.profile.name, weather: S.weather,
      events: upcomingEvents(), training: trainingInfo(), focus: S.data.focus,
      countdowns: countdowns(), returning
    });
  }

  function greet(opts) {
    const now = Date.now();
    const returning = opts.keep ? !!S.returning
      : now - S.lastGreetAt < 4 * 3600000 && J.sameDay(new Date(S.lastGreetAt), new Date()) && !opts.fresh;
    S.returning = returning;
    S.greeted = true;
    const b = briefing(returning);
    $("h1").textContent = b.t1;
    $("h2").textContent = b.t2;
    if (opts.animate === false) $("jarvisText").innerHTML = b.html;
    else typeHTML($("jarvisText"), b.html);
    if (!opts.keep) { S.lastGreetAt = now; store.set("lastGreetAt", now); }
    if (opts.voice && voiceAllowed()) say(b.speech);
  }
  function refreshGreeting() {
    if (!S.greeted) return;
    if (S.typing) { setTimeout(refreshGreeting, 600); return; }
    greet({ voice: false, animate: false, keep: true });
  }
  function say(text) {
    B.speak(text);
    S.lastSpokenAt = Date.now(); store.set("lastSpokenAt", S.lastSpokenAt);
  }

  /* ------------------------------------------------------------------ theme + scene */
  function isLandscape() { return (S.data && S.data.profile.theme) !== "monolith"; }
  function applyTheme() {
    const land = isLandscape();
    document.body.classList.toggle("theme-landscape", land);
    document.body.classList.toggle("theme-monolith", !land);
    const url = (S.data.profile.wallpaper || "").trim();
    const img = $("wallpaper");
    if (land && /^https?:\/\//.test(url)) {
      if (img.getAttribute("src") !== url) {
        img.onload = () => document.body.classList.add("has-wallpaper");
        img.onerror = () => { document.body.classList.remove("has-wallpaper"); drawScene(); };
        img.src = url;
      }
    } else { document.body.classList.remove("has-wallpaper"); img.removeAttribute("src"); }
    drawScene();
  }
  function drawScene() {
    if (!isLandscape() || !window.Scene) return;
    const sun = S.weather && S.weather.sun;
    try { window.Scene.draw($("scene"), new Date(), sun); } catch (e) { /* keep last frame */ }
  }

  /* ------------------------------------------------------------------ weather */
  const ICONS = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    partly: '<path d="M8 4.5v1.4M3.6 8.9H5M4.9 5.8l1 1M12.1 5.8l-1 1"/><path d="M5.6 11.5a3.4 3.4 0 0 1 6-2.6"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8.5 19.5z"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
    rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    snow: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 19h.01M12 20.5h.01M16 19h.01"/>',
    storm: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>'
  };
  function weatherIcon(w) {
    let kind = J.wmo(w.code).kind;
    if (kind === "clear" && w.isDay === 0) kind = "moon";
    return `<svg viewBox="0 0 24 24">${ICONS[kind] || ICONS.cloud}</svg>`;
  }

  async function resolveGeo() {
    const city = (S.data.profile.city || "").trim();
    const g = S.data.geo;
    if (g && g.lat != null && (g.query || "") === city) return g;
    let geo = null;
    if (city) {
      const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=it&format=json&name=${encodeURIComponent(city)}`);
      if (r.results && r.results.length) geo = { query: city, name: r.results[0].name, lat: r.results[0].latitude, lon: r.results[0].longitude };
    } else {
      const r = await getJSON("https://ipwho.is/?fields=success,city,latitude,longitude");
      if (r.success) geo = { query: "", name: r.city, lat: r.latitude, lon: r.longitude };
    }
    if (geo) updateData(d => { d.geo = geo; });
    return geo;
  }

  async function loadWeather() {
    try {
      const geo = await resolveGeo();
      if (!geo) return;
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
        "&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=3";
      const r = await getJSON(u);
      const now = new Date();
      const key = `${ymd(now)}T${pad(now.getHours())}:00`;
      let i = r.hourly.time.indexOf(key); if (i < 0) i = 0;
      const next = r.hourly.precipitation_probability.slice(i, i + 4).filter(v => v != null);
      S.weather = {
        city: geo.name, temp: r.current.temperature_2m, code: r.current.weather_code, isDay: r.current.is_day,
        rainNext: next.length ? Math.max(...next) : 0,
        today: { code: r.daily.weather_code[0], min: r.daily.temperature_2m_min[0], max: r.daily.temperature_2m_max[0], rain: r.daily.precipitation_probability_max[0] || 0 },
        tomorrow: { code: r.daily.weather_code[1], min: r.daily.temperature_2m_min[1], max: r.daily.temperature_2m_max[1], rain: r.daily.precipitation_probability_max[1] || 0 },
        sun: r.daily.sunrise && r.daily.sunrise[0] ? { rise: new Date(r.daily.sunrise[0]), set: new Date(r.daily.sunset[0]) } : null,
        at: Date.now()
      };
      renderWeather(); renderCards(); renderClock(); drawScene(); refreshGreeting();
    } catch (e) { /* offline: keep last known weather */ }
  }
  function renderWeather() {
    const w = S.weather;
    if (!w) return;
    $("wIcon").innerHTML = weatherIcon(w);
    $("wTemp").textContent = Math.round(w.temp) + "°";
    $("wDesc").textContent = (w.city || J.wmo(w.code).text).toUpperCase();
    $("clockSub").textContent = J.wmo(w.code).text.toUpperCase() + " · " + Math.round(w.today.min) + "° / " + Math.round(w.today.max) + "°";
  }

  /* ------------------------------------------------------------------ cards */
  function renderCards() {
    const esc = J.esc;
    const ev = upcomingEvents()[0];
    const tr = trainingInfo();
    const cds = countdowns().map(c => ({ ...c, days: Math.ceil((c.date - new Date(new Date().toDateString())) / 86400000) })).filter(c => c.days >= 0).sort((a, b) => a.days - b.days);
    const w = S.weather;
    const dots = tr.target ? `<div class="dots">${Array.from({ length: Math.min(tr.target, 7) }, (_, i) => `<i class="${i < tr.doneWeek ? "on" : ""}"></i>`).join("")}</div>` : "";
    const focusSub = S.data.focus.note ? esc(S.data.focus.note)
      : cds.length ? (cds[0].days === 0 ? `Oggi: ${esc(cds[0].title)}` : `Tra ${cds[0].days} g · ${esc(cds[0].title)}`) : "Impostalo dal telefono";
    const cards = [
      { act: "agenda", k: "IL PROSSIMO IMPEGNO", v: ev ? esc(ev.title) : "LIBERO",
        s: ev ? `${J.hm(ev.start).padStart(5, "0")}${ev.end ? "–" + J.hm(ev.end).padStart(5, "0") : ""} · ${relDay(ev.start)}` : "Nessun impegno in arrivo" },
      { act: "training", k: "ALLENAMENTO · OGGI", v: tr.planToday ? esc(tr.planToday) : "RIPOSO", extra: dots +
          (tr.doneToday ? '<span class="badge mono ok">FATTO</span>' : ""),
        s: tr.doneToday ? `${tr.doneWeek} di ${tr.target} questa settimana` : tr.planToday ? "OK per segnarlo fatto" : "Recupero" },
      { act: "focus", k: "FOCUS", v: S.data.focus.title ? esc(S.data.focus.title) : "DA DEFINIRE", s: focusSub },
      { act: "weather", k: "METEO" + (w && w.city ? " · " + esc(w.city.toUpperCase()) : ""),
        v: w ? Math.round(w.temp) + "°" : "—",
        s: w ? `${J.wmo(w.code).text[0].toUpperCase() + J.wmo(w.code).text.slice(1)} · domani ${Math.round(w.tomorrow.max)}°` : "In attesa di connessione" }
    ];
    $("cards").innerHTML = cards.map((c, i) =>
      `<div class="card focusable" data-row="cards" data-idx="${i}" data-act="${c.act}">
        <div class="k mono">${c.k}</div><div class="v">${c.v}</div><div class="s">${c.s}</div>${c.extra || ""}</div>`).join("");
    applyFocus(false);
  }

  /* ------------------------------------------------------------------ apps */
  const PRIORITY = ["com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus",
    "com.spotify.tv.android", "com.apple.atve.androidtv.appletv", "com.dazn", "it.rainet.androidtv", "it.mediaset.infinitytv",
    "com.google.android.youtube.tvmusic", "com.plexapp.android", "org.xbmc.kodi"];
  function sortApps() {
    const { order, hidden } = S.data.apps;
    const rank = p => { const o = order.indexOf(p); if (o >= 0) return o; const q = PRIORITY.indexOf(p); return q >= 0 ? 1000 + q : 5000; };
    S.apps = S.allApps.filter(a => !hidden.includes(a.pkg))
      .sort((a, b) => rank(a.pkg) - rank(b.pkg) || a.label.localeCompare(b.label, "it"));
  }
  function renderApps() {
    sortApps();
    const box = $("apps");
    if (!S.apps.length) { box.innerHTML = '<div class="apps-empty">Caricamento app…</div>'; return; }
    box.innerHTML = S.apps.map((a, i) => {
      const art = a.banner ? `<div class="art"><img src="${a.banner}" alt=""></div>`
        : `<div class="art icon-only">${a.icon ? `<img src="${a.icon}" alt="">` : ""}<div class="nm">${J.esc(a.label)}</div></div>`;
      return `<div class="tile focusable" data-row="apps" data-idx="${i}" data-pkg="${a.pkg}">${art}<div class="name">${J.esc(a.label)}</div></div>`;
    }).join("");
    S.rowIdx.apps = Math.min(S.rowIdx.apps, S.apps.length - 1);
    if (S.focus.row === "apps") S.focus.idx = S.rowIdx.apps;
    applyFocus(false);
  }
  function tintFor(tile) {
    const pkg = tile.dataset.pkg;
    if (S.tints[pkg]) return S.tints[pkg];
    const img = tile.querySelector("img");
    if (!img || !img.complete || !img.naturalWidth) return null;
    try {
      const c = document.createElement("canvas"); c.width = c.height = 6;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, 6, 6);
      const px = x.getImageData(0, 0, 6, 6).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 40) continue; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      if (!n) return null;
      r /= n; g /= n; b /= n;
      const max = Math.max(r, g, b) || 1, k = Math.min(1.4, 170 / max);    // lift dark banners, cap bright ones
      return (S.tints[pkg] = `rgba(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}, .55)`);
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ focus */
  const ROWS = ["top", "cards", "apps"];
  function rowEls(row) { return Array.from(document.querySelectorAll(`.focusable[data-row="${row}"]`)); }
  function applyFocus(withTint = true) {
    document.querySelectorAll(".focused").forEach(e => e.classList.remove("focused"));
    if (S.panel) {
      const el = S.panel.items[S.panel.idx]; if (el) el.classList.add("focused");
      return;
    }
    const els = rowEls(S.focus.row);
    if (!els.length) return;
    S.focus.idx = Math.max(0, Math.min(S.focus.idx, els.length - 1));
    const el = els[S.focus.idx];
    el.classList.add("focused");
    el.classList.toggle("moving", S.moveMode);
    if (S.focus.row === "apps") {
      const step = 318, n = els.length, first = Math.max(0, Math.min(S.focus.idx - 4, n - 5));
      $("apps").style.transform = `translateX(${-first * step}px)`;
      if (withTint) { const t = tintFor(el); if (t) stage.style.setProperty("--tint", t); }
      $("appsHint").textContent = S.moveMode ? "← → PER SPOSTARE · OK PER CONFERMARE" : "";
    } else {
      $("appsHint").textContent = "";
      stage.style.setProperty("--tint", "rgba(110, 118, 96, .55)");
    }
  }
  function moveFocus(dir) {
    if (S.panel) {
      const n = S.panel.items.length;
      if (dir === "up") S.panel.idx = Math.max(0, S.panel.idx - 1);
      if (dir === "down") S.panel.idx = Math.min(n - 1, S.panel.idx + 1);
      applyFocus(); return;
    }
    if (S.moveMode) {
      if (dir === "left" || dir === "right") {
        const i = S.focus.idx, j = i + (dir === "left" ? -1 : 1);
        if (j < 0 || j >= S.apps.length) return;
        [S.apps[i], S.apps[j]] = [S.apps[j], S.apps[i]];
        S.data.apps.order = S.apps.map(a => a.pkg);
        S.focus.idx = S.rowIdx.apps = j;
        const box = $("apps"), tiles = rowEls("apps");
        if (dir === "left") box.insertBefore(tiles[i], tiles[j]); else box.insertBefore(tiles[j], tiles[i]);
        rowEls("apps").forEach((t, k) => t.dataset.idx = k);
        applyFocus(false);
      }
      return;
    }
    const r = ROWS.indexOf(S.focus.row);
    if (dir === "left") S.focus.idx--;
    else if (dir === "right") S.focus.idx++;
    else {
      const nr = r + (dir === "up" ? -1 : 1);
      if (nr < 0 || nr >= ROWS.length) return;
      // Spatial: land on the element closest horizontally to the one we leave.
      const from = rowEls(S.focus.row)[S.focus.idx];
      S.rowIdx[S.focus.row] = S.focus.idx;
      S.focus.row = ROWS[nr];
      const targets = rowEls(S.focus.row);
      if (from && targets.length) {
        const cx = r0 => (r0.left + r0.right) / 2, x = cx(from.getBoundingClientRect());
        let best = 0, bd = Infinity;
        targets.forEach((t, i) => { const d = Math.abs(cx(t.getBoundingClientRect()) - x); if (d < bd) { bd = d; best = i; } });
        S.focus.idx = best;
      } else S.focus.idx = S.rowIdx[S.focus.row];
    }
    S.rowIdx[S.focus.row] = S.focus.idx = Math.max(0, Math.min(S.focus.idx, rowEls(S.focus.row).length - 1));
    applyFocus();
  }

  /* ------------------------------------------------------------------ actions */
  function activate() {
    if (S.panel) { const el = S.panel.items[S.panel.idx]; if (el) panelAction(el.dataset.act); return; }
    if (S.moveMode) { endMove(); return; }
    const el = rowEls(S.focus.row)[S.focus.idx];
    if (!el) return;
    if (S.focus.row === "top") return openSettings();
    if (S.focus.row === "apps") { B.launch(el.dataset.pkg); return; }
    const act = el.dataset.act;
    if (act === "agenda") openAgenda();
    else if (act === "training") toggleTraining();
    else if (act === "focus") {
      const f = S.data.focus;
      say(f.title ? `Il focus di questa settimana è ${f.title}.${f.note ? " " + f.note + "." : ""}` : "Non hai ancora impostato un focus. Puoi farlo dal telefono.");
    } else if (act === "weather") { loadWeather(); say(J.weatherReport(S.weather)); }
  }
  function toggleTraining() {
    const today = ymd(new Date());
    let nowDone = false;
    updateData(d => {
      const set = new Set(d.training.done || []);
      if (set.has(today)) set.delete(today); else { set.add(today); nowDone = true; }
      const cutoff = ymd(new Date(Date.now() - 60 * 86400000));
      d.training.done = Array.from(set).filter(s => s >= cutoff).sort();
    });
    renderCards();
    const tr = trainingInfo();
    const msg = nowDone ? `Registrato.${tr.target ? ` ${tr.doneWeek} su ${tr.target} questa settimana.` : ""}${tr.target && tr.doneWeek >= tr.target ? " Obiettivo settimanale raggiunto." : ""}` : "Annullato.";
    toast(msg.toUpperCase());
    if (voiceAllowed()) say(msg);
  }
  function startMove() {
    if (S.focus.row !== "apps" || S.panel) return;
    S.moveMode = true; applyFocus(false);
  }
  function endMove() {
    S.moveMode = false;
    const order = S.apps.map(a => a.pkg);
    updateData(d => { d.apps.order = order; });
    applyFocus(false); toast("ORDINE SALVATO");
  }

  /* ------------------------------------------------------------------ panels */
  function openPanel(html) {
    const p = $("panel");
    p.innerHTML = html;
    S.panel = { items: Array.from(p.querySelectorAll(".pbtn")), idx: 0 };
    document.body.classList.add("panel-open");
    applyFocus();
  }
  function closePanel() {
    S.panel = null;
    document.body.classList.remove("panel-open");
    applyFocus();
  }
  function openSettings() {
    let info = {};
    try { info = JSON.parse(B.getServerInfo()); } catch (e) { /* no server */ }
    const home = B.isHomeWatcherOn();
    openPanel(`
      <div class="k mono">BIOS / SISTEMA</div>
      <h2>IMPOSTAZIONI<span class="muted">DI CASA.</span></h2>
      <div class="info">
        <div class="k mono">GESTISCI DAL TELEFONO · STESSA RETE WI-FI</div>
        <div class="row"><div class="big">${J.esc(info.url || "Rete non disponibile")}</div><div class="pin">${J.esc(info.pin || "")}</div></div>
      </div>
      <div class="list">
        <button class="pbtn" data-act="voice">Voce di benvenuto <span class="st">${S.data.profile.voice !== false ? "ATTIVA" : "SPENTA"}</span></button>
        <button class="pbtn" data-act="theme">Tema <span class="st">${isLandscape() ? "PAESAGGIO" : "MONOLITH"}</span></button>
        <button class="pbtn" data-act="test">Ascolta il briefing <span class="st">OK</span></button>
        <button class="pbtn" data-act="home">Tasto Home apre BIOS <span class="st">${home ? "ATTIVO" : "DA ATTIVARE"}</span></button>
        <button class="pbtn" data-act="refresh">Aggiorna meteo e app <span class="st">OK</span></button>
        <button class="pbtn" data-act="stock">Apri Home di Google TV <span class="st">10 MIN</span></button>
        <button class="pbtn" data-act="system">Impostazioni TV <span class="st">OK</span></button>
      </div>`);
  }
  function openAgenda() {
    const evs = upcomingEvents().filter(e => e.start - Date.now() < 7 * 86400000);
    let html = "", last = "";
    for (const e of evs) {
      const day = J.longDate(e.start).toUpperCase();
      if (day !== last) { html += `<div class="day mono">${day}</div>`; last = day; }
      html += `<div class="ev"><div class="t">${pad(e.start.getHours())}:${pad(e.start.getMinutes())}${e.end ? "–" + pad(e.end.getHours()) + ":" + pad(e.end.getMinutes()) : ""}</div><div>${J.esc(e.title)}</div></div>`;
    }
    openPanel(`
      <div class="k mono">BIOS / AGENDA</div>
      <h2>I PROSSIMI<span class="muted">7 GIORNI.</span></h2>
      <div class="list"><button class="pbtn" data-act="readAgenda">Leggi ad alta voce <span class="st">OK</span></button></div>
      <div class="agenda">${html || '<div class="empty">Niente in programma. Aggiungi impegni dal telefono.</div>'}</div>`);
  }
  function panelAction(act) {
    if (act === "voice") { updateData(d => { d.profile.voice = d.profile.voice === false; }); openSettings(); S.panel.idx = 0; applyFocus(); }
    else if (act === "theme") { updateData(d => { d.profile.theme = isLandscape() ? "monolith" : "landscape"; }); applyTheme(); renderClock(); openSettings(); S.panel.idx = 1; applyFocus(); }
    else if (act === "test") { const b = briefing(false); B.speak(b.speech); }
    else if (act === "home") B.openAccessibility();
    else if (act === "refresh") { B.requestApps(true); loadWeather(); toast("AGGIORNAMENTO IN CORSO"); }
    else if (act === "stock") B.openStockHome();
    else if (act === "system") B.openSystemSettings();
    else if (act === "readAgenda") {
      const evs = upcomingEvents().filter(e => e.start - Date.now() < 7 * 86400000);
      if (!evs.length) B.speak("Nei prossimi sette giorni non hai impegni.");
      else B.speak(evs.slice(0, 6).map(e => { const d = relDay(e.start); return `${d[0].toUpperCase() + d.slice(1)} alle ${J.sayHm(e.start)}, ${e.title}.`; }).join(" "));
    }
  }

  /* ------------------------------------------------------------------ lifecycle */
  function fit() {
    // innerWidth on a TV WebView grows to the 1920px stage itself; clientWidth is the real screen.
    const de = document.documentElement;
    const W = de.clientWidth || window.innerWidth, H = de.clientHeight || window.innerHeight;
    const s = Math.min(W / 1920, H / 1080);
    stage.style.transform = `scale(${s})`;
    stage.style.left = (W - 1920 * s) / 2 + "px";
    stage.style.top = (H - 1080 * s) / 2 + "px";
  }

  const app = window.app = {
    key(k) {
      if (k === "up" || k === "down" || k === "left" || k === "right") moveFocus(k);
      else if (k === "ok") activate();
      else if (k === "hold") startMove();
      else if (k === "menu") { if (!S.panel) openSettings(); }
      else if (k === "back") {
        if (S.moveMode) endMove();
        else if (S.panel) closePanel();
        else { S.focus = { row: "apps", idx: 0 }; S.rowIdx.apps = 0; applyFocus(); }
      }
    },
    _http(id, ok, body) { const p = pending[id]; if (!p) return; delete pending[id]; ok ? p.resolve(body) : p.reject(new Error(body)); },
    _apps(list) { S.allApps = Array.isArray(list) ? list : []; renderApps(); },
    refreshApps() { B.requestApps(false); },
    ttsState(s) { $("orb").classList.toggle("speaking", s === "start"); },
    onData() {
      loadData(); applyTheme(); renderCards(); renderApps(); greet({ voice: false, animate: false, keep: true });
      if ((S.data.geo && S.data.geo.query || "") !== (S.data.profile.city || "").trim()) loadWeather();
      toast("AGGIORNATO DAL TELEFONO");
    },
    onWake() { S.woke = true; setTimeout(() => { if (S.woke) app.onResume(); }, 1500); },
    onResume() {
      if (S.panel) closePanel();
      if (S.moveMode) endMove();
      renderClock();
      const since = Date.now() - S.lastSpokenAt;
      if (S.woke || since > 3 * 3600000) greet({ voice: true });
      else if (Date.now() - S.lastGreetAt > 10 * 60000) greet({ voice: false });
      S.woke = false;
      if (!S.weather || Date.now() - S.weather.at > 20 * 60000) loadWeather();
    }
  };

  function boot() {
    fit(); window.addEventListener("resize", fit);
    loadData();
    applyTheme();
    renderClock(); renderCards(); renderApps();
    B.requestApps(false);
    // Wait briefly for the weather so the first briefing (and the voice) can mention it.
    Promise.race([loadWeather(), new Promise(r => setTimeout(r, 3500))])
      .then(() => greet({ voice: Date.now() - S.lastSpokenAt > 20 * 60000, fresh: true }));
    setInterval(renderClock, 5000);
    setInterval(() => { renderCards(); if (!S.typing) greet({ voice: false, animate: false, keep: true }); }, 60000);
    setInterval(loadWeather, 20 * 60000);
    setInterval(drawScene, 10 * 60000);
    if (PREVIEW) {
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok", Escape: "back", Backspace: "back", h: "hold", m: "menu" };
      window.addEventListener("keydown", e => { const k = map[e.key]; if (k) { e.preventDefault(); app.key(k); } });
    }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else boot();

  /* ------------------------------------------------------------------ preview mock */
  function makeMock() {
    const d = new Date(), t = new Date(d); t.setDate(d.getDate() + 1);
    const dd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const in12 = new Date(d); in12.setDate(d.getDate() + 12);
    const demo = {
      version: 1, profile: { name: "Filippo", city: "", voice: true, quietFrom: "", quietTo: "" }, geo: null,
      events: [{ id: "1", date: dd(t), start: "09:00", end: "11:00", title: "Biologia" }, { id: "2", date: dd(t), start: "15:00", end: "19:00", title: "Turno lavoro" }],
      training: { target: 4, plan: { 1: "Push", 3: "Pull", 5: "Legs", 6: "Upper", [d.getDay()]: "Legs" }, done: [] },
      focus: { title: "NODARA · MVP", note: "Ruota natale interattiva" },
      countdowns: [{ title: "Certificazione inglese", date: dd(in12) }],
      apps: { order: [], hidden: [] }
    };
    const names = [["com.google.android.youtube.tv", "YouTube", "#2a1414", "#5a1d1d"], ["com.netflix.ninja", "Netflix", "#140c0c", "#3b1010"],
      ["com.spotify.tv.android", "Spotify", "#0d1a12", "#15402a"], ["com.disney.disneyplus", "Disney+", "#0b1230", "#1b2c6b"],
      ["com.amazon.amazonvideo.livingroom", "Prime Video", "#0c1820", "#14394d"], ["it.rainet.androidtv", "RaiPlay", "#0b1626", "#163a66"],
      ["com.dazn", "DAZN", "#121212", "#2a2a24"], ["com.android.vending", "Play Store", "#16181a", "#26302a"], ["com.android.tv.settings", "Impostazioni", "#16181a", "#2a2c2e"]];
    function art(label, a, b) {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const x = c.getContext("2d"); const g = x.createLinearGradient(0, 0, 320, 180); g.addColorStop(0, b); g.addColorStop(1, a);
      x.fillStyle = g; x.fillRect(0, 0, 320, 180);
      x.fillStyle = "rgba(236,231,222,.92)"; x.font = "500 34px Inter"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 160, 92);
      return c.toDataURL("image/png");
    }
    return {
      getData() { try { return localStorage.getItem("mock.data") || JSON.stringify(demo); } catch (e) { return JSON.stringify(demo); } },
      saveData(j) { try { localStorage.setItem("mock.data", j); } catch (e) { /* ignore */ } },
      requestApps() { document.fonts.load("500 34px Inter").then(() => app._apps(names.map(([pkg, label, a, b]) => ({ pkg, label, banner: art(label, a, b) })))); },
      launch(p) { toast("APRO " + p); },
      speak(t) { console.log("SPEAK:", t); app.ttsState("start"); setTimeout(() => app.ttsState("done"), Math.min(9000, t.length * 60)); },
      stopSpeak() {},
      httpGet(id, url) {
        if (url.includes("ipwho")) return setTimeout(() => app._http(id, true, JSON.stringify({ success: true, city: "Parma", latitude: 44.8, longitude: 10.33 })), 20);
        if (url.includes("forecast")) {
          const h = []; const p = []; const base = new Date(); base.setMinutes(0, 0, 0);
          for (let i = -2; i < 30; i++) { const x = new Date(base.getTime() + i * 3600000); h.push(`${dd(x)}T${String(x.getHours()).padStart(2, "0")}:00`); p.push(i < 6 ? 10 : 70); }
          return setTimeout(() => app._http(id, true, JSON.stringify({ current: { temperature_2m: 12.4, weather_code: 0, is_day: 0 }, hourly: { time: h, precipitation_probability: p },
            daily: { weather_code: [0, 61, 3], temperature_2m_max: [17, 15, 16], temperature_2m_min: [8, 10, 9], precipitation_probability_max: [5, 80, 20] } })), 20);
        }
        fetch(url).then(r => r.text()).then(b => app._http(id, true, b)).catch(e => app._http(id, false, String(e)));
      },
      getServerInfo() { return JSON.stringify({ url: "http://192.168.1.42:8765", pin: "4817" }); },
      openAccessibility() { toast("APRO ACCESSIBILITÀ"); }, openSystemSettings() {}, openStockHome() {},
      isHomeWatcherOn() { return false; }
    };
  }
})();
