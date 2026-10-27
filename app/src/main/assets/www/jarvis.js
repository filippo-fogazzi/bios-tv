/* Jarvis — local briefing composer. No network, no AI: rules + your data. */
(function () {
  const DAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

  const WMO = [
    [[0], "sereno", "clear"], [[1], "quasi sereno", "clear"], [[2], "poco nuvoloso", "partly"], [[3], "coperto", "cloud"],
    [[45, 48], "nebbia", "fog"], [[51, 53, 55, 56, 57], "pioviggine", "rain"], [[61, 63, 65, 66, 67], "pioggia", "rain"],
    [[71, 73, 75, 77], "neve", "snow"], [[80, 81, 82], "rovesci", "rain"], [[85, 86], "rovesci di neve", "snow"], [[95, 96, 99], "temporale", "storm"]
  ];
  function wmo(code) {
    for (const [codes, text, kind] of WMO) if (codes.includes(code)) return { text, kind };
    return { text: "variabile", kind: "cloud" };
  }

  const pad = n => String(n).padStart(2, "0");
  const hm = d => `${d.getHours()}:${pad(d.getMinutes())}`;
  const sayHm = d => d.getMinutes() === 0 ? `${d.getHours()}` : `${d.getHours()} e ${d.getMinutes()}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function pick(list, seed) { return list[Math.abs(seed) % list.length]; }
  function dayPart(h) { return h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"; }
  function minutesWord(min) {
    if (min < 60) return `${min} minut${min === 1 ? "o" : "i"}`;
    const h = Math.floor(min / 60), m = min % 60;
    const hs = h === 1 ? "un'ora" : `${h} ore`;
    return m ? `${hs} e ${m} minuti` : hs;
  }

  /* Each part is {html, say}: what's shown and what's spoken can differ. */
  function compose(ctx) {
    const now = ctx.now, h = now.getHours();
    const name = (ctx.name || "").trim();
    const part = dayPart(h);
    const seed = now.getDate() * 7 + h + (ctx.salt || 0);
    const parts = [];
    let prio = 9;
    const add = (html, say, p) => parts.push({ html, say: say == null ? html.replace(/<[^>]+>/g, "") : say, p: p == null ? prio : p });

    // ---- title
    let t1;
    if (part === "night") t1 = "È TARDI,";
    else if (ctx.returning) t1 = "BENTORNATO,";
    else t1 = { morning: "BUONGIORNO,", afternoon: "BUON POMERIGGIO,", evening: "BUONASERA," }[part];
    const t2 = (name ? name.toUpperCase() : "BENVENUTO") + ".";
    const spokenGreeting = part === "night" ? `È tardi${name ? ", " + name : ""}.`
      : ctx.returning ? `Bentornato${name ? ", " + name : ""}.`
      : `${{ morning: "Buongiorno", afternoon: "Buon pomeriggio", evening: "Buonasera" }[part]}${name ? ", " + name : ""}.`;

    // ---- time + weather
    const w = ctx.weather;
    if (w && typeof w.temp === "number") {
      const t = Math.round(w.temp);
      const cond = wmo(w.code).text;
      // The clock is already on screen: the time is only spoken, never written (it would go stale).
      add(`Fuori ${t}° e ${cond}.`, `Sono le ${sayHm(now)}. Fuori ${t} gradi, ${cond}.`);
    } else {
      add("", `Sono le ${sayHm(now)}.`);
    }

    // ---- agenda
    const events = (ctx.events || []).filter(e => (e.end || e.start) > now);
    const today = events.filter(e => sameDay(e.start, now));
    const tomorrowDate = new Date(now); tomorrowDate.setDate(now.getDate() + 1);
    const tomorrow = events.filter(e => sameDay(e.start, tomorrowDate));
    if (today.length) {
      const e = today[0];
      const mins = Math.round((e.start - now) / 60000);
      if (mins <= 0) add(`In corso: <span class="hl">${esc(e.title)}</span>${e.end ? ` fino alle ${hm(e.end)}` : ""}.`,
                         `In corso: ${e.title}${e.end ? `, fino alle ${sayHm(e.end)}` : ""}.`);
      else if (mins <= 120) add(`<span class="hl">${esc(e.title)}</span> tra ${minutesWord(mins)}.`, `${e.title} tra ${minutesWord(mins)}.`);
      else add(`Alle ${hm(e.start)} hai <span class="hl">${esc(e.title)}</span>.`, `Alle ${sayHm(e.start)} hai ${e.title}.`);
      const more = today.length - 1;
      if (more > 0) add(more === 1 ? "Poi un altro impegno." : `Poi altri ${more} impegni.`);
    } else if (tomorrow.length && (part === "evening" || part === "night")) {
      const e = tomorrow[0];
      add(`Domani si parte alle ${hm(e.start)} con <span class="hl">${esc(e.title)}</span>.`, `Domani si parte alle ${sayHm(e.start)}, con ${e.title}.`);
    } else if (part === "morning" || part === "afternoon") {
      add("Nessun impegno in agenda per oggi.");
    }

    // ---- training
    prio = 8;
    const tr = ctx.training;
    if (tr) {
      const week = tr.target && tr.doneWeek ? ` ${tr.doneWeek} su ${tr.target} questa settimana.` : "";
      if (tr.planToday && !tr.doneToday) {
        if (part === "evening") add(`<span class="hl">${esc(tr.planToday)}</span> di oggi non risulta ancora registrato.`, `L'allenamento di oggi, ${tr.planToday}, non risulta ancora registrato.`);
        else if (part !== "night") add(`Oggi tocca a <span class="hl">${esc(tr.planToday)}</span>.${week}`, `Oggi tocca a ${tr.planToday}.${week}`);
      } else if (tr.doneToday) {
        add(`Allenamento di oggi fatto.${week}`);
      } else if (tr.linked && tr.next && part !== "night") {
        add(`Prossima scheda: <span class="hl">${esc(tr.next)}</span>.${week}`, `Prossima scheda: ${tr.next}.${week}`);
      }
    }

    // ---- weather alerts
    prio = 5;
    if (w) {
      if (w.rainNext >= 60 && part !== "night") add("Pioggia probabile nelle prossime ore.");
      else if (part === "night" && w.today && w.today.rain >= 60)
        add(`In giornata ${wmo(w.today.code).text}: l'ombrello conviene.`);
      else if (part === "evening" && w.tomorrow && w.tomorrow.rain >= 60)
        add(`Domani ${wmo(w.tomorrow.code).text}: l'ombrello conviene.`);
    }

    // ---- countdown (nearest within 45 days)
    prio = 3;
    const cds = (ctx.countdowns || []).map(c => ({ ...c, days: Math.ceil((c.date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000) }))
      .filter(c => c.days >= 0 && c.days <= 45).sort((a, b) => a.days - b.days);
    if (cds.length && parts.length < 5) {
      const c = cds[0];
      if (c.days > 1) add(`Mancano ${c.days} giorni a <span class="hl">${esc(c.title)}</span>.`, `Mancano ${c.days} giorni a ${c.title}.`);
      else add(`<span class="hl">${esc(c.title)}</span> è ${c.days === 1 ? "domani" : "oggi"}.`, `${c.title} è ${c.days === 1 ? "domani" : "oggi"}.`);
    }

    // ---- focus (only when there's room, on fresh greetings)
    prio = 2;
    if (ctx.focus && ctx.focus.title && !ctx.returning && part !== "night" && parts.length < 5)
      add(`Focus della settimana: <span class="hl">${esc(ctx.focus.title)}</span>.`);

    // ---- closing line
    prio = part === "night" ? 6 : 1;
    if (part === "night") {
      add(pick(["Il sonno è la parte del programma che salti più spesso.", "Il recupero lavora solo mentre dormi.",
                "Domani ti servirà lucidità. Valuta di chiudere qui."], seed));
    } else {
      add(pick(["Sistemi in linea.", "Tutto sotto controllo.", "A disposizione.", "Pronto quando lo sei tu."], seed));
    }

    // Screen keeps ~2 lines: drop the least important parts until it fits. Voice says everything.
    let shown = parts.slice();
    const len = a => a.reduce((n, p) => n + p.html.replace(/<[^>]+>/g, "").length + 1, 0);
    while (len(shown) > (ctx.maxChars || 170) && shown.some(p => p.p < 9)) {
      const lo = shown.reduce((m, p) => (p.p < 9 && (!m || p.p < m.p)) ? p : m, null);
      shown = shown.filter(p => p !== lo);
    }
    return {
      t1, t2,
      html: shown.map(p => p.html).filter(Boolean).join(" "),
      speech: spokenGreeting + " " + parts.map(p => p.say).join(" ")
    };
  }

  /* Short spoken replies for card actions. */
  function weatherReport(w) {
    if (!w || typeof w.temp !== "number") return "Non ho ancora dati meteo.";
    let s = `Adesso ${Math.round(w.temp)} gradi, ${wmo(w.code).text}.`;
    if (w.today) s += ` Oggi tra ${Math.round(w.today.min)} e ${Math.round(w.today.max)} gradi.`;
    if (w.tomorrow) s += ` Domani ${wmo(w.tomorrow.code).text}, massima ${Math.round(w.tomorrow.max)}${w.tomorrow.rain >= 40 ? `, pioggia al ${w.tomorrow.rain} percento` : ""}.`;
    return s;
  }

  function longDate(d) { return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

  window.Jarvis = { compose, wmo, weatherReport, longDate, hm, sayHm, sameDay, DAYS, MONTHS, esc, minutesWord };
})();
