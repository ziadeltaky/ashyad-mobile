/* إعدادات المظهر: تُحفظ على الجوال وتُطبَّق فوراً (الوضع، الزجاج، الخط، اللون...). */
(() => {
  "use strict";
  const KEY = "ashyad.prefs";
  const DEFAULTS = { theme: "light", glass: 62, blur: 22, touchFade: true, size: 100, accent: "violet", motion: true, showStats: true, showKpis: true, showMenu: true };
  const ACCENTS = {
    violet: { n: "بنفسجي", h1: "#1B0B57", h2: "#3B1FB5", h3: "#6A4BE8", c: "#4B2FD0" },
    blue: { n: "أزرق", h1: "#0A1F5C", h2: "#1D4ED8", h3: "#5B8DEF", c: "#1D4ED8" },
    teal: { n: "تركوازي", h1: "#052E3A", h2: "#0E6B7A", h3: "#2BB5A0", c: "#0E7490" },
    green: { n: "أخضر", h1: "#06352A", h2: "#0F7B5A", h3: "#34C38F", c: "#0F7B5A" },
    rose: { n: "وردي", h1: "#4A0A2E", h2: "#9B1D5C", h3: "#E0487F", c: "#B91C5C" }
  };

  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (_) { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ } };

  const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const resolved = () => (prefs.theme === "auto" ? (mq && mq.matches ? "dark" : "light") : prefs.theme);

  function apply() {
    const r = document.documentElement, st = r.style, a = ACCENTS[prefs.accent] || ACCENTS.violet;
    r.dataset.theme = resolved();
    st.setProperty("--ga-base", String(prefs.glass / 100));
    st.setProperty("--blur", prefs.blur + "px");
    st.setProperty("--fs", String(prefs.size / 100));
    st.setProperty("--h1", a.h1); st.setProperty("--h2", a.h2); st.setProperty("--h3", a.h3); st.setProperty("--primary-2", a.c);
    r.classList.toggle("no-touchfade", !prefs.touchFade);
    r.classList.toggle("no-motion", !prefs.motion);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved() === "dark" ? "#0E0B24" : a.h1;
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (prefs.theme === "auto") apply(); });
  apply();

  // everything turns more transparent while a finger is on the screen
  let off = 0;
  const on = () => { clearTimeout(off); document.documentElement.classList.add("touching"); };
  const end = () => { clearTimeout(off); off = setTimeout(() => document.documentElement.classList.remove("touching"), 380); };
  document.addEventListener("touchstart", on, { passive: true });
  document.addEventListener("touchmove", on, { passive: true });
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
  document.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") on(); }, { passive: true });
  document.addEventListener("pointerup", end, { passive: true });

  function open(api) {
    const { el } = api;
    window.AshyadX.overlay(api, "الإعدادات", (body) => {
      const set = (k, v) => { prefs[k] = v; save(); apply(); if (api.rerender) api.rerender(); };

      const seg = (k, options) => {
        const wrap = el("div", { class: "seg segn", style: `grid-template-columns:repeat(${options.length},1fr)` });
        const btns = options.map(([v, label]) => el("button", { type: "button", text: label, onclick: () => { set(k, v); paint(); } }));
        const paint = () => btns.forEach((b, i) => b.classList.toggle("on", options[i][0] === prefs[k]));
        wrap.append(...btns); paint();
        return wrap;
      };
      const range = (k, min, max, step, fmt) => {
        const out = el("b", { text: fmt(prefs[k]) });
        const input = el("input", { type: "range", min, max, step, value: prefs[k], "aria-label": k,
          oninput: (e) => { out.textContent = fmt(Number(e.target.value)); set(k, Number(e.target.value)); } });
        return el("div", { class: "rng" }, input, out);
      };
      const toggle = (k, label) => {
        const b = el("button", { type: "button", class: "tg" + (prefs[k] ? " on" : ""), role: "switch", "aria-checked": String(!!prefs[k]),
          onclick: () => { set(k, !prefs[k]); b.classList.toggle("on", prefs[k]); b.setAttribute("aria-checked", String(!!prefs[k])); } },
          el("span", { text: label }), el("i"));
        return b;
      };
      const group = (title, ...kids) => el("div", { class: "panel set" }, el("h3", { text: title }), ...kids);

      const swatches = el("div", { class: "swatches" }, Object.entries(ACCENTS).map(([k, a]) =>
        el("button", { type: "button", class: "sw" + (prefs.accent === k ? " on" : ""), "aria-label": a.n, style: `--a:${a.h2};--b:${a.h3}`,
          onclick: (e) => { set("accent", k); swatches.querySelectorAll(".sw").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); } })));

      body.append(el("div", { class: "form" },
        el("div", { class: "preview" }, el("div", { class: "pv-card" }, el("b", { text: "K155" }), el("span", { text: "معاينة الزجاج والخط" }))),
        group("المظهر", seg("theme", [["light", "فاتح"], ["sun", "شمس"], ["dark", "داكن"], ["auto", "تلقائي"]]),
          el("div", { class: "hint", text: "«شمس»: تباين عالٍ وأسطح معتمة لقراءة أوضح تحت الضوء القوي." })),
        group("لون التطبيق", swatches),
        group("الزجاج", el("label", { class: "fld" }, el("span", { text: "كثافة الزجاج" }), range("glass", 15, 100, 1, (v) => v + "%")),
          el("label", { class: "fld" }, el("span", { text: "التمويه" }), range("blur", 0, 40, 1, (v) => v + "px")),
          toggle("touchFade", "شفافية كل شيء أثناء اللمس")),
        group("الخط والحركة", el("label", { class: "fld" }, el("span", { text: "حجم المحتوى" }), range("size", 90, 130, 5, (v) => v + "%")),
          toggle("motion", "الحركات")),
        group("الصفحة الرئيسية", toggle("showKpis", "المؤشرات السريعة"), toggle("showStats", "الإحصائيات"), toggle("showMenu", "قائمة الأقسام")),
        el("button", { type: "button", class: "btn-ghost", text: "إعادة الضبط", onclick: () => { prefs = { ...DEFAULTS }; save(); apply(); if (api.rerender) api.rerender(); window.AshyadX.closeTop(); } })));
    });
  }

  window.AshyadPrefs = { get: () => prefs, open };
})();
