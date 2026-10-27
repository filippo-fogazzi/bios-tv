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
    night:  { top: "#04060b", mid: "#0b1224", hor: "#2a3456", far: "#1c2440", near: "#05070b", glow: "#c9d3ee", stars: 1 },
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

  function draw(canvas, now, sun) {
    const W = canvas.width = 1920, H = canvas.height = 1080;
    const x = canvas.getContext("2d");
    const P = palette(now, sun);
    const seed = now.getFullYear() * 1000 + Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);

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
    const bodyX = P.isNight ? W * 0.74 : W * (0.12 + 0.76 * df);
    const bodyY = P.isNight ? H * 0.2 : H * (0.62 - Math.sin(Math.max(0, Math.min(1, df)) * Math.PI) * 0.42);
    const rad = x.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, P.isNight ? 260 : 520);
    rad.addColorStop(0, rgb(P.glow, P.isNight ? 0.22 : 0.55)); rad.addColorStop(1, rgb(P.glow, 0));
    x.fillStyle = rad; x.fillRect(0, 0, W, H);
    x.beginPath(); x.arc(bodyX, bodyY, P.isNight ? 18 : 30, 0, Math.PI * 2);
    x.fillStyle = rgb(P.glow, P.isNight ? 0.85 : 0.95); x.fill();

    // ridges: far → near, with mist between
    const r = rng(seed);
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
      const pts = ridge(r, W, H * L.base, L.amp, L.rough, L.oct, L.peaks);
      x.beginPath(); x.moveTo(0, H);
      pts.forEach(([px, py]) => x.lineTo(px, py));
      x.lineTo(W, H); x.closePath();
      const lg = x.createLinearGradient(0, H * L.base - L.amp, 0, H);
      lg.addColorStop(0, rgb(mix(col, P.hor, 0.12 * (1 - t)))); lg.addColorStop(1, rgb(mix(col, [0, 0, 0], 0.25)));
      x.fillStyle = lg; x.fill();
      if (i < layers.length - 1) {                                   // valley mist
        const my = H * L.base + 20;
        const mg = x.createLinearGradient(0, my - 90, 0, my + 70);
        mg.addColorStop(0, rgb(P.hor, 0)); mg.addColorStop(0.6, rgb(P.hor, 0.18 * (1 - t * 0.6))); mg.addColorStop(1, rgb(P.hor, 0));
        x.fillStyle = mg; x.fillRect(0, my - 90, W, 160);
      }
    });
    return P;
  }

  window.Scene = { draw, palette };
})();
