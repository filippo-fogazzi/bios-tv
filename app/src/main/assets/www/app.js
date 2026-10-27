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
  function httpPost(url, headers, body) {
    return new Promise((resolve, reject) => {
      const id = "p" + (++reqId);
      pending[id] = { resolve, reject };
      B.httpPost(id, url, JSON.stringify(headers), body);
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 15000);
    });
  }

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
    d.profile = Object.assign({ name: "", city: "", voice: true, quietFrom: "", quietTo: "", theme: "landscape", wallpaper: "", scene: "auto", clockStyle: "apple", saverMin: 3 }, d.profile);
    d.events = d.events || [];
    d.training = Object.assign({ target: 4, plan: {}, done: [] }, d.training);
    d.focus = d.focus || { title: "", note: "" };
    d.countdowns = d.countdowns || [];
    d.apps = Object.assign({ order: [], hidden: [] }, d.apps);
    d.bios = Object.assign({ token: "" }, d.bios);
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
  /* All-caps calendar titles ("CHIMICA E PROPEDEUTICA BIOCHIMICA") read better in sentence case. */
  function niceTitle(t) {
    t = String(t || "").trim();
    if (t.length < 4 || t !== t.toUpperCase() || !/[A-ZÀ-Ý]/.test(t)) return t;
    const low = t.toLowerCase();
    return low.charAt(0).toUpperCase() + low.slice(1);
  }
  function upcomingEvents() {
    const now = new Date();
    const local = S.data.events;
    const bios = S.bios ? S.bios.events || [] : [];
    const seen = new Set();
    return local.concat(bios).map(parseEvent).filter(e => {
      if (!e || (e.end || new Date(e.start.getTime() + 3600000)) <= now) return false;
      const k = e.start.getTime() + "|" + e.title.toLowerCase();                 // same event in both sources
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).map(e => ({ ...e, title: niceTitle(e.title) })).sort((a, b) => a.start - b.start);
  }
  function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function trainingInfo() {
    const now = new Date(), t = S.data.training;
    const ws = weekStart(now);
    const planToday = (t.plan && t.plan[String(now.getDay())] || "").trim();
    const inWeek = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d) >= ws; };
    if (S.bios) {
      // Linked: completed workouts come from BIOS (synced from Motra), not from the TV.
      const days = new Set((S.bios.workouts || []).map(w => String(w.date).slice(0, 10)));
      const next = String(S.bios.nextRoutine || "").replace(/^[A-Z]\s*[—-]\s*/, "").split(":")[0].trim();
      return {
        linked: true, planToday, next,
        doneToday: days.has(ymd(now)),
        doneWeek: Array.from(days).filter(inWeek).length,
        target: Number(S.bios.trainingTarget) || Number(t.target) || 0
      };
    }
    const done = (t.done || []);
    return {
      planToday, doneToday: done.includes(ymd(now)),
      doneWeek: done.filter(inWeek).length, target: Number(t.target) || 0
    };
  }
  function countdowns() {
    const exams = S.bios ? (S.bios.exams || []).map(x => ({ title: x.title, date: x.date })) : [];
    return S.data.countdowns.concat(exams).filter(c => c && c.date).map(c => { const [y, m, d] = String(c.date).slice(0, 10).split("-").map(Number); return { title: c.title, date: new Date(y, m - 1, d) }; });
  }

  /* ------------------------------------------------------------------ BIOS sync (read-only) */
  // Public project URL and publishable key: safe to ship; access is gated by the per-TV code.
  const BIOS_URL = "https://cismejelmqysdmpjxozo.supabase.co/rest/v1/rpc/bios_tv_snapshot";
  const BIOS_KEY = "sb_publishable_cNTXYcp1vO-Et2kk7gi3bQ_HLaJ0ptK";
  S.bios = store.get("biosSnap", null);
  function biosToken() { return ((S.data.bios || {}).token || "").trim(); }
  async function loadBios() {
    const token = biosToken();
    if (!token) { S.bios = null; S.biosState = "off"; return; }
    try {
      const body = await httpPost(BIOS_URL, { apikey: BIOS_KEY, "Content-Type": "application/json" }, JSON.stringify({ p_token: token }));
      const snap = JSON.parse(body);
      if (!snap || !Array.isArray(snap.events)) throw new Error("bad");
      S.bios = snap; S.biosState = "ok"; S.biosAt = Date.now();
      store.set("biosSnap", snap);
    } catch (e) {
      S.biosState = /invalid token|28000|401|403/.test(String(e && e.message)) ? "bad" : "offline";
      if (S.biosState === "bad") { S.bios = null; store.set("biosSnap", null); }
    }
    renderCards();
    refreshGreeting();
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
    const apple = S.data.profile.clockStyle !== "thin";
    const c = $("clock");
    c.classList.toggle("apple", apple);
    const t = `${apple ? now.getHours() : pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (c.textContent !== t) { c.textContent = t; if (S.saver) renderSaver(); }  // repaint only when the minute changes
    const w = S.weather;
    const wx = isLandscape() && w ? `  ·  ${Math.round(w.temp)}° ${J.wmo(w.code).text}` : "";
    const d = (J.longDate(now) + wx).toUpperCase();
    if ($("date").textContent !== d) $("date").textContent = d;
    const h = now.getHours();
    document.body.classList.toggle("night", h < 5 || h >= 22);
    document.body.classList.toggle("morning", h >= 5 && h < 11);
  }

  function typeHTML(el, html) {
    el.classList.remove("in");
    void el.offsetWidth;                                               // restart the fade
    el.innerHTML = html;
    el.classList.add("in");
  }

  function briefing(returning) {
    return J.compose({
      now: new Date(), name: S.data.profile.name || (S.bios && String(S.bios.profileName || "").split(" ")[0]) || "", weather: S.weather,
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
    greet({ voice: false, animate: false, keep: true });
  }
  const HELLOS = [
    n => `Bentornato, ${n}.`, n => `Eccoti, ${n}.`, n => `Ciao ${n}. Tutto pronto.`,
    n => `Rieccoti, ${n}. Sistemi in linea.`, n => `Bentornato. A disposizione, ${n}.`, n => `Ciao ${n}.`
  ];
  function shortHello() {
    const name = (S.data.profile.name || (S.bios && String(S.bios.profileName || "").split(" ")[0]) || "").trim() || "Filippo";
    const h = new Date().getHours();
    let line = h >= 23 || h < 5 ? `Ciao ${name}. È tardi, ricordatelo.` : HELLOS[Math.floor(Math.random() * HELLOS.length)](name);
    const soon = upcomingEvents().find(e => e.start > Date.now() && e.start - Date.now() < 2 * 3600000);
    if (soon) line += ` ${soon.title} tra ${J.minutesWord(Math.round((soon.start - Date.now()) / 60000))}.`;
    return line;
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
        img.crossOrigin = "anonymous";
        img.onload = () => { document.body.classList.add("has-wallpaper"); drawScene(); };
        img.onerror = () => { document.body.classList.remove("has-wallpaper"); drawScene(); };
        img.src = url;
      }
    } else { document.body.classList.remove("has-wallpaper"); img.removeAttribute("src"); }
    drawScene();
  }
  function drawScene() {
    if (!isLandscape() || !window.Scene) return;
    const sun = S.weather && S.weather.sun;
    try {
      const P = window.Scene.draw($("scene"), new Date(), sun, S.data.profile.scene);
      S.sceneName = P.scene;
    } catch (e) { /* keep last frame */ }
    clearTimeout(S.frostT);
    S.frostT = setTimeout(() => {
      try { S.frost = document.body.classList.contains("has-wallpaper") ? frostFromImage() : window.Scene.frosted($("scene")); }
      catch (e) { S.frost = null; }
      applyFrost();
    }, 400);
  }
  function frostFromImage() {
    try {
      const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
      const img = $("wallpaper"), x = c.getContext("2d");
      const k = Math.max(1920 / img.naturalWidth, 1080 / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      x.drawImage(img, (1920 - w) / 2, (1080 - h) / 2, w, h);
      return window.Scene.frosted(c);                                  // throws if the host blocks CORS
    } catch (e) { return null; }
  }
  /* Paint each glass element with its own slice of the pre-blurred background. */
  function stagePos(el) {
    let x = 0, y = 0;
    while (el && el !== stage) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return [x, y];
  }
  function applyFrost() {
    const on = isLandscape() && !!S.frost;
    document.body.classList.toggle("frost", on);
    document.querySelectorAll(".card, .icon-btn").forEach(el => {
      if (!on) { el.style.backgroundImage = ""; el.style.backgroundPosition = ""; return; }
      const [x, y] = stagePos(el);
      el.style.backgroundImage = `linear-gradient(rgba(14,16,18,.30), rgba(14,16,18,.30)), url(${S.frost})`;
      el.style.backgroundPosition = `0 0, ${-x - 1}px ${-y - 1}px`;
    });
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
      store.set("weather", S.weather);
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
    const stToday = studyToday();
    const focusSub = stToday.n ? `${stToday.n} ${stToday.n === 1 ? "sessione" : "sessioni"} oggi · ${stToday.min} min`
      : S.data.focus.note ? esc(S.data.focus.note)
      : cds.length ? (cds[0].days === 0 ? `Oggi: ${esc(cds[0].title)}` : `Tra ${cds[0].days} g · ${esc(cds[0].title)}`) : "Impostalo dal telefono";
    const cards = [
      { act: "agenda", k: "IL PROSSIMO IMPEGNO", v: ev ? esc(ev.title) : "LIBERO",
        s: ev ? `${J.hm(ev.start).padStart(5, "0")}${ev.end ? "–" + J.hm(ev.end).padStart(5, "0") : ""} · ${relDay(ev.start)}` : "Nessun impegno in arrivo" },
      tr.linked
        ? { act: "training", k: tr.doneToday ? "ALLENAMENTO · OGGI" : "PROSSIMA SCHEDA",
            v: esc(tr.planToday || tr.next || (tr.doneToday ? "FATTO" : "—")),
            extra: dots + (tr.doneToday ? '<span class="badge mono ok">FATTO</span>' : ""),
            s: `${tr.doneWeek} di ${tr.target} questa settimana` }
        : { act: "training", k: "ALLENAMENTO · OGGI", v: tr.planToday ? esc(tr.planToday) : "RIPOSO", extra: dots +
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
    applyFrost();
    applyFocus(false);
  }

  /* ------------------------------------------------------------------ apps */
  const PRIORITY = ["com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus",
    "com.spotify.tv.android", "com.apple.atve.androidtv.appletv", "com.dazn", "it.rainet.androidtv", "it.mediaset.infinitytv",
    "com.google.android.youtube.tvmusic", "com.plexapp.android", "org.xbmc.kodi"];
  function sortApps() {
    const { order, hidden } = S.data.apps;
    const rank = p => { const o = order.indexOf(p); if (o >= 0) return o; if (p.startsWith("input:")) return 900; const q = PRIORITY.indexOf(p); return q >= 0 ? 1000 + q : 5000; };
    S.apps = S.allApps.filter(a => !hidden.includes(a.pkg))
      .sort((a, b) => rank(a.pkg) - rank(b.pkg) || a.label.localeCompare(b.label, "it"));
  }
  function renderApps() {
    sortApps();
    const box = $("apps");
    if (!S.apps.length) { box.innerHTML = '<div class="apps-empty">Caricamento app…</div>'; return; }
    box.innerHTML = S.apps.map((a, i) => {
      const ps = a.input && /ps\s?5|playstation/i.test(a.label);
      const art = ps ? `<div class="art input ps">${inputIcon("ps5")}<div class="nm">PS5</div><div class="sub">CONSOLE · HDMI</div></div>`
        : a.input ? `<div class="art input">${inputIcon(a.label)}<div class="nm">${J.esc(a.label)}</div></div>`
        : a.banner ? `<div class="art"><img src="${a.banner}" alt=""></div>`
        : `<div class="art icon-only">${a.icon ? `<img src="${a.icon}" alt="">` : ""}<div class="nm">${J.esc(a.label)}</div></div>`;
      return `<div class="tile focusable" data-row="apps" data-idx="${i}" data-pkg="${a.pkg}"><div class="shade"></div>${art}<div class="name">${J.esc(a.label)}</div></div>`;
    }).join("");
    S.rowIdx.apps = Math.min(S.rowIdx.apps, S.apps.length - 1);
    if (S.focus.row === "apps") S.focus.idx = S.rowIdx.apps;
    applyFocus(false);
  }
  function inputIcon(label) {
    const game = /ps\s?[345]|playstation|xbox|switch|console|gioc/i.test(label);
    return game
      ? '<svg viewBox="0 0 64 64"><path d="M20 22h24a12 12 0 0 1 11.7 9.4l2.9 13.2a5.5 5.5 0 0 1-9.6 4.6L43 42H21l-6 7.2a5.5 5.5 0 0 1-9.6-4.6l2.9-13.2A12 12 0 0 1 20 22z"/><path d="M21 30v8M17 34h8"/><circle cx="43" cy="31" r="1.6"/><circle cx="47" cy="35" r="1.6"/></svg>'
      : '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="30" rx="4"/><path d="M24 52h16M32 44v8"/></svg>';
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

  /* App colour glow: paint the hidden layer, then cross-fade (opacity only, no repaint while animating). */
  let tintCur = null, tintFront = "tintA";
  function setTint(color) {
    if (color === tintCur) return;
    tintCur = color;
    const front = $(tintFront), back = $(tintFront === "tintA" ? "tintB" : "tintA");
    if (color) {
      back.style.background = `radial-gradient(ellipse at center, ${color} 0%, transparent 64%)`;
      back.classList.add("on"); front.classList.remove("on");
      tintFront = back.id;
    } else { front.classList.remove("on"); back.classList.remove("on"); }
  }

  /* ------------------------------------------------------------------ focus */
  const ROWS = ["top", "cards", "apps"];
  function rowEls(row) { return Array.from(document.querySelectorAll(`.focusable[data-row="${row}"]`)); }
  function applyFocus(withTint = true) {
    document.querySelectorAll(".focused").forEach(e => e.classList.remove("focused"));
    if (S.panel) {
      const el = S.panel.items[S.panel.idx];
      if (el) {
        el.classList.add("focused");
        // Scroll only the panel (scrollIntoView would also scroll the stage itself).
        const p = $("panel"), top = el.offsetTop, bottom = top + el.offsetHeight;
        if (top < p.scrollTop + 40) p.scrollTop = top - 40;
        else if (bottom > p.scrollTop + p.clientHeight - 40) p.scrollTop = bottom - p.clientHeight + 40;
      }
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
      if (withTint) setTint(tintFor(el));
      $("appsHint").textContent = S.moveMode ? "← → PER SPOSTARE · OK PER CONFERMARE"
        : S.pickMode ? "SCEGLI L'APP DA SPOSTARE · OK PER PRENDERLA" : "TIENI PREMUTO OK PER SPOSTARE";
    } else {
      $("appsHint").textContent = "";
      setTint(null);
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
      S.pickMode = false;
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
    if (S.focus.row === "apps") {
      if (S.pickMode) { S.pickMode = false; startMove(); return; }
      B.launch(el.dataset.pkg); return;
    }
    const act = el.dataset.act;
    if (act === "agenda") openAgenda();
    else if (act === "training") {
      const tr = trainingInfo();
      if (!tr.linked) toggleTraining();
      else say(`${tr.doneToday ? "Oggi ti sei già allenato. " : ""}Questa settimana ${tr.doneWeek} ${tr.doneWeek === 1 ? "allenamento" : "allenamenti"} su ${tr.target}.${tr.next ? ` Prossima scheda: ${tr.next}.` : ""}`);
    }
    else if (act === "focus") openStudyPicker(); else if (act === "weather") { loadWeather(); say(J.weatherReport(S.weather)); }
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
    stage.scrollLeft = 0; stage.scrollTop = 0;
    document.body.classList.remove("panel-open");
    applyFocus();
  }
  const SCENE_NAMES = { auto: "OGNI GIORNO", mountains: "MONTAGNE", dunes: "DUNE", lake: "LAGO", hills: "COLLINE", waves: "ONDE" };
  function sceneLabel() {
    const k = S.data.profile.scene || "auto";
    return k === "auto" && S.sceneName ? `AUTO · ${SCENE_NAMES[S.sceneName]}` : SCENE_NAMES[k] || "OGNI GIORNO";
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
        <button class="pbtn" data-act="bios">BIOS <span class="st">${{ ok: "COLLEGATO", bad: "CODICE ERRATO", offline: "NON RAGGIUNGIBILE", off: "DA COLLEGARE" }[S.biosState || (biosToken() ? "offline" : "off")]}</span></button>
        <button class="pbtn" data-act="voice">Voce di benvenuto <span class="st">${S.data.profile.voice !== false ? "ATTIVA" : "SPENTA"}</span></button>
        <button class="pbtn" data-act="theme">Tema <span class="st">${isLandscape() ? "PAESAGGIO" : "MONOLITH"}</span></button>
        <button class="pbtn" data-act="scene">Sfondo <span class="st">${sceneLabel()}</span></button>
        <button class="pbtn" data-act="clock">Orologio <span class="st">${S.data.profile.clockStyle === "thin" ? "SOTTILE" : "APPLE"}</span></button>
        <button class="pbtn" data-act="saver">Salvaschermo <span class="st">${saverMinutes() ? "DOPO " + saverMinutes() + " MIN" : "SPENTO"}</span></button>
        <button class="pbtn" data-act="test">Ascolta il briefing <span class="st">OK</span></button>
        <button class="pbtn" data-act="home">Tasto Home apre BIOS <span class="st">${home ? "ATTIVO" : "DA ATTIVARE"}</span></button>
        <button class="pbtn" data-act="reorder">Riordina le app <span class="st">OK</span></button>
        <button class="pbtn" data-act="update">${S.update ? "Installa la nuova versione" : "Cerca aggiornamenti"} <span class="st">${S.update ? "BUILD " + S.update : "BUILD " + (B.currentBuild ? B.currentBuild() : "—")}</span></button>
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
    if (act === "voice") { const i = S.panel.idx; updateData(d => { d.profile.voice = d.profile.voice === false; }); openSettings(); S.panel.idx = i; applyFocus(); }
    else if (act === "theme") { updateData(d => { d.profile.theme = isLandscape() ? "monolith" : "landscape"; }); applyTheme(); renderClock(); const i = S.panel.idx; openSettings(); S.panel.idx = i; applyFocus(); }
    else if (act === "later") closePanel();
    else if (act === "reorder") {
      closePanel();
      S.focus = { row: "apps", idx: 0 }; S.rowIdx.apps = 0;
      S.pickMode = true; applyFocus(false);
    }
    else if (act.startsWith("study:")) { const [, m, b] = act.split(":"); startStudy(Number(m), Number(b)); }
    else if (act === "readFocus") {
      const f = S.data.focus;
      B.speak(f.title ? `Il focus di questa settimana è ${f.title}.${f.note ? " " + f.note + "." : ""}` : "Non hai ancora impostato un focus. Puoi farlo dal telefono.");
    }
    else if (act === "saver") {
      const i = S.panel.idx, steps = [3, 5, 10, 0];
      updateData(d => { d.profile.saverMin = steps[(steps.indexOf(Number(d.profile.saverMin)) + 1) % steps.length]; });
      resetIdle(); openSettings(); S.panel.idx = i; applyFocus();
    }
    else if (act === "bios") { loadBios().then(() => { const i = S.panel ? S.panel.idx : 0; openSettings(); S.panel.idx = i; applyFocus(); }); toast(biosToken() ? "SINCRONIZZAZIONE…" : "INSERISCI IL CODICE DAL TELEFONO"); }
    else if (act === "scene" || act === "clock") {
      const idx = S.panel.idx;
      updateData(d => {
        if (act === "clock") d.profile.clockStyle = d.profile.clockStyle === "thin" ? "apple" : "thin";
        else { const all = ["auto"].concat(window.Scene.SCENES); d.profile.scene = all[(all.indexOf(d.profile.scene || "auto") + 1) % all.length]; }
      });
      if (act === "scene") drawScene(); else renderClock();
      openSettings(); S.panel.idx = idx; applyFocus();
    }
    else if (act === "test") { const b = briefing(false); B.speak(b.speech); }
    else if (act === "home") {
      const ok = B.openAccessibility();
      if (!ok) toast("IMPOSTAZIONI → SISTEMA → ACCESSIBILITÀ → BIOS TV · TASTO HOME");
    }
    else if (act === "update") {
      if (S.update) B.installUpdate(); else { B.checkUpdate(); toast("CONTROLLO AGGIORNAMENTI…"); }
    }
    else if (act === "refresh") { B.requestApps(true); loadWeather(); toast("AGGIORNAMENTO IN CORSO"); }
    else if (act === "stock") B.openStockHome();
    else if (act === "system") B.openSystemSettings();
    else if (act === "readAgenda") {
      const evs = upcomingEvents().filter(e => e.start - Date.now() < 7 * 86400000);
      if (!evs.length) B.speak("Nei prossimi sette giorni non hai impegni.");
      else B.speak(evs.slice(0, 6).map(e => { const d = relDay(e.start); return `${d[0].toUpperCase() + d.slice(1)} alle ${J.sayHm(e.start)}, ${e.title}.`; }).join(" "));
    }
  }

  /* ------------------------------------------------------------------ screensaver */
  let idleT = null;
  function saverMinutes() { const m = Number(S.data.profile.saverMin); return isNaN(m) ? 3 : m; }
  function resetIdle() {
    clearTimeout(idleT);
    const m = saverMinutes();
    if (m > 0) idleT = setTimeout(startSaver, m * 60000);
  }
  function startSaver() {
    if (S.panel || S.study || S.moveMode) { resetIdle(); return; }
    S.saver = true;
    renderSaver();
    document.body.classList.add("saver");
    clearInterval(S.saverT);
    S.saverT = setInterval(moveSaver, 60000);                         // drift: never burn the same pixels
  }
  function stopSaver() {
    S.saver = false;
    clearInterval(S.saverT);
    document.body.classList.remove("saver");
    resetIdle();
    if (Date.now() - S.lastSpokenAt > 3 * 3600000) greet({ voice: true });
  }
  const SAVER_SPOTS = [[96, 800], [1240, 800], [96, 70], [1240, 70], [660, 430]];
  function renderSaver() {
    const now = new Date(), w = S.weather;
    $("saverClock").textContent = `${now.getHours()}:${pad(now.getMinutes())}`;
    $("saverDate").textContent = (J.longDate(now) + (w ? `  ·  ${Math.round(w.temp)}°` : "")).toUpperCase();
    const [x, y] = SAVER_SPOTS[S.saverSpot || 0];
    const c = $("saverClock"), d = $("saverDate");
    c.style.left = x + "px"; c.style.top = y + "px";
    d.style.left = (x + 8) + "px"; d.style.top = (y + 162) + "px";
  }
  function moveSaver() {
    $("saver").classList.add("moving");
    setTimeout(() => {
      S.saverSpot = ((S.saverSpot || 0) + 1 + Math.floor(Math.random() * 3)) % SAVER_SPOTS.length;
      renderSaver();
      $("saver").classList.remove("moving");
    }, 950);
  }

  /* ------------------------------------------------------------------ study session */
  function studySubject() {
    const now = Date.now();
    const ev = upcomingEvents().find(e => e.start - now < 90 * 60000 && (e.end || e.start) > now);
    return (ev && ev.title) || S.data.focus.title || "Studio";
  }
  function studyLog() { return store.get("studyLog", {}); }
  function studyToday() { return studyLog()[ymd(new Date())] || { n: 0, min: 0 }; }
  function openStudyPicker() {
    const st = studyToday();
    openPanel(`
      <div class="k mono">BIOS / STUDIO</div>
      <h2>SESSIONE<span class="muted">DI STUDIO.</span></h2>
      <div class="info">
        <div class="k mono">MATERIA</div><div class="big">${J.esc(studySubject())}</div>
        ${st.n ? `<div class="k mono" style="margin-top:14px">OGGI · ${st.n} SESSIONI · ${st.min} MIN</div>` : ""}
      </div>
      <div class="list">
        <button class="pbtn" data-act="study:50:10">Profonda <span class="st">50 + 10 MIN</span></button>
        <button class="pbtn" data-act="study:25:5">Classica <span class="st">25 + 5 MIN</span></button>
        <button class="pbtn" data-act="study:90:15">Lunga <span class="st">90 + 15 MIN</span></button>
        <button class="pbtn" data-act="readFocus">Leggi il focus della settimana <span class="st">OK</span></button>
      </div>`);
  }
  function startStudy(min, brk) {
    closePanel();
    const subject = studySubject();
    S.study = { phase: "focus", min, brk, subject, total: min * 60000, endAt: Date.now() + min * 60000, paused: false };
    document.body.classList.add("studying");
    document.body.classList.remove("study-break", "study-paused");
    $("studyTitle").textContent = subject;
    if (B.keepAwake) B.keepAwake(true);
    say(`Sessione di ${min} minuti${subject !== "Studio" ? ", " + subject : ""}. Ci sentiamo alla pausa.`);
    clearInterval(S.studyT);
    S.studyT = setInterval(tickStudy, 1000);
    tickStudy();
  }
  function tickStudy() {
    const st = S.study; if (!st) return;
    const left = st.paused ? st.left : st.endAt - Date.now();
    if (left <= 0) return studyPhaseEnd();
    const sec = Math.ceil(left / 1000);
    $("studyTime").textContent = `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
    $("studyBar").style.strokeDashoffset = (1859.8 * (1 - left / st.total)).toFixed(1);   // full ring that empties
    const done = studyToday().n;
    $("studyK").textContent = st.phase === "focus" ? `SESSIONE ${done + 1} DI OGGI` : "PAUSA";
    $("studyPhase").textContent = st.paused ? "IN PAUSA" : st.phase === "focus" ? "CONCENTRAZIONE" : "RECUPERO";
  }
  function studyPhaseEnd() {
    const st = S.study;
    if (st.phase === "focus") {
      const log = studyLog(), k = ymd(new Date()), t = log[k] || { n: 0, min: 0 };
      log[k] = { n: t.n + 1, min: t.min + st.min };
      Object.keys(log).filter(d => d < ymd(new Date(Date.now() - 30 * 86400000))).forEach(d => delete log[d]);
      store.set("studyLog", log);
      Object.assign(st, { phase: "break", total: st.brk * 60000, endAt: Date.now() + st.brk * 60000 });
      document.body.classList.add("study-break");
      say(`Sessione completata. Oggi ${log[k].min} minuti di studio. Pausa di ${st.brk} minuti.`);
    } else {
      Object.assign(st, { phase: "focus", total: st.min * 60000, endAt: Date.now() + st.min * 60000 });
      document.body.classList.remove("study-break");
      say("Pausa finita. Si riparte.");
    }
    tickStudy();
  }
  function toggleStudyPause() {
    const st = S.study; if (!st) return;
    if (st.paused) { st.endAt = Date.now() + st.left; st.paused = false; }
    else { st.left = st.endAt - Date.now(); st.paused = true; }
    document.body.classList.toggle("study-paused", st.paused);
    tickStudy();
  }
  function stopStudy() {
    clearInterval(S.studyT);
    S.study = null;
    document.body.classList.remove("studying", "study-break", "study-paused");
    if (B.keepAwake) B.keepAwake(false);
    const t = studyToday();
    if (t.n) say(`Sessione chiusa. Oggi ${t.n} ${t.n === 1 ? "sessione" : "sessioni"}, ${t.min} minuti.`);
    renderCards(); resetIdle();
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
      if (S.saver) { stopSaver(); return; }                             // first press only wakes
      resetIdle();
      if (S.study) {
        if (k === "ok") toggleStudyPause();
        else if (k === "back") stopStudy();
        return;
      }
      if (k === "up" || k === "down" || k === "left" || k === "right") moveFocus(k);
      else if (k === "ok") activate();
      else if (k === "hold") startMove();
      else if (k === "menu") { if (!S.panel) openSettings(); }
      else if (k === "back") {
        if (S.moveMode) endMove();
        else if (S.pickMode) { S.pickMode = false; applyFocus(false); }
        else if (S.panel) closePanel();
        else { S.focus = { row: "apps", idx: 0 }; S.rowIdx.apps = 0; applyFocus(); }
      }
    },
    _http(id, ok, body) { const p = pending[id]; if (!p) return; delete pending[id]; ok ? p.resolve(body) : p.reject(new Error(body)); },
    _apps(list) { S.allApps = Array.isArray(list) ? list : []; renderApps(); },
    refreshApps() { B.requestApps(false); },
    updateAvailable(n) {
      if (S.update === n) return;
      S.update = n;
      if (S.study || S.saver) return;                                   // ask later, not mid-session
      openPanel(`
        <div class="k mono">BIOS / AGGIORNAMENTO</div>
        <h2>NUOVA<span class="muted">VERSIONE.</span></h2>
        <div class="info"><div class="k mono">DISPONIBILE</div><div class="big">Build ${n}</div></div>
        <div class="list">
          <button class="pbtn" data-act="update">Aggiorna ora <span class="st">OK</span></button>
          <button class="pbtn" data-act="later">Più tardi <span class="st">INDIETRO</span></button>
        </div>`);
    },
    updateFailed(msg) { toast("AGGIORNAMENTO NON RIUSCITO" + (msg ? " · " + String(msg).slice(0, 40).toUpperCase() : "")); },
    ttsState(s) { $("orb").classList.toggle("speaking", s === "start"); },
    onData() {
      loadData(); applyTheme(); renderCards(); renderApps(); greet({ voice: false, animate: false, keep: true });
      if ((S.data.geo && S.data.geo.query || "") !== (S.data.profile.city || "").trim()) loadWeather();
      loadBios();
      toast("AGGIORNATO DAL TELEFONO");
    },
    onWake() { S.woke = true; setTimeout(() => { if (S.woke) app.onResume(); }, 1500); },
    onResume() {
      if (S.saver) { S.saver = false; clearInterval(S.saverT); document.body.classList.remove("saver"); }
      resetIdle();
      if (S.panel) closePanel();
      if (S.moveMode) endMove();
      renderClock();
      const since = Date.now() - S.lastSpokenAt;
      if (S.woke || since > 3 * 3600000) greet({ voice: true });                 // TV turned on / long absence: full briefing
      else {
        if (Date.now() - S.lastGreetAt > 10 * 60000) greet({ voice: false });
        if (since > 5 * 60000 && voiceAllowed()) say(shortHello());            // back from an app: a quick hello
      }
      S.woke = false;
      if (!S.weather || Date.now() - S.weather.at > 20 * 60000) loadWeather();
      if (!S.biosAt || Date.now() - S.biosAt > 5 * 60000) loadBios();
    }
  };

  function boot() {
    fit(); window.addEventListener("resize", fit);
    loadData();
    const cw = store.get("weather", null);
    if (cw && Date.now() - cw.at < 3 * 3600000) {
      if (cw.sun) cw.sun = { rise: new Date(cw.sun.rise), set: new Date(cw.sun.set) };
      S.weather = cw; renderWeather();
    }
    document.body.classList.toggle("theme-landscape", isLandscape());
    renderClock(); renderCards(); renderApps();
    B.requestApps(false);
    greet({ voice: false, fresh: true });                               // text immediately…
    // …heavy work after the first frame, so the screen appears at once
    requestAnimationFrame(() => setTimeout(applyTheme, 30));
    Promise.race([Promise.all([loadWeather(), loadBios()]), new Promise(r => setTimeout(r, 1500))])
      .then(() => greet({ voice: true, animate: false, keep: true }));       // …and the voice with fresh data
    setInterval(renderClock, 5000);
    setInterval(() => { renderCards(); greet({ voice: false, animate: false, keep: true }); }, 60000);
    setInterval(loadWeather, 20 * 60000);
    setInterval(drawScene, 10 * 60000);
    setInterval(loadBios, 10 * 60000);
    resetIdle();
    if (B.checkUpdate) { setTimeout(() => B.checkUpdate(), 15000); setInterval(() => B.checkUpdate(), 6 * 3600000); }
    if (PREVIEW) {
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok", Escape: "back", Backspace: "back", h: "hold", m: "menu" };
      window.addEventListener("keydown", e => { const k = map[e.key]; if (k) { e.preventDefault(); app.key(k); } });
    }
  }
  // Fonts are local, but never let them hold the first paint for long.
  let booted = false;
  const go = () => { if (!booted) { booted = true; boot(); } };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
  setTimeout(go, 700);

  /* ------------------------------------------------------------------ preview mock */
  function makeMock() {
    const d = new Date(), t = new Date(d); t.setDate(d.getDate() + 1);
    const dd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const in12 = new Date(d); in12.setDate(d.getDate() + 12);
    const demo = {
      version: 1, profile: Object.assign({ name: "Filippo", city: "", voice: true, quietFrom: "", quietTo: "" },
        Object.fromEntries(new URLSearchParams(location.search))), geo: null, bios: { token: /bios=1/.test(location.search) ? "tv_preview_token_0000000000000000000000" : "" },
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
      requestApps() { document.fonts.load("500 34px Inter").then(() => app._apps([{ pkg: "input:hdmi2", label: "PS5", input: true }].concat(names.map(([pkg, label, a, b]) => ({ pkg, label, banner: art(label, a, b) }))))); },
      keepAwake() {},
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
      httpPost(id) {
        if (!/bios=1/.test(location.search)) return setTimeout(() => app._http(id, false, "offline preview"), 20);
        const n = new Date(), t2 = new Date(n); t2.setDate(n.getDate() + 1); const ds = x => x.toISOString().slice(0, 10);
        setTimeout(() => app._http(id, true, JSON.stringify({ profileName: "Filippo Fogazzi", trainingTarget: 4, nextRoutine: "C — Upper body",
          events: [{ date: ds(n), start: "21:00", end: "22:00", title: "RIPASSO FISICA", kind: "calendar" }, { date: ds(t2), start: "09:00", end: "11:00", title: "FISICA", kind: "calendar" },
                   { date: ds(t2), start: "11:00", end: "13:00", title: "CHIMICA E PROPEDEUTICA BIOCHIMICA", kind: "calendar" }],
          workouts: [{ date: ds(new Date(n.getTime() - 86400000)), title: "B — Pull" }], exams: [] })), 30);
      },
      getServerInfo() { return JSON.stringify({ url: "http://192.168.1.42:8765", pin: "4817" }); },
      openAccessibility() { toast("APRO ACCESSIBILITÀ"); }, openSystemSettings() {}, openStockHome() {},
      isHomeWatcherOn() { return false; }
    };
  }
})();
