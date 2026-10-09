/* قسم جدولة التطفئة على الجوال (أوفلاين): سطور اليوم، وتصدير D9.xlsx بنفس قالب البرنامج. */
(() => {
  "use strict";
  const X = window.AshyadX;
  const { Sheet, Book, CellText, columnName } = X;

  const STORE = "ashyad.outage.v1";
  const KINDS = { contractor: "outage_contractor", supervisor: "outage_supervisor", source: "outage_source", work: "outage_work", approval: "outage_approval" };
  const DEFAULTS = { contractor: ["منار التنمية"], supervisor: ["التصميم الفني", "ارابتيك"], source: [], work: [], approval: [] };
  const WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  function load() {
    try { const o = JSON.parse(localStorage.getItem(STORE) || "{}"); return { days: o.days || {}, saved: o.saved || {}, last: o.last || {} }; }
    catch (_) { return { days: {}, saved: {}, last: {} }; }
  }
  let db = load();
  function persist() {
    const keys = Object.keys(db.days).sort();
    while (keys.length > 120) delete db.days[keys.shift()];
    try { localStorage.setItem(STORE, JSON.stringify(db)); } catch (_) { /* full */ }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ui = { day: null };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return X.ymd(d); };
  const entriesOf = (day) => db.days[day] || [];

  function listFor(api, name) {
    const kind = KINDS[name];
    const base = (api.state.snap?.lists?.[kind] || []).map((x) => ({ v: x.v, n: x.n || 0 }));
    for (const v of DEFAULTS[name]) if (!base.some((b) => b.v === v)) base.push({ v, n: 0 });
    for (const x of db.saved[kind] || []) {
      const hit = base.find((b) => b.v === x.v);
      if (hit) hit.n += x.n || 0; else base.push({ v: x.v, n: x.n || 0 });
    }
    return base.sort((a, b) => b.n - a.n || a.v.localeCompare(b.v, "ar")).map((x) => x.v);
  }

  function remember(name, value) {
    const v = (value || "").trim();
    if (!v) return;
    const kind = KINDS[name];
    const list = (db.saved[kind] = db.saved[kind] || []);
    const hit = list.find((x) => x.v === v);
    if (hit) hit.n = (hit.n || 0) + 1; else list.push({ v, n: 1 });
  }

  function newEntry(day) {
    return {
      id: uid(), day, code: "", station: "", requestNumber: "", hood: "", source: "", work: "", approval: "", notice: "", oldNotice: "",
      from: null, to: null,
      contractor: db.last.contractor || DEFAULTS.contractor[0],
      supervisor: db.last.supervisor || DEFAULTS.supervisor[0]
    };
  }

  // ------------------------------------------------------------------ texts of the sheet (the same as the desktop)

  const clean = (s) => String(s ?? "").replace(/\r/g, " ").replace(/\n/g, " ").trim().replace(/\s{2,}/g, " ");

  function minarNumber(code) {
    const c = String(code || "").trim();
    const m = /^([A-Za-z؀-ۿ]+)\s*-?\s*(\d.*)$/.exec(c);
    return m ? m[1].toUpperCase() + "-" + m[2].trim() : c;
  }

  const requestType = (e) =>
    "المقاول: " + clean(e.contractor) + "\n" +
    "المشرف: " + clean(e.supervisor) + "\n" +
    "رقم الطلب:  " + clean(e.requestNumber) + "\n" +
    "الحي:  " + clean(e.hood) + "  \n" +
    "المصدر:  " + clean(e.source) + "\n" +
    "العمل:" + clean(e.work);

  function timeRange(from, to) {
    if (from == null && to == null) return "";
    if (to == null) return X.oneTime(from);
    if (from == null) return X.oneTime(to);
    return X.oneTime(from) + " TO   " + X.oneTime(to);
  }

  const RowHeight = 151.5, LineHeight = 19, LinesThatFit = 8, CharsPerLine = 28;
  function heightFor(text) {
    const lines = text.split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(l.length / CharsPerLine)), 0);
    return lines <= LinesThatFit ? RowHeight : RowHeight + (lines - LinesThatFit) * LineHeight;
  }

  const serialOf = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };

  async function buildD9(entries) {
    const book = await Book.load("outage_d9.xlsx");
    const sheet = book.sheet;
    const styleRow = sheet.rowElement(3);
    if (!styleRow) throw new Error("قالب D9 غير مكتمل.");
    const proto = styleRow.cloneNode(true);
    for (const c of Sheet.cells(proto)) if (X.columnOf(c.getAttribute("r")) > 10) c.remove();
    proto.setAttribute("spans", "1:10");
    for (const r of sheet.rows().filter((x) => x.n >= 3)) r.el.remove();

    entries.forEach((e, i) => {
      const rowNo = 3 + i;
      const row = Sheet.cloneRow(proto, rowNo);
      if (i === entries.length - 1) row.removeAttribute("thickBot");
      const text = requestType(e);
      row.setAttribute("ht", String(Number(heightFor(text).toFixed(2))));
      sheet.appendRow(row);
      const set = (col, v) => Sheet.setCell(row, columnName(col), rowNo, v);
      set(1, CellText.ofNumber(i + 1));
      set(2, CellText.ofText(minarNumber(e.code)));
      set(3, CellText.from(e.station));
      set(4, CellText.ofText(text));
      set(5, CellText.from(e.approval));
      set(6, CellText.from(e.notice));
      const time = timeRange(e.from, e.to);
      set(7, time ? CellText.ofText(time) : CellText.empty);
      set(8, CellText.ofNumber(serialOf(e.day)));
      set(9, CellText.ofText(WEEK[X.parseYmd(e.day).getDay()]));
      set(10, CellText.from(e.oldNotice));
    });

    const last = 3 + entries.length - 1;
    sheet.setDimension(`A1:J${last}`);
    if (last !== 5) {
      sheet.replaceInConditionalRanges(/J6:J1048576/g, () => `J${last + 1}:J1048576`);
      sheet.replaceInConditionalRanges(/J3:J5\b/g, () => `J3:J${last}`);
      book.replaceInWorkbook("\\$J\\$5\\b", "$J$" + last);
    }
    return book.save();
  }

  // ------------------------------------------------------------------ screens

  const dateText = (day) => { const [y, m, d] = day.split("-").map(Number); return `${d}-${m}-${y}`; };

  function render(view, api) {
    const { el, svg } = api;
    if (!ui.day) ui.day = tomorrow();

    function draw() {
      view.replaceChildren();
      const list = entriesOf(ui.day);

      const shift = (n) => { const d = X.parseYmd(ui.day); d.setDate(d.getDate() + n); ui.day = X.ymd(d); draw(); };
      view.append(el("div", { class: "daybar" },
        el("button", { type: "button", class: "icon-btn dark", "aria-label": "اليوم السابق", onclick: () => shift(-1) }, svg('<path d="M9 6l6 6-6 6"/>', 20)),
        el("label", { class: "daypick" },
          el("input", { type: "date", value: ui.day, "aria-label": "يوم التطفئة", onchange: (e) => { if (e.target.value) { ui.day = e.target.value; draw(); } } }),
          el("span", { text: `${WEEK[X.parseYmd(ui.day).getDay()]}  ${dateText(ui.day)}` })),
        el("button", { type: "button", class: "icon-btn dark", "aria-label": "اليوم التالي", onclick: () => shift(1) }, svg('<path d="M15 6l-6 6 6 6"/>', 20))));

      view.append(el("div", { class: "acts" },
        el("button", { type: "button", class: "btn-main", onclick: () => pickTransactions(api, draw) }, svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18), "من المعاملات"),
        el("button", { type: "button", class: "btn-ghost", onclick: () => editEntry(api, newEntry(ui.day), true, draw) }, svg('<path d="M12 5v14M5 12h14"/>', 18), "إضافة يدوية"),
        el("button", { type: "button", class: "btn-ghost", onclick: () => copyFromEarlier(api, draw) }, svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', 18), "نسخ من يوم سابق")));

      if (!list.length) {
        view.append(el("div", { class: "empty" }, api.icon.inbox(), el("p", { text: "لا توجد سطور في هذا اليوم." })));
        return;
      }
      const cards = el("div", { class: "cards" });
      list.forEach((e, i) => cards.append(entryCard(api, e, i, list.length, draw)));
      view.append(cards);
      view.append(el("button", { type: "button", class: "btn-main wide export", onclick: () => exportSheet(api, list) },
        svg('<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>', 20), `تصدير D9.xlsx (${list.length} سطر)`));
    }
    draw();
  }

  function entryCard(api, e, i, n, draw) {
    const { el, svg } = api;
    const time = timeRange(e.from, e.to);
    const move = (d) => {
      const list = entriesOf(e.day);
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      persist(); draw();
    };
    return el("div", { class: "task", style: `animation-delay:${Math.min(i, 8) * 30}ms` },
      el("button", { type: "button", class: "task-main", onclick: () => editEntry(api, e, false, draw) },
        el("b", { text: `${i + 1}. ${minarNumber(e.code) || "سطر جديد"}` }),
        el("span", { text: [e.hood, e.work].filter(Boolean).join(" · ") }),
        time ? el("em", { class: "sec", text: time.replace(/:00(AM|PM)/g, "$1") }) : null),
      el("div", { class: "task-btns" },
        el("button", { type: "button", class: "icon-btn dark sm", "aria-label": "أعلى", disabled: i === 0, onclick: () => move(-1) }, svg('<path d="M6 15l6-6 6 6"/>', 18)),
        el("button", { type: "button", class: "icon-btn dark sm", "aria-label": "أسفل", disabled: i === n - 1, onclick: () => move(1) }, svg('<path d="M6 9l6 6 6-6"/>', 18)),
        el("button", { type: "button", class: "icon-btn dark sm del", "aria-label": "حذف", onclick: () => {
          if (!confirm("حذف هذا السطر؟")) return;
          db.days[e.day] = entriesOf(e.day).filter((x) => x.id !== e.id);
          persist(); draw();
        } }, svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', 18))));
  }

  function copyFromEarlier(api, draw) {
    const days = Object.keys(db.days).filter((k) => db.days[k].length && k !== ui.day).sort().reverse();
    if (!days.length) { api.toast("لا توجد أيام سابقة محفوظة."); return; }
    X.overlay(api, "نسخ من يوم سابق", (body, h) => {
      body.append(api.el("div", { class: "cards" }, days.slice(0, 20).map((d) =>
        api.el("button", { type: "button", class: "pickrow", onclick: () => {
          const copies = entriesOf(d).map((e) => ({ ...e, id: uid(), day: ui.day, notice: "", oldNotice: e.notice || e.oldNotice || "" }));
          db.days[ui.day] = [...entriesOf(ui.day), ...copies];
          persist(); h.close(); draw(); api.toast(`نُسخ ${copies.length} سطر`);
        } }, api.el("b", { text: `${WEEK[X.parseYmd(d).getDay()]}  ${dateText(d)}` }), api.el("span", { text: `${entriesOf(d).length} سطر` })))));
    });
  }

  function pickTransactions(api, draw) {
    const { el, norm } = api;
    X.overlay(api, "اختر المعاملات", (body, h) => {
      const chosen = new Set();
      const count = el("button", { type: "button", class: "btn-main wide", disabled: true, text: "إضافة" });
      const holder = el("div", { class: "cards" });
      const input = el("input", { type: "search", "aria-label": "بحث", enterkeyhint: "search", autocomplete: "off", oninput: paint });
      body.append(el("div", { class: "search" }, el("label", {}, input, api.icon.search())), holder, el("div", { class: "ovl-foot" }, count));

      function paint() {
        const words = norm(input.value).split(/\s+/).filter(Boolean);
        const rows = api.state.rows.filter((r) => words.every((w) => r.blob.includes(w))).sort((a, b) => a.t.code.localeCompare(b.t.code)).slice(0, 80);
        holder.replaceChildren(...rows.map(({ t }) => el("button", { type: "button", class: "pickrow" + (chosen.has(t.id) ? " on" : ""), onclick: (e) => {
          if (chosen.has(t.id)) chosen.delete(t.id); else chosen.add(t.id);
          e.currentTarget.classList.toggle("on");
          count.disabled = !chosen.size;
          count.textContent = chosen.size ? `إضافة (${chosen.size})` : "إضافة";
        } }, el("b", { text: t.code }), el("span", { text: [t.neighborhood, t.contractor, t.transactionNumber].filter(Boolean).join(" · ") }), el("i", { class: "tick" }))));
        if (!rows.length) holder.append(el("div", { class: "empty" }, el("p", { text: "لا نتائج." })));
      }
      count.addEventListener("click", () => {
        const list = entriesOf(ui.day).slice();
        for (const id of chosen) {
          const t = api.state.rows.find((r) => r.t.id === id)?.t;
          if (!t) continue;
          const e = newEntry(ui.day);
          e.transactionId = t.id; e.code = t.code; e.station = t.station || ""; e.requestNumber = t.transactionNumber || ""; e.hood = t.neighborhood || "";
          list.push(e);
        }
        db.days[ui.day] = list;
        persist(); h.close(); draw(); api.toast(`أُضيفت ${chosen.size} سطر`);
      });
      paint();
    });
  }

  function editEntry(api, entry, isNew, draw) {
    const { el } = api;
    const work = { ...entry };
    const text = (label, key, opts = {}) => {
      const control = opts.list
        ? X.suggestInput(api, { value: work[key], list: listFor(api, opts.list), onInput: (v) => { work[key] = v; } })
        : el("input", { type: opts.type || "text", value: work[key] || "", autocomplete: "off", oninput: (e) => { work[key] = e.target.value; } });
      return el("label", { class: "fld" }, el("span", { text: label }), control);
    };
    const timeBox = (key) => {
      const input = el("input", { type: "text", value: work[key] == null ? "" : X.formatTime(work[key]), autocomplete: "off", inputmode: "text", "aria-label": key === "from" ? "من" : "إلى" });
      input.addEventListener("input", () => { const t = input.value.trim(); work[key] = t ? X.parseTime(t) : null; input.classList.toggle("bad", !!t && work[key] == null); });
      return input;
    };
    X.overlay(api, isNew ? "سطر جديد" : "تعديل السطر", (body, h) => {
      const err = el("div", { class: "err", role: "alert" });
      const form = el("div", { class: "form" },
        text("رقم منار", "code"), text("رقم المحطة", "station"),
        text("المقاول", "contractor", { list: "contractor" }), text("المشرف", "supervisor", { list: "supervisor" }),
        text("رقم الطلب", "requestNumber"), text("الحي", "hood"), text("المصدر", "source", { list: "source" }), text("العمل", "work", { list: "work" }),
        el("div", { class: "pair" },
          el("label", { class: "fld" }, el("span", { text: "وقت الاشعار: من" }), timeBox("from")),
          el("label", { class: "fld" }, el("span", { text: "إلى" }), timeBox("to"))),
        text("موقف الاعتماد", "approval", { list: "approval" }), text("رقم الاشعار", "notice"), text("رقم الاشعار القديم", "oldNotice"));
      const save = el("button", { type: "button", class: "btn-main wide", text: "حفظ" });
      save.addEventListener("click", () => {
        for (const k of ["code", "station", "contractor", "supervisor", "requestNumber", "hood", "source", "work", "approval", "notice", "oldNotice"]) work[k] = String(work[k] ?? "").trim();
        if (!work.code) { err.textContent = "اكتب رقم منار (كود المعاملة)."; return; }
        if (form.querySelector("input.bad")) { err.textContent = "وقت غير صالح."; return; }
        for (const [name, key] of [["contractor", "contractor"], ["supervisor", "supervisor"], ["source", "source"], ["work", "work"], ["approval", "approval"]]) remember(name, work[key]);
        db.last = { contractor: work.contractor, supervisor: work.supervisor };
        Object.assign(entry, work);
        const list = entriesOf(entry.day);
        db.days[entry.day] = isNew ? [...list, entry] : list.map((x) => (x.id === entry.id ? entry : x));
        persist(); h.close(); draw();
      });
      body.append(form, err, el("div", { class: "ovl-foot" }, save));
    });
  }

  function exportSheet(api, entries) {
    const { el } = api;
    X.overlay(api, "تصدير الملف", (body) => {
      let blob = null;
      const status = el("div", { class: "count", text: "جارٍ تجهيز الملف..." });
      const shareBtn = el("button", { type: "button", class: "btn-main wide", disabled: true, onclick: async () => {
        if (!(await X.share(blob, "D9.xlsx"))) { X.download(blob, "D9.xlsx"); api.toast("لا تتوفر المشاركة هنا، حُفظ الملف على الجوال."); }
      } }, "مشاركة (واتساب وغيره)");
      const saveBtn = el("button", { type: "button", class: "btn-ghost wide", disabled: true, onclick: () => { X.download(blob, "D9.xlsx"); api.toast("حُفظ الملف في التنزيلات."); } }, "حفظ على الجوال");
      body.append(el("div", { class: "form" }, el("div", { class: "fileline", text: "D9.xlsx" })), status, el("div", { class: "ovl-foot col" }, shareBtn, saveBtn));
      buildD9(entries).then((b) => {
        blob = b; shareBtn.disabled = false; saveBtn.disabled = false;
        status.textContent = `الملف جاهز: ${entries.length} سطر.`;
      }).catch((e) => { status.textContent = "تعذّر تجهيز الملف: " + (e.message || e); status.classList.add("bad"); });
    });
  }

  window.ASHYAD_TOOLS = window.ASHYAD_TOOLS || {};
  window.ASHYAD_TOOLS.outage = { title: "جدولة التطفئة", render, _build: buildD9 };
})();
