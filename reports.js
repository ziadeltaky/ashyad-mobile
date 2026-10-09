/* قسما المخالفات والكميات على الجوال: عرض فقط من snapshot.json (المخالفات يمكن رفع صورها). */
(() => {
  "use strict";
  const money = (api, n) => api.trimNum(n) + " ر.س";
  const STATUS_CLS = { unpaid: "", objection: "queue", paid: "ok", cancelled: "old" };

  function kpis(api, items) {
    const { el } = api;
    return el("div", { class: "kpis rep" }, items.map(([n, label, cls], i) =>
      el("div", { class: "kpi " + (cls || ""), style: `animation-delay:${i * 60}ms;cursor:default` }, el("b", { text: n }), el("span", { text: label }))));
  }

  // ------------------------------------------------------------------ violations

  const vstate = { f: "all", q: "" };

  function violations(view, api) {
    const { el, norm, icon } = api;
    const data = api.state.snap?.violations;
    if (!data) {
      view.append(el("div", { class: "empty" }, icon.inbox(), el("p", { text: "لا توجد بيانات مخالفات." }),
        el("small", { text: "تظهر بعد مزامنة الديسك توب إن كانت صلاحيتك تسمح بعرض المخالفات." })));
      return;
    }
    view.append(kpis(api, [
      [money(api, data.openAmount), `مفتوحة (${data.open})`, data.open ? "warn" : ""],
      [data.thisMonth, "هذا الشهر · " + money(api, data.thisMonthAmount)],
      [money(api, data.paidAmount), `مسدّدة (${data.paid})`]
    ]));

    const seg = el("div", { class: "seg seg4" });
    const opts = [["all", "الكل"], ["open", "مفتوحة"], ["late", "متأخرة"], ["paid", "مسدّدة"]];
    const holder = el("div", { class: "cards" });
    const count = el("div", { class: "count" });
    const search = el("input", { type: "search", "aria-label": "بحث", autocomplete: "off", value: vstate.q, oninput: (e) => { vstate.q = e.target.value; paint(); } });
    const btns = opts.map(([k, label]) => el("button", { type: "button", "data-k": k, text: label, onclick: () => { vstate.f = k; paint(); } }));
    seg.append(...btns);
    view.append(el("div", { class: "vsearch" }, el("label", {}, search, icon.search()), seg, count), holder);

    const match = (v, f) => f === "all" || (f === "open" && (v.status === "unpaid" || v.status === "objection")) || (f === "late" && v.late) || (f === "paid" && v.status === "paid");

    function paint() {
      const words = norm(vstate.q).split(/\s+/).filter(Boolean);
      const base = data.items.filter((v) => { const blob = norm([v.no, v.type, v.code, v.hood, v.statusName].join(" ")); return words.every((w) => blob.includes(w)); });
      btns.forEach((b) => {
        const k = b.dataset.k;
        b.classList.toggle("on", k === vstate.f);
        b.textContent = opts.find((o) => o[0] === k)[1] + " (" + base.filter((v) => match(v, k)).length + ")";
      });
      const list = base.filter((v) => match(v, vstate.f));
      count.textContent = `${list.length} مخالفة`;
      holder.replaceChildren(...list.slice(0, 80).map((v, i) => vcard(api, v, i)));
      if (list.length > 80) holder.append(el("div", { class: "count", text: "اكتب في البحث لتضييق النتائج." }));
    }
    paint();
  }

  function vcard(api, v, i) {
    const { el, fmtTime } = api;
    const cls = v.late ? "no" : STATUS_CLS[v.status] || "";
    return el("button", { type: "button", class: "rq vc", style: `animation-delay:${Math.min(i, 8) * 25}ms`, onclick: () => vdetail(api, v) },
      el("div", { class: "rq-top" }, el("b", { text: v.no }), el("span", { class: "chip2 " + cls, text: v.late ? "متأخرة " + v.days + " يوم" : v.statusName })),
      el("div", { class: "rq-mid", text: v.type }),
      el("div", { class: "vc-row" }, el("span", { text: [v.code, v.hood].filter(Boolean).join(" · ") }), el("b", { text: money(api, v.amount) })),
      el("div", { class: "rq-time", text: v.date }));
  }

  function vdetail(api, v) {
    const { el } = api;
    window.AshyadX.overlay(api, "مخالفة " + v.no, (body) => {
      const facts = [["النوع", v.type], ["التاريخ", v.date], ["المبلغ", money(api, v.amount)], ["الحالة", v.statusName],
        ["تاريخ السداد", v.paidDate], ["المعاملة", v.code], ["الحي", v.hood]].filter(([, x]) => x);
      body.append(el("div", { class: "form" },
        el("div", { class: "panel" }, el("div", { class: "facts" }, facts.map(([k, x]) => el("div", { class: "fact" }, el("span", { text: k }), el("b", { text: x }))))),
        v.notes ? el("div", { class: "panel" }, el("h3", { text: "ملاحظات" }), el("div", { class: "notes", text: v.notes })) : null,
        window.AshyadPhotos ? AshyadPhotos.panel({ id: v.id, code: "مخالفة " + v.no }, ["violation"]) : null));
    });
  }

  // ------------------------------------------------------------------ quantities

  function quantities(view, api) {
    const { el, svg, icon } = api;
    const q = api.state.snap?.quantities;
    if (!q) {
      view.append(el("div", { class: "empty" }, icon.inbox(), el("p", { text: "لا توجد بيانات كميات." }),
        el("small", { text: "تظهر بعد مزامنة الديسك توب إن كانت صلاحيتك تسمح بعرض الكميات." })));
      return;
    }
    const m = (n) => api.trimNum(n) + " م";
    view.append(kpis(api, [
      [m(q.asphalt), "أسفلت (فتح + خندق)"],
      [api.trimNum(q.volumeM3) + " م³", "حجم الحفر"],
      [m(q.thisMonthM), "هذا الشهر · الماضي " + m(q.lastMonthM)]
    ]));

    // last months as bars
    const months = q.monthly || [];
    if (months.length) {
      const max = Math.max(...months.map((x) => x.lengthM), 1), W = 320, H = 120, bw = W / months.length;
      const bars = months.map((x, i) => {
        const h = Math.max(3, (x.lengthM / max) * (H - 34));
        const cx = i * bw + bw / 2;
        return `<rect x="${cx - bw * 0.3}" y="${H - 20 - h}" width="${bw * 0.6}" height="${h}" rx="7" fill="url(#qg)"/>` +
          `<text x="${cx}" y="${H - 22 - h - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${api.trimNum(Math.round(x.lengthM))}</text>` +
          `<text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">${x.label}</text>`;
      }).join("");
      const chart = svg(`<defs><linearGradient id="qg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6A4BE8"/><stop offset="1" stop-color="#FB8912"/></linearGradient></defs>${bars}`, 0);
      chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
      chart.removeAttribute("width"); chart.removeAttribute("height"); chart.setAttribute("stroke", "none");
      chart.setAttribute("class", "qchart");
      view.append(el("div", { class: "panel", style: "margin-top:12px" }, el("h3", { text: "الأمتار حسب الشهر" }), chart));
    }

    view.append(el("div", { class: "kpis", style: "margin-top:12px" },
      ...[["فتح", q.open], ["خندق", q.trench], ["ترابي", q.dirt]].map(([l, n]) => el("div", { class: "kpi", style: "cursor:default" }, el("b", { text: api.trimNum(n) }), el("span", { text: l + " (م)" })))));

    view.append(el("div", { class: "count", text: `آخر ${q.items.length} حصر` }));
    view.append(el("div", { class: "cards" }, q.items.slice(0, 60).map((x, i) =>
      el("div", { class: "rq", style: `animation-delay:${Math.min(i, 8) * 25}ms` },
        el("div", { class: "rq-top" }, el("b", { text: x.code || "بدون كود" }), el("span", { class: "rq-time", text: x.date })),
        el("div", { class: "rq-mid", text: [x.hood, x.contractor].filter(Boolean).join(" · ") }),
        el("div", { class: "q-parts" }, [["فتح", x.open], ["خندق", x.trench], ["ترابي", x.dirt], ["انترلوك", x.interlock]].filter(([, n]) => n)
          .map(([l, n]) => el("span", { class: "chip2 queue", text: `${l} ${api.trimNum(n)}` })))))));
  }

  window.ASHYAD_TOOLS = window.ASHYAD_TOOLS || {};
  window.ASHYAD_TOOLS.violations = { title: "المخالفات", render: violations, live: true };
  window.ASHYAD_TOOLS.quantities = { title: "الكميات", render: quantities, live: true };
})();
