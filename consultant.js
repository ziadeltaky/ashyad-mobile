/* قسم الاستشاري على الجوال (أوفلاين): مهام اليوم للتصميم الفني وأرابتك، وتصدير Excel بنفس قالب البرنامج. */
(() => {
  "use strict";
  const X = window.AshyadX;
  const { Sheet, Book, CellText, columnName } = X;

  const STORE = "ashyad.consultant.v1";
  const SHEETS = [{ id: "design", title: "التصميم الفني" }, { id: "arabtec", title: "أرابتك" }];
  const SECTIONS = [["connections", "التوصيلات"], ["projects", "المشاريع"], ["automation", "الاتمته"], ["maintenance", "الصيانة"]];
  const DEFAULT_NAMES = { design: "جدول الاعمال اليومية منار التنمية التصميم", arabtec: "جدول الاعمال اليومية منار التنمية ارابتك" };

  // [key, label, kind, savedKind, phoneKey]
  const FIELDS = {
    design: [
      ["rc", "ر.خ"], ["tn", "رقم المعاملة"], ["contractor", "المقاول", "saved", "contractor"], ["hood", "الحي"],
      ["station", "رقم المحطة"], ["coords", "الاحداثيات"], ["ceng", "مهندس المقاول", "saved", "contractor_engineer", "cphone"],
      ["cphone", "رقم التواصل", "phone"], ["work", "نوع العمل", "saved", "work_design"], ["tasknum", "رقم المهمه"],
      ["time", "وقت العمل", "time"], ["seng", "مهندس الاستشاري", "saved", "consultant_engineer", "sphone"],
      ["sphone", "رقم التواصل (الاستشاري)", "phone"], ["consultant", "الاستشاري", "saved", "consultant"], ["notes", "الملاحظات", "multi"]
    ],
    arabtec: [
      ["section", "القسم", "section"], ["rc", "الرقم"], ["tn", "رقم أمر العمل"], ["hood", "الحي"], ["office", "المكتب", "saved", "office"],
      ["contractor", "إسم المقاول", "saved", "contractor"], ["work", "وصف العمل / نوع العمل", "saved", "work_arabtec"],
      ["time", "الوقت", "time"], ["permit", "نوع التصريح", "saved", "permit"], ["wotype", "نوع أمر العمل", "saved", "wotype"],
      ["seng", "المهندس المشرف للاستشاري", "saved", "consultant_engineer", "sphone"], ["sphone", "الجوال (المشرف)", "phone"],
      ["ceng", "مهندس المقاول", "saved", "contractor_engineer", "cphone"], ["cphone", "الجوال (مهندس المقاول)", "phone"],
      ["coords", "موقع العمل"], ["station", "المحطة"]
    ]
  };

  // ------------------------------------------------------------------ storage (this phone only)

  function load() {
    try { const o = JSON.parse(localStorage.getItem(STORE) || "{}"); return { days: o.days || {}, saved: o.saved || {}, last: o.last || {} }; }
    catch (_) { return { days: {}, saved: {}, last: {} }; }
  }
  let db = load();
  function persist() {
    // keep the last 60 days
    const keys = Object.keys(db.days).sort();
    while (keys.length > 120) delete db.days[keys.shift()];
    try { localStorage.setItem(STORE, JSON.stringify(db)); } catch (_) { /* full */ }
  }

  const dayKey = (sheet, day) => sheet + "|" + day;
  const tasksOf = (sheet, day) => db.days[dayKey(sheet, day)] || [];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const ui = { sheet: "design", day: null };

  function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return X.ymd(d); }

  // ------------------------------------------------------------------ lists (desktop ones + what was typed here)

  function listFor(api, kind) {
    const base = (api.state.snap?.lists?.[kind] || []).map((x) => ({ v: x.v, x: x.x || "", n: x.n || 0 }));
    for (const x of db.saved[kind] || []) {
      const hit = base.find((b) => b.v === x.v);
      if (hit) { hit.n += x.n || 0; if (x.x) hit.x = x.x; } else base.push({ v: x.v, x: x.x || "", n: x.n || 0 });
    }
    return base.sort((a, b) => b.n - a.n || a.v.localeCompare(b.v, "ar"));
  }

  function remember(kind, value, extra) {
    const v = (value || "").trim();
    if (!v) return;
    const list = (db.saved[kind] = db.saved[kind] || []);
    const hit = list.find((x) => x.v === v);
    if (hit) { hit.n = (hit.n || 0) + 1; if (extra) hit.x = extra; } else list.push({ v, x: extra || "", n: 1 });
  }

  // ------------------------------------------------------------------ tasks

  function newTask(sheet, day, section) {
    const t = { id: uid(), sheet, day, section: section || "connections", values: {} };
    if (sheet === "design") t.values.consultant = "PDC";
    if (sheet === "arabtec") t.values.seng = "pdc";
    return t;
  }

  function coordsOf(t) {
    if (t.mapUrl && String(t.mapUrl).trim()) return String(t.mapUrl).trim();
    if (t.latitude != null && t.longitude != null) return `${t.latitude},${t.longitude}`;
    return "";
  }

  function prefill(task, t) {
    task.transactionId = t.id;
    const set = (k, v) => { if (v != null && String(v).trim()) task.values[k] = String(v).trim(); };
    set("rc", t.code); set("tn", t.transactionNumber); set("contractor", t.contractor); set("hood", t.neighborhood);
    set("station", t.station); set("coords", coordsOf(t));
  }

  // ------------------------------------------------------------------ Excel writer (a port of the desktop writer)

  const DESIGN_COLS = ["rc", "tn", "contractor", "hood", "station", "coords", "ceng", "cphone", "work", "tasknum", "time", "seng", "sphone", "consultant", "notes"];
  const ARABTEC_COLS = ["rc", "tn", "hood", "office", "contractor", "work", "time", "permit", "wotype", "seng", "sphone", "ceng", "cphone", "coords", "station"];
  const ARABTEC_SECTIONS = [["connections", 9, 4], ["projects", 15, 7], ["automation", 24, 2], ["maintenance", 28, 2]];

  function readTime(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(X.toLatinDigits(text || ""));
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3]) { const pm = m[3].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return h * 60 + min;
  }

  function timeCell(text, compact) {
    if (!String(text || "").trim()) return CellText.empty;
    const mins = readTime(text);
    if (mins == null) return CellText.from(text);
    if (!compact) return CellText.ofFraction(mins / 1440);
    const h = Math.floor(mins / 60) % 24;
    return CellText.ofText(`${h % 12 === 0 ? 12 : h % 12}:${X.pad(mins % 60)}${h < 12 ? "am" : "pm"}`);
  }

  const get = (t, k) => (t.values[k] || "").trim();

  async function buildDesign(tasks) {
    const book = await Book.load("consultant_design.xlsx");
    const sheet = book.sheet;
    const styleRow = sheet.rowElement(9);
    if (!styleRow) throw new Error("قالب التصميم الفني غير مكتمل.");
    const proto = styleRow.cloneNode(true);
    for (const r of sheet.rows().filter((x) => x.n >= 3)) r.el.remove();

    tasks.forEach((t, i) => {
      const rowNo = 3 + i;
      const row = Sheet.cloneRow(proto, rowNo);
      row.removeAttribute("hidden");
      sheet.appendRow(row);
      DESIGN_COLS.forEach((key, c) => {
        const text = get(t, key);
        Sheet.setCell(row, columnName(c + 1), rowNo, key === "time" ? timeCell(text, false) : CellText.from(text));
      });
    });

    const last = 3 + tasks.length - 1;
    sheet.setDimension(`A1:CS${Math.max(last, 2)}`);
    if (last > 13) sheet.replaceInConditionalRanges(/([A-Z]+)13\b/g, (m, g) => g + last);
    book.replaceInWorkbook("\\$O\\$8\\b", "$O$" + last);
    return book.save();
  }

  async function buildArabtec(tasks) {
    const book = await Book.load("consultant_arabtec.xlsx");
    const sheet = book.sheet;
    const known = new Set(ARABTEC_SECTIONS.map((s) => s[0]));
    const bySection = {};
    for (const [id] of ARABTEC_SECTIONS) bySection[id] = tasks.filter((t) => t.section === id);
    bySection.connections.push(...tasks.filter((t) => !known.has(t.section)));

    // make room, from the bottom section to the top one so the rows above never move
    const extras = {};
    for (const [id, first, rows] of [...ARABTEC_SECTIONS].reverse()) {
      const extra = Math.max(0, bySection[id].length - rows);
      extras[id] = extra;
      if (!extra) continue;
      const lastRow = first + rows - 1;
      const cloneFrom = lastRow - 1;
      sheet.insertRowsAfter(cloneFrom, extra, sheet.rowElement(cloneFrom).cloneNode(true));
    }

    const connectionStyles = Sheet.cellStyles(sheet.rowElement(ARABTEC_SECTIONS[0][1]));

    let shift = 0;
    for (const [id, first, tplRows] of ARABTEC_SECTIONS) {
      const start = first + shift;
      const rows = tplRows + extras[id];
      const list = bySection[id];
      const isConnections = id === "connections";
      for (let i = 0; i < rows; i++) {
        const rowNo = start + i;
        const row = sheet.rowElement(rowNo);
        const filled = i < list.length;

        if (filled && isConnections) {
          for (const [col, style] of connectionStyles) {
            if (col < 3) continue;
            Sheet.cells(row).find((c) => X.columnOf(c.getAttribute("r")) === col)?.setAttribute("s", style);
          }
        }
        for (let c = isConnections ? 3 : 4; c <= 17; c++)
          if (!filled) Sheet.setCell(row, columnName(c), rowNo, CellText.empty);
        if (!filled) continue;

        const task = list[i];
        ARABTEC_COLS.forEach((key, c) => {
          const text = get(task, key);
          let value;
          if (key === "time") value = timeCell(text, true);
          else if (key === "rc" && (!isConnections || !text)) value = CellText.ofNumber(i + 1);
          else value = CellText.from(text);
          Sheet.setCell(row, columnName(c + 3), rowNo, value);
        });
      }
      shift += extras[id];
    }
    const total = Object.values(extras).reduce((a, b) => a + b, 0);
    sheet.setDimension(`A1:Q${29 + total}`);
    return book.save();
  }

  const buildExcel = (sheet, tasks) => (sheet === "arabtec" ? buildArabtec(tasks) : buildDesign(tasks));

  // ------------------------------------------------------------------ screens

  function dateText(sheet, day) {
    const [y, m, d] = day.split("-").map(Number);
    return sheet === "arabtec" ? `${d}-${m}-${y}` : `${X.pad(d)}-${X.pad(m)}-${y}`;
  }

  const WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  function render(view, api) {
    const { el, svg, toast } = api;
    if (!ui.day) ui.day = tomorrow();

    function draw() {
      view.replaceChildren();
      const tasks = tasksOf(ui.sheet, ui.day);

      view.append(el("div", { class: "seg" }, SHEETS.map((s) =>
        el("button", { type: "button", class: s.id === ui.sheet ? "on" : "", text: s.title, onclick: () => { ui.sheet = s.id; draw(); } }))));

      const shift = (n) => { const d = X.parseYmd(ui.day); d.setDate(d.getDate() + n); ui.day = X.ymd(d); draw(); };
      view.append(el("div", { class: "daybar" },
        el("button", { type: "button", class: "icon-btn dark", "aria-label": "اليوم السابق", onclick: () => shift(-1) }, svg('<path d="M9 6l6 6-6 6"/>', 20)),
        el("label", { class: "daypick" },
          el("input", { type: "date", value: ui.day, "aria-label": "يوم العمل", onchange: (e) => { if (e.target.value) { ui.day = e.target.value; draw(); } } }),
          el("span", { text: `${WEEK[X.parseYmd(ui.day).getDay()]}  ${dateText("arabtec", ui.day)}` })),
        el("button", { type: "button", class: "icon-btn dark", "aria-label": "اليوم التالي", onclick: () => shift(1) }, svg('<path d="M15 6l-6 6 6 6"/>', 20))));

      view.append(el("div", { class: "acts" },
        el("button", { type: "button", class: "btn-main", onclick: () => pickTransactions(api, draw) }, svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18), "من المعاملات"),
        el("button", { type: "button", class: "btn-ghost", onclick: () => editTask(api, newTask(ui.sheet, ui.day), true, draw) }, svg('<path d="M12 5v14M5 12h14"/>', 18), "إضافة يدوية"),
        el("button", { type: "button", class: "btn-ghost", onclick: () => copyFromEarlier(api, draw) }, svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', 18), "نسخ من يوم سابق")));

      if (!tasks.length) {
        view.append(el("div", { class: "empty" }, api.icon.inbox(), el("p", { text: "لا توجد مهام في هذا اليوم." })));
      } else {
        const list = el("div", { class: "cards" });
        tasks.forEach((t, i) => list.append(taskCard(api, t, i, tasks.length, draw)));
        view.append(list);
        view.append(el("button", { type: "button", class: "btn-main wide export", onclick: () => exportSheet(api, tasks) },
          svg('<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>', 20), `تصدير Excel (${tasks.length} مهمة)`));
      }
    }
    draw();
  }

  function taskCard(api, t, i, n, draw) {
    const { el, svg } = api;
    const v = t.values;
    const title = [v.rc, v.contractor].filter(Boolean).join(" · ") || "مهمة بدون بيانات";
    const sub = [v.work, v.time, v.hood].filter(Boolean).join(" · ");
    const move = (d) => {
      const list = tasksOf(t.sheet, t.day);
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      persist(); draw();
    };
    return el("div", { class: "task", style: `animation-delay:${Math.min(i, 8) * 30}ms` },
      el("button", { type: "button", class: "task-main", onclick: () => editTask(api, t, false, draw) },
        el("b", { text: title }),
        sub ? el("span", { text: sub }) : null,
        t.sheet === "arabtec" ? el("em", { class: "sec", text: (SECTIONS.find((s) => s[0] === t.section) || [0, ""])[1] }) : null),
      el("div", { class: "task-btns" },
        el("button", { type: "button", class: "icon-btn dark sm", "aria-label": "أعلى", disabled: i === 0, onclick: () => move(-1) }, svg('<path d="M6 15l6-6 6 6"/>', 18)),
        el("button", { type: "button", class: "icon-btn dark sm", "aria-label": "أسفل", disabled: i === n - 1, onclick: () => move(1) }, svg('<path d="M6 9l6 6 6-6"/>', 18)),
        el("button", { type: "button", class: "icon-btn dark sm del", "aria-label": "حذف", onclick: () => {
          if (!confirm("حذف هذه المهمة؟")) return;
          db.days[dayKey(t.sheet, t.day)] = tasksOf(t.sheet, t.day).filter((x) => x.id !== t.id);
          persist(); draw();
        } }, svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', 18))));
  }

  function copyFromEarlier(api, draw) {
    const days = Object.keys(db.days).filter((k) => k.startsWith(ui.sheet + "|") && db.days[k].length && k.split("|")[1] !== ui.day)
      .map((k) => k.split("|")[1]).sort().reverse();
    if (!days.length) { api.toast("لا توجد أيام سابقة محفوظة."); return; }
    X.overlay(api, "نسخ من يوم سابق", (body, h) => {
      body.append(api.el("div", { class: "cards" }, days.slice(0, 20).map((d) =>
        api.el("button", { type: "button", class: "pickrow", onclick: () => {
          const copies = tasksOf(ui.sheet, d).map((t) => ({ ...t, id: uid(), day: ui.day, values: { ...t.values } }));
          db.days[dayKey(ui.sheet, ui.day)] = [...tasksOf(ui.sheet, ui.day), ...copies];
          persist(); h.close(); draw(); api.toast(`نُسخت ${copies.length} مهمة`);
        } }, api.el("b", { text: `${WEEK[X.parseYmd(d).getDay()]}  ${dateText("arabtec", d)}` }),
          api.el("span", { text: `${tasksOf(ui.sheet, d).length} مهمة` })))));
    });
  }

  function pickTransactions(api, draw) {
    const { el, norm } = api;
    X.overlay(api, "اختر المعاملات", (body, h) => {
      const chosen = new Set();
      let section = "connections";
      const count = el("button", { type: "button", class: "btn-main wide", disabled: true, text: "إضافة" });
      const holder = el("div", { class: "cards" });
      const input = el("input", { type: "search", "aria-label": "بحث", enterkeyhint: "search", autocomplete: "off", oninput: paint });
      const secSel = ui.sheet === "arabtec"
        ? el("select", { "aria-label": "القسم", onchange: (e) => { section = e.target.value; } }, SECTIONS.map(([id, name]) => el("option", { value: id, text: name })))
        : null;
      body.append(el("div", { class: "search" }, el("label", {}, input, api.icon.search())), secSel ? el("div", { class: "secsel" }, el("span", { text: "القسم" }), secSel) : null, holder, el("div", { class: "ovl-foot" }, count));

      function paint() {
        const words = norm(input.value).split(/\s+/).filter(Boolean);
        const rows = api.state.rows.filter((r) => words.every((w) => r.blob.includes(w))).sort((a, b) => a.t.code.localeCompare(b.t.code)).slice(0, 80);
        holder.replaceChildren(...rows.map(({ t }) => {
          const on = chosen.has(t.id);
          return el("button", { type: "button", class: "pickrow" + (on ? " on" : ""), onclick: (e) => {
            if (chosen.has(t.id)) chosen.delete(t.id); else chosen.add(t.id);
            e.currentTarget.classList.toggle("on");
            count.disabled = !chosen.size;
            count.textContent = chosen.size ? `إضافة (${chosen.size})` : "إضافة";
          } }, el("b", { text: t.code }), el("span", { text: [t.neighborhood, t.contractor, t.transactionNumber].filter(Boolean).join(" · ") }), el("i", { class: "tick" }));
        }));
        if (!rows.length) holder.append(el("div", { class: "empty" }, el("p", { text: "لا نتائج." })));
      }
      count.addEventListener("click", () => {
        const list = tasksOf(ui.sheet, ui.day).slice();
        for (const id of chosen) {
          const t = api.state.rows.find((r) => r.t.id === id)?.t;
          if (!t) continue;
          const task = newTask(ui.sheet, ui.day, section);
          prefill(task, t);
          list.push(task);
        }
        db.days[dayKey(ui.sheet, ui.day)] = list;
        persist(); h.close(); draw(); api.toast(`أُضيفت ${chosen.size} مهمة`);
      });
      paint();
    });
  }

  function editTask(api, task, isNew, draw) {
    const { el } = api;
    const work = { ...task, values: { ...task.values } };
    X.overlay(api, isNew ? "مهمة جديدة" : "تعديل المهمة", (body, h) => {
      const inputs = {};
      const form = el("div", { class: "form" });
      for (const [key, label, kind, savedKind, phoneKey] of FIELDS[task.sheet]) {
        let control;
        if (kind === "section") {
          control = el("select", { onchange: (e) => { work.section = e.target.value; } },
            SECTIONS.map(([id, name]) => el("option", { value: id, text: name, selected: id === work.section })));
        } else if (kind === "multi") {
          control = el("textarea", { rows: "3", maxlength: "500", oninput: (e) => { work.values[key] = e.target.value; } });
          control.value = work.values[key] || "";
        } else if (kind === "saved") {
          control = X.suggestInput(api, {
            value: work.values[key], list: listFor(api, savedKind).map((x) => x.v),
            onInput: (val) => {
              work.values[key] = val;
              if (phoneKey) {
                const hit = listFor(api, savedKind).find((x) => x.v === val.trim());
                if (hit?.x && inputs[phoneKey]) { inputs[phoneKey].value = hit.x; work.values[phoneKey] = hit.x; }
              }
            }
          });
          inputs[key] = control.querySelector("input");
        } else {
          control = el("input", { type: kind === "phone" ? "tel" : "text", value: work.values[key] || "", autocomplete: "off",
            oninput: (e) => { work.values[key] = e.target.value; } });
          inputs[key] = control;
        }
        form.append(el("label", { class: "fld" }, el("span", { text: label }), control));
      }
      const err = el("div", { class: "err", role: "alert" });
      const save = el("button", { type: "button", class: "btn-main wide", text: "حفظ" });
      save.addEventListener("click", () => {
        const v = work.values;
        for (const k of Object.keys(v)) v[k] = String(v[k] ?? "").trim();
        for (const k of Object.keys(v)) if (!v[k]) delete v[k];
        if (v.time) { const m = X.parseTime(v.time); if (m != null) v.time = X.formatTime(m); }
        for (const [key, , kind, savedKind, phoneKey] of FIELDS[task.sheet])
          if (kind === "saved" && v[key]) remember(savedKind, v[key], phoneKey ? v[phoneKey] : "");
        Object.assign(task, work);
        const list = tasksOf(task.sheet, task.day);
        if (isNew) db.days[dayKey(task.sheet, task.day)] = [...list, task];
        else db.days[dayKey(task.sheet, task.day)] = list.map((x) => (x.id === task.id ? task : x));
        persist(); h.close(); draw();
      });
      body.append(form, err, el("div", { class: "ovl-foot" }, save));
    });
  }

  // ------------------------------------------------------------------ export

  function exportSheet(api, tasks) {
    const { el } = api;
    const now = new Date();
    const base = (api.state.snap?.fileNames?.[ui.sheet]) || DEFAULT_NAMES[ui.sheet];
    const sheet = ui.sheet;
    X.overlay(api, "تصدير الملف", (body, h) => {
      let blob = null;
      const name = el("input", { type: "text", value: `${base} 00-${X.pad(now.getMonth() + 1)}-${now.getFullYear()}`, autocomplete: "off", "aria-label": "اسم الملف" });
      const status = el("div", { class: "count", text: "جارٍ تجهيز الملف..." });
      const fileName = () => (name.value.trim() || base).replace(/[\\/:*?"<>|]/g, " ").replace(/\.xlsx$/i, "") + ".xlsx";
      const shareBtn = el("button", { type: "button", class: "btn-main wide", disabled: true, onclick: async () => {
        if (!(await X.share(blob, fileName()))) { X.download(blob, fileName()); api.toast("لا تتوفر المشاركة هنا، حُفظ الملف على الجوال."); }
      } }, "مشاركة (واتساب وغيره)");
      const saveBtn = el("button", { type: "button", class: "btn-ghost wide", disabled: true, onclick: () => { X.download(blob, fileName()); api.toast("حُفظ الملف في التنزيلات."); } }, "حفظ على الجوال");
      body.append(el("div", { class: "form" }, el("label", { class: "fld" }, el("span", { text: "اسم الملف" }), name)),
        status, el("div", { class: "ovl-foot col" }, shareBtn, saveBtn));
      buildExcel(sheet, tasks).then((b) => {
        blob = b;
        shareBtn.disabled = false; saveBtn.disabled = false;
        status.textContent = `الملف جاهز: ${tasks.length} مهمة.`;
      }).catch((e) => { status.textContent = "تعذّر تجهيز الملف: " + (e.message || e); status.classList.add("bad"); });
    });
  }

  window.ASHYAD_TOOLS = window.ASHYAD_TOOLS || {};
  window.ASHYAD_TOOLS.consultant = { title: "جدول الاستشاري", render, _build: buildExcel, _db: () => db };
})();
