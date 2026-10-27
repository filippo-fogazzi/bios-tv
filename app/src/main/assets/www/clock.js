/* Wall clock fix. Some TV WebViews run JavaScript in a different time zone than the system
   (e.g. UTC), so every `new Date()` was an hour behind in Italy. All launcher logic works on
   wall-clock fields (getHours, getDate…), so we shift "now" to the wall time of a chosen zone:
   Europe/Rome by default (handles daylight saving through Intl), or the TV's own zone. */
(function () {
  "use strict";
  const RealDate = Date;
  let corr = 0;

  function offsetFor(tz, ms) {
    try {
      const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const p = {};
      f.formatToParts(new RealDate(ms)).forEach(x => { p[x.type] = x.value; });
      const asUTC = RealDate.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return Math.round((asUTC - ms) / 60000);
    } catch (e) {
      return null;
    }
  }

  function compute(tz) {
    const ms = RealDate.now();
    let target = tz && tz !== "auto" ? offsetFor(tz, ms) : null;
    if (target == null && window.Android && window.Android.tzOffsetMinutes) target = window.Android.tzOffsetMinutes();
    if (target == null) { corr = 0; return; }
    const jsOffset = -new RealDate(ms).getTimezoneOffset();
    corr = (target - jsOffset) * 60000;
  }

  class WallDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(RealDate.now() + corr);
      else super(...a);
    }
    static now() { return RealDate.now() + corr; }
  }

  window.Date = WallDate;
  let zone = "Europe/Rome";
  window.BiosClock = {
    set(tz) { zone = tz || "Europe/Rome"; compute(zone); },
    offsetMinutes() { return corr / 60000; }
  };
  compute(zone);
  setInterval(() => compute(zone), 10 * 60000);                       // follows DST changes
})();
