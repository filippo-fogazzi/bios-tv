/* Scene — a procedural landscape wallpaper drawn on canvas.
   Sky follows the real sun (sunrise/sunset from the forecast, or a seasonal estimate);
   mountain ridges are seeded by the date, so every day has its own skyline. */
(function () {
  function rng(seed) {                       // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a) => a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // sky top, sky mid, horizon, far ridge, near ridge, sun/moon glow, stars (0..1)
  const PAL = {
    night:  { top: "#04060b", mid: "#0b1224", hor: "#2c375c", far: "#283357", near: "#070a10", glow: "#c9d3ee", stars: 1 },
    dawn:   { top: "#1a2040", mid: "#5c5378", hor: "#eea27e", far: "#5a4d6a", near: "#141219", glow: "#ffd2a6", stars: .25 },
    day:    { top: "#2a5884", mid: "#7ea6c8", hor: "#dde3e2", far: "#7e909a", near: "#1c2628", glow: "#fff6e0", stars: 0 },
    golden: { top: "#28305a", mid: "#a8627c", hor: "#f5b26a", far: "#6a5068", near: "#17121a", glow: "#ffcf8a", stars: 0 },
    dusk:   { top: "#0d1430", mid: "#33355a", hor: "#94607a", far: "#2e2a44", near: "#0a0a10", glow: "#f0b8a0", stars: .5 }
  };

  function sunTimes(now, sun) {
    if (sun && sun.rise && sun.set) return { rise: sun.rise, set: sun.set };
    // Seasonal estimate for northern Italy (minutes after midnight, local time)
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const k = Math.cos((doy + 10) / 365 * 2 * Math.PI);            // 1 in winter, -1 in summer
    const rise = 6.3 * 60 + k * 85, set = 18.3 * 60 - k * 115;
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return { rise: new Date(d.getTime() + rise * 60000), set: new Date(d.getTime() + set * 60000) };
  }

  function palette(now, sun) {
    const { rise, set } = sunTimes(now, sun);
    const m = (now - rise) / 60000, s = (now - set) / 60000;
    const keys = [                                                   // [minutes relative to rise/set, palette]
      [-100, "night", "r"], [-25, "dawn", "r"], [70, "day", "r"],
      [-110, "day", "s"], [-15, "golden", "s"], [35, "dusk", "s"], [100, "night", "s"]
    ].map(([off, p, ref]) => [(ref === "r" ? rise : set).getTime() + off * 60000, p]);
    const t = now.getTime();
    let a = keys[0], b = keys[0];
    if (t <= keys[0][0]) a = b = keys[0];
    else if (t >= keys[keys.length - 1][0]) a = b = keys[keys.length - 1];
    else for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t < keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
    const f = a === b ? 0 : (t - a[0]) / (b[0] - a[0]);
    const pa = PAL[a[1]], pb = PAL[b[1]], out = {};
    for (const k of ["top", "mid", "hor", "far", "near", "glow"]) out[k] = mix(hex(pa[k]), hex(pb[k]), f);
    out.stars = pa.stars + (pb.stars - pa.stars) * f;
    out.dayFrac = (t - rise) / (set - rise);                         // 0 at sunrise, 1 at sunset
    out.isNight = m < -30 || s > 40;
    return out;
  }

  /* Smooth fractal ridge plus optional "hero" peaks: broad shapes first, fine detail faint. */
  function ridge(r, w, base, amp, rough, octaves, peaks) {
    const ph = [], fr = [];
    for (let o = 0; o < octaves; o++) { ph.push(r() * 1000); fr.push(0.8 + r() * 0.6); }
    const pk = [];
    for (let i = 0; i < peaks; i++) pk.push({ x: w * (0.32 + r() * 0.6), h: 0.7 + r() * 0.6, s: w * (0.09 + r() * 0.08), k: 0.6 + r() * 0.8 });
    const pts = [];
    for (let x = 0; x <= w; x += 4) {
      let y = 0, a = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        const f = fr[o] * Math.pow(2.1, o) / w * 1.4;
        y += a * Math.sin(x * f * Math.PI + ph[o]);
        norm += a; a *= rough;
      }
      let h = (y / norm) * 0.6;
      for (const p of pk) { const d = (x - p.x) / p.s * (x < p.x ? p.k : 1 / p.k); h += p.h * Math.exp(-d * d * 1.6) * (1 + 0.08 * Math.sin(x * 0.045 + p.x)); }   // rounded, asymmetric summit
      pts.push([x, base - h * amp]);
    }
    return pts;
  }

  /* ---------------------------------------------------------------- scenes */
  const SCENES = ["mountains", "dunes", "lake", "hills", "waves"];

  function fillLayer(x, W, H, pts, top, colTop, colBot) {
    x.beginPath(); x.moveTo(0, H);
    pts.forEach(([px, py]) => x.lineTo(px, py));
    x.lineTo(W, H); x.closePath();
    const lg = x.createLinearGradient(0, top, 0, H);
    lg.addColorStop(0, colTop); lg.addColorStop(1, colBot);
    x.fillStyle = lg; x.fill();
  }
  function mist(x, W, y, col, a) {
    const mg = x.createLinearGradient(0, y - 90, 0, y + 70);
    mg.addColorStop(0, rgb(col, 0)); mg.addColorStop(0.6, rgb(col, a)); mg.addColorStop(1, rgb(col, 0));
    x.fillStyle = mg; x.fillRect(0, y - 90, W, 160);
  }
  function smooth(r, W, base, amp, waves) {          // soft rolling curve: few long sines
    const ph = [], fr = [], am = [];
    for (let i = 0; i < waves; i++) { ph.push(r() * 100); fr.push((0.6 + r() * 1.4) * (i + 1)); am.push(1 / (i + 1)); }
    const norm = am.reduce((a, b) => a + b, 0), pts = [];
    for (let px = 0; px <= W; px += 6) {
      let y = 0;
      for (let i = 0; i < waves; i++) y += am[i] * Math.sin(px / W * fr[i] * Math.PI * 2 + ph[i]);
      pts.push([px, base - (y / norm) * amp]);
    }
    return pts;
  }

  function mountains(x, W, H, P, r) {
    const layers = [
      { base: 0.62, amp: 300, rough: 0.48, oct: 6, peaks: 2 },
      { base: 0.70, amp: 170, rough: 0.45, oct: 5, peaks: 1 },
      { base: 0.79, amp: 120, rough: 0.42, oct: 4, peaks: 0 },
      { base: 0.88, amp: 80, rough: 0.4, oct: 4, peaks: 0 },
      { base: 0.98, amp: 60, rough: 0.38, oct: 3, peaks: 0 }
    ];
    layers.forEach((L, i) => {
      const t = i / (layers.length - 1);
      const col = mix(P.far, P.near, Math.pow(t, 0.8));
      fillLayer(x, W, H, ridge(r, W, H * L.base, L.amp, L.rough, L.oct, L.peaks), H * L.base - L.amp,
        rgb(mix(col, P.hor, 0.12 * (1 - t))), rgb(mix(col, [0, 0, 0], 0.25)));
      if (i < layers.length - 1) mist(x, W, H * L.base + 20, P.hor, 0.18 * (1 - t * 0.6));
    });
  }

  function dunes(x, W, H, P, r) {
    const sand = hexA("#c99b6c"), lit = P.isNight ? 0.12 : 0.55;
    const layers = [[0.5, 90], [0.6, 100], [0.72, 110], [0.86, 100]];
    layers.forEach(([b, a], i) => {
      const t = i / (layers.length - 1);
      const base = mix(mix(P.far, P.near, t), sand, lit * (1 - t * 0.5));
      const ph = r() * 6, fq = 1.1 + i * 0.35;                              // phase fixed per layer: smooth crests
      const pts = smooth(r, W, H * b, a, 2).map(([px, py]) => [px, py - Math.pow(Math.sin(px / W * Math.PI * fq + ph), 2) * a * 0.5]);
      fillLayer(x, W, H, pts, H * b - a * 1.5, rgb(mix(base, P.glow, 0.18 * (1 - t))), rgb(mix(base, [0, 0, 0], 0.35 + t * 0.2)));
      if (i < layers.length - 1) mist(x, W, H * b + 30, P.hor, 0.12);
    });
  }

  function lake(x, W, H, P, r, body) {
    const horizon = H * 0.6;
    [[0.5, 230, 2], [0.57, 130, 1]].forEach(([b, a, pk], i) => {
      const col = mix(P.far, P.near, 0.25 + i * 0.3);
      const pts = ridge(r, W, H * b, a, 0.46, 5, pk).map(([px, py]) => [px, Math.min(py, horizon)]);
      fillLayer(x, W, H, pts, H * b - a, rgb(mix(col, P.hor, 0.15)), rgb(mix(col, [0, 0, 0], 0.15)));
    });
    // water: the sky mirrored and darkened, then a reflection of the sun/moon
    x.save(); x.beginPath(); x.rect(0, horizon, W, H - horizon); x.clip();
    const wg = x.createLinearGradient(0, horizon, 0, H);
    wg.addColorStop(0, rgb(mix(P.hor, P.far, 0.35))); wg.addColorStop(0.35, rgb(mix(P.mid, P.near, 0.45))); wg.addColorStop(1, rgb(mix(P.top, [0, 0, 0], 0.45)));
    x.fillStyle = wg; x.fillRect(0, horizon, W, H - horizon);
    const rx = body.x, rw = body.night ? 60 : 140;
    for (let yy = horizon + 4; yy < H; yy += 7) {
      const k = 1 - (yy - horizon) / (H - horizon);
      const w = rw * (0.6 + r() * 0.8) * (1.4 - k * 0.6);
      x.fillStyle = rgb(P.glow, (body.night ? 0.22 : 0.38) * k * (0.5 + r() * 0.5));
      x.fillRect(rx - w / 2 + (r() - 0.5) * 30, yy, w, 2);
    }
    for (let yy = horizon + 10; yy < H; yy += 22 + r() * 30) {          // faint ripples
      x.fillStyle = rgb(P.hor, 0.05 + r() * 0.05);
      x.fillRect(r() * W * 0.6, yy, W * (0.2 + r() * 0.4), 1.5);
    }
    x.restore();
    mist(x, W, horizon, P.hor, 0.22);
  }

  function hills(x, W, H, P, r) {
    const green = hexA("#6b7a52"), lit = P.isNight ? 0.08 : 0.45;
    const layers = [[0.5, 80], [0.6, 90], [0.72, 100], [0.86, 110]];
    layers.forEach(([b, a], i) => {
      const t = i / (layers.length - 1);
      const base = mix(mix(P.far, P.near, t), green, lit * (0.6 + t * 0.4));
      fillLayer(x, W, H, smooth(r, W, H * b, a, 2), H * b - a, rgb(mix(base, P.hor, 0.2 * (1 - t))), rgb(mix(base, [0, 0, 0], 0.3)));
      if (i < layers.length - 1) mist(x, W, H * b + 25, P.hor, 0.16 * (1 - t * 0.5));
    });
  }

  function waves(x, W, H, P, r) {
    // Abstract, Apple-wallpaper-like: soft colour fields + translucent flowing bands.
    const blobs = [[0.18, 0.3, P.glow, 0.35], [0.82, 0.25, P.mid, 0.5], [0.5, 0.9, P.hor, 0.45]];
    blobs.forEach(([bx, by, c, a]) => {
      const g = x.createRadialGradient(W * bx, H * by, 0, W * bx, H * by, W * 0.55);
      g.addColorStop(0, rgb(c, a)); g.addColorStop(1, rgb(c, 0));
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const pts = smooth(r, W, H * (0.42 + t * 0.42), 150 - t * 40, 2);
      const col = mix(mix(P.mid, P.hor, 0.5), P.near, t);
      fillLayer(x, W, H, pts, H * (0.3 + t * 0.4), rgb(mix(col, P.glow, 0.15), 0.55), rgb(mix(col, [0, 0, 0], 0.4), 0.9));
    }
  }

  function hexA(h) { return hex(h); }

  function pickScene(kind, now) {
    if (SCENES.includes(kind)) return kind;
    const day = Math.floor(now / 86400000);                              // "auto": a different scene each day
    return SCENES[day % SCENES.length];
  }

  function draw(canvas, now, sun, kind, variant) {
    const W = canvas.width = 1920, H = canvas.height = 1080;
    const x = canvas.getContext("2d");
    const P = palette(now, sun);
    const seed = now.getFullYear() * 1000 + Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const scene = pickScene(kind, now);

    // sky
    const g = x.createLinearGradient(0, 0, 0, H * 0.72);
    g.addColorStop(0, rgb(P.top)); g.addColorStop(0.55, rgb(P.mid)); g.addColorStop(1, rgb(P.hor));
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    // stars
    if (P.stars > 0.02) {
      const r = rng(seed * 7);
      for (let i = 0; i < 260; i++) {
        const sx = r() * W, sy = r() * H * 0.55, sz = r() < 0.92 ? 1 : 1.8;
        x.fillStyle = `rgba(240,240,255,${(0.25 + r() * 0.75) * P.stars * (1 - sy / (H * 0.6))})`;
        x.fillRect(sx, sy, sz, sz);
      }
    }

    // sun or moon
    const df = Math.min(1.1, Math.max(-0.1, P.dayFrac));
    const bodyX = P.isNight ? W * 0.74 : W * (0.46 + 0.44 * df);           // keep clear of the clock
    const bodyY = P.isNight ? H * 0.2 : H * (0.62 - Math.sin(Math.max(0, Math.min(1, df)) * Math.PI) * 0.42);
    if (scene !== "waves") {
      const rad = x.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, P.isNight ? 260 : 520);
      rad.addColorStop(0, rgb(P.glow, P.isNight ? 0.22 : 0.55)); rad.addColorStop(1, rgb(P.glow, 0));
      x.fillStyle = rad; x.fillRect(0, 0, W, H);
      x.beginPath(); x.arc(bodyX, bodyY, P.isNight ? 18 : 30, 0, Math.PI * 2);
      x.fillStyle = rgb(P.glow, P.isNight ? 0.85 : 0.95); x.fill();
    }

    const r = rng(seed + SCENES.indexOf(scene) * 97 + (variant || 0));
    if (scene === "mountains") mountains(x, W, H, P, r);
    else if (scene === "dunes") dunes(x, W, H, P, r);
    else if (scene === "lake") lake(x, W, H, P, r, { x: bodyX, night: P.isNight });
    else if (scene === "hills") hills(x, W, H, P, r);
    else waves(x, W, H, P, r);
    P.scene = scene;
    return P;
  }

  /* Blurred, slightly brightened copy of the scene: the "frosted glass" behind cards,
     painted once instead of a live backdrop-filter (which is slow on TV chips). */
  function frosted(canvas) {
    const small = document.createElement("canvas"); small.width = 120; small.height = 68;
    const s = small.getContext("2d"); s.imageSmoothingQuality = "high";
    s.drawImage(canvas, 0, 0, 120, 68);
    const out = document.createElement("canvas"); out.width = 960; out.height = 540;
    const o = out.getContext("2d"); o.imageSmoothingQuality = "high";
    try { o.filter = "saturate(1.35) brightness(1.06)"; } catch (e) { /* optional */ }
    o.drawImage(small, 0, 0, 960, 540);
    return out.toDataURL("image/jpeg", 0.82);
  }

  window.Scene = { draw, palette, frosted, SCENES };
})();
