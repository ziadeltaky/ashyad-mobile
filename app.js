/* موقع أشياد للجوال: يقرأ snapshot.json من Google Drive ويعرض مراحل المعاملات. للقراءة فقط. */
(() => {
  "use strict";

  const CFG = window.ASHYAD_CONFIG || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";
  const KEY = { snap: "ashyad.snapshot", file: "ashyad.fileId", signed: "ashyad.signed", tab: "ashyad.tab", stage: "ashyad.stage", tok: "ashyad.token", reqs: "ashyad.requests" };
  const PAGE = 60;

  const PHASE_COLORS = {
    received: "#6B7A90", coordination: "#3B7DD8", payment: "#8E5BD0", permit: "#1FA8A0", excavation: "#E8870E",
    asphalt: "#4A5568", shutdown: "#B7791F", lab: "#0E7C9B", billing: "#2E9D5C", hold: "#D64545"
  };
  const color = (phase) => PHASE_COLORS[phase] || PHASE_COLORS.received;

  // ------------------------------------------------------------------ small helpers

  const $ = (id) => document.getElementById(id);

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* full or blocked: ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }
  };

  function norm(text) {
    return String(text || "").toLowerCase()
      .replace(/[ً-ٟـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  }

  function fmtTime(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
    return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : "";
  }

  function daysText(d) {
    if (d == null) return "";
    if (d <= 0) return "اليوم";
    if (d === 1) return "منذ يوم";
    if (d === 2) return "منذ يومين";
    return d <= 10 ? `منذ ${d} أيام` : `منذ ${d} يوماً`;
  }

  const icon = {
    search: () => svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 20),
    close: () => svg('<path d="M6 6l12 12M18 6L6 18"/>', 18),
    pin: () => svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 20),
    inbox: () => svg('<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>', 44)
  };
  function svg(inner, size) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = inner;
    return s;
  }

  let toastTimer = 0;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------ state

  const state = {
    snap: null,
    steps: new Map(),
    main: [],
    rows: [],
    tab: "home",
    stage: store.get(KEY.stage) || "",
    query: "",
    shown: PAGE,
    busy: false,
    lastFetch: 0,
    problem: ""
  };

  function setSnapshot(snap) {
    state.snap = snap;
    state.steps = new Map((snap.steps || []).map((s) => [s.id, s]));
    state.main = (snap.steps || []).filter((s) => !s.isSide && !s.isHidden).sort((a, b) => a.order - b.order);
    state.rows = (snap.transactions || []).map((t) => ({
      t,
      blob: norm([t.code, t.transactionNumber, t.requestNumber, t.neighborhood, t.contractor, t.station, t.stepName, t.notes].join(" "))
    }));
  }

  function stageList() {
    const counts = new Map();
    for (const r of state.rows) counts.set(r.t.stepId || "", (counts.get(r.t.stepId || "") || 0) + 1);
    const list = (state.snap?.steps || []).filter((s) => !s.isHidden).sort((a, b) => a.order - b.order)
      .filter((s) => !s.isSide || counts.get(s.id))
      .map((s) => ({ id: s.id, name: s.name, phase: s.phase, count: counts.get(s.id) || 0 }));
    if (counts.get("")) list.push({ id: "", name: "بدون حالة", phase: "received", count: counts.get("") });
    return list;
  }

  // ------------------------------------------------------------------ Google sign in (token only, read-only Drive)

  let token = "";
  let tokenExp = 0;
  let allowRedirect = false;

  const redirectUri = () => CFG.redirectUri || (location.origin + location.pathname.replace(/index\.html$/, ""));

  function startRedirect(prompt) {
    const q = new URLSearchParams({
      client_id: CFG.clientId, redirect_uri: redirectUri(), response_type: "token", scope: SCOPE,
      include_granted_scopes: "true", state: "ashyad"
    });
    if (prompt) q.set("prompt", prompt);
    location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
    return new Promise(() => { /* page navigates away */ });
  }

  // reads the token Google puts in the URL after the redirect; returns an error text or ""
  function takeRedirectResult() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (!h.get("access_token") && !h.get("error")) return "";
    history.replaceState(null, "", location.pathname + location.search);
    if (h.get("error")) return "تعذّر تسجيل الدخول (" + h.get("error") + ").";
    token = h.get("access_token");
    tokenExp = Date.now() + (Number(h.get("expires_in") || 3600) - 90) * 1000;
    store.set(KEY.tok, JSON.stringify({ t: token, e: tokenExp, s: h.get("scope") || "" }));
    store.set(KEY.signed, "1");
    return "";
  }

  function loadSavedToken() {
    try {
      const o = JSON.parse(store.get(KEY.tok) || "null");
      if (o && o.e > Date.now() && /drive\.file/.test(o.s || "")) { token = o.t; tokenExp = o.e; }
    } catch (_) { /* ignore */ }
  }

  async function getToken(prompt) {
    if (token && Date.now() < tokenExp) return token;
    if (!allowRedirect) throw new Error("expired");
    return startRedirect(prompt || "");
  }

  class AuthError extends Error {}
  class NotFound extends Error {}

  async function driveGet(path, prompt) {
    let t;
    try { t = await getToken(prompt); } catch (e) { throw new AuthError(e.message); }
    const res = await fetch("https://www.googleapis.com/drive/v3/" + path, { headers: { Authorization: "Bearer " + t } });
    if (res.status === 401) { token = ""; throw new AuthError("401"); }
    return res;
  }

  async function loadFromDrive(prompt) {
    const read = async (id) => {
      const r = await driveGet(`files/${encodeURIComponent(id)}?alt=media`, prompt);
      return r.ok ? r.text() : (r.status === 404 || r.status === 403 ? null : Promise.reject(new Error("http " + r.status)));
    };

    let text = null;
    const cached = store.get(KEY.file);
    if (cached) text = await read(cached);

    if (text == null) {
      const q = `name = '${CFG.snapshotName || "snapshot.json"}' and trashed = false`;
      const r = await driveGet(`files?q=${encodeURIComponent(q)}&orderBy=modifiedTime%20desc&pageSize=10&fields=files(id,name,modifiedTime)`, prompt);
      if (!r.ok) throw new Error("http " + r.status);
      const files = (await r.json()).files || [];
      if (!files.length) throw new NotFound();
      store.set(KEY.file, files[0].id);
      text = await read(files[0].id);
      if (text == null) throw new NotFound();
    }
    return JSON.parse(text);
  }

  // ------------------------------------------------------------------ refresh

  async function refresh(manual, prompt) {
    if (state.busy) return;
    state.busy = true;
    allowRedirect = !!manual;
    $("refresh").classList.add("spin");
    try {
      const snap = await loadFromDrive(prompt);
      const changed = !state.snap || state.snap.generatedAt !== snap.generatedAt;
      state.problem = "";
      state.lastFetch = Date.now();
      setSnapshot(snap);
      store.set(KEY.snap, JSON.stringify(snap));
      showApp();
      const liveTool = (window.ASHYAD_TOOLS || {})[state.tab];
      if (changed && (!liveTool || liveTool.live)) render();
      else paintTop();
      flushRequests(true);
      if (window.AshyadPhotos) { AshyadPhotos.flush(true); AshyadPhotos.reconcile(snap); }
      if (manual) toast(changed ? "تم تحديث البيانات" : "البيانات محدّثة، لا جديد");
    } catch (e) {
      if (e instanceof AuthError) {
        if (manual || !state.snap) { showLogin("سجّل الدخول بحساب جوجل للمتابعة.", true); }
        else state.problem = "انتهت جلسة الدخول. اضغط زر التحديث لتسجيل الدخول من جديد.";
      } else if (e instanceof NotFound) {
        state.problem = "لم أجد ملف البيانات في Drive. تأكد أن المجلد مشارَك مع حسابك وأن الديسك توب رفع المزامنة.";
        store.del(KEY.file);
      } else if (e instanceof TypeError) {
        state.problem = "تعذّر الاتصال. تحقق من الإنترنت.";
      } else {
        state.problem = "تعذّر تحميل البيانات (" + (e.message || "خطأ") + ").";
      }
      if (state.snap) { showApp(); paintTop(); }
      else if (!(e instanceof AuthError)) showLogin(state.problem);
    } finally {
      state.busy = false;
      $("refresh").classList.remove("spin");
    }
  }

  // ------------------------------------------------------------------ screens

  function showLogin(message, info) {
    $("app").hidden = true;
    $("login").hidden = false;
    const m = $("login-msg");
    m.textContent = message || "";
    m.className = "login-msg" + (info ? " info" : "");
    $("signin").disabled = false;
  }

  function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
  }

  const TITLES = { stages: "مراحل المعاملات", list: "قائمة المعاملات", requests: "طلباتي" };

  function paintTop() {
    const banner = $("banner");
    const when = fmtTime(state.snap?.generatedAt);
    $("top-sub").textContent = state.tab === "home" ? (when ? "بيانات " + when : "الرئيسية") : (TITLES[state.tab] || (window.ASHYAD_TOOLS || {})[state.tab]?.title || "");

    let text = state.problem;
    let err = !!text;
    if (!text && state.snap?.generatedAt) {
      const age = Date.now() - new Date(state.snap.generatedAt).getTime();
      if (age > 6 * 3600 * 1000) text = "آخر مزامنة من الديسك توب كانت بتاريخ " + when + "؛ قد تكون البيانات قديمة.";
    }
    banner.hidden = !text;
    banner.textContent = text || "";
    banner.className = "banner" + (err ? " err" : "");
  }

  function render() {
    paintTop();
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    const view = $("view");
    view.replaceChildren();
    if (!state.snap) return;
    const tool = (window.ASHYAD_TOOLS || {})[state.tab];
    if (state.tab === "home") renderHome(view);
    else if (state.tab === "stages") renderStages(view);
    else if (state.tab === "requests") renderRequests(view);
    else if (tool) tool.render(view, api());
    else renderList(view);
  }

  // ---- stages

  function renderStages(view) {
    const stages = stageList();
    const total = state.rows.length;
    const stale = state.rows.filter((r) => r.t.isStale).length;

    if (state.stage !== "all" && !stages.some((s) => s.id === state.stage)) {
      state.stage = (stages.find((s) => s.count > 0) || stages[0] || { id: "all" }).id;
    }

    view.append(
      el("div", { class: "stat-row" },
        el("div", { class: "stat" }, el("b", { text: total }), el("span", { text: "كل المعاملات" })),
        el("div", { class: "stat" + (stale ? " warn" : "") }, el("b", { text: stale }), el("span", { text: `راكدة (+${state.snap.staleDays || 7} يوم)` })))
    );

    const chips = el("div", { class: "chips" });
    const addChip = (id, name, count, c) => {
      const b = el("button", {
        type: "button", class: "chip" + (state.stage === id ? " on" : "") + (count ? "" : " zero"), style: "--c:" + c,
        onclick: () => { state.stage = id; store.set(KEY.stage, id); render(); }
      }, el("span", { text: name }), el("span", { class: "n", text: count }));
      chips.append(b);
      return b;
    };
    addChip("all", "الكل", total, "#250D6E");
    for (const s of stages) addChip(s.id, s.name, s.count, color(s.phase));
    view.append(chips);

    const list = state.rows.filter((r) => state.stage === "all" || (r.t.stepId || "") === state.stage)
      .sort((a, b) => (b.t.daysInStep ?? -1) - (a.t.daysInStep ?? -1) || a.t.code.localeCompare(b.t.code));
    fillCards(view, list, state.stage === "all");

    requestAnimationFrame(() => chips.querySelector(".chip.on")?.scrollIntoView({ inline: "center", block: "nearest" }));
  }

  function fillCards(parent, list, showStage, more) {
    if (!list.length) {
      parent.append(el("div", { class: "empty" }, icon.inbox(), el("div", { text: "لا توجد معاملات" })));
      return;
    }
    const wrap = el("div", { class: "cards" });
    const slice = more ? list.slice(0, state.shown) : list;
    slice.forEach((r, i) => wrap.append(card(r.t, showStage, Math.min(i, 8) * 25)));
    parent.append(wrap);
    if (more && list.length > slice.length) {
      parent.append(el("button", { class: "more", type: "button", text: `عرض المزيد (${list.length - slice.length})`,
        onclick: () => { state.shown += PAGE; render(); } }));
    }
  }

  function card(t, showStage, delay) {
    const c = color(t.phase);
    const hot = t.isStale;
    return el("button", {
      type: "button", class: "card" + (hot ? " stale" : ""), style: `--c:${c};animation-delay:${delay}ms`,
      onclick: () => openSheet(t)
    },
      el("div", { class: "card-top" },
        el("span", { class: "code", text: t.code }),
        el("span", { class: "days" + (hot ? " hot" : ""), text: daysText(t.daysInStep) })),
      el("div", { class: "card-mid" },
        showStage ? el("span", { class: "pill", text: t.stepName }) : el("span", { text: t.neighborhood || "" }),
        t.lengthM ? el("span", { class: "len", text: trimNum(t.lengthM) + " م" }) : null),
      showStage && t.neighborhood ? el("div", { class: "card-mid" }, el("span", { text: t.neighborhood })) : null,
      el("div", { class: "bar" }, el("i", { style: `width:${Math.max(0, Math.min(100, t.progress || 0))}%` })));
  }

  function trimNum(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }

  // ---- list

  function renderList(view) {
    const holder = el("div");
    const count = el("div", { class: "count" });
    const input = el("input", {
      type: "search", placeholder: "ابحث بالكود أو رقم الطلب أو الحي أو المقاول", value: state.query, enterkeyhint: "search",
      autocomplete: "off", "aria-label": "بحث",
      oninput: (e) => { state.query = e.target.value; state.shown = PAGE; paint(); }
    });
    const seg = el("div", { class: "seg seg3" });
    const opts = [["all", "الكل"], ["done", "تم المسح"], ["todo", "لم يتم المسح"]];
    const segBtns = opts.map(([k, label]) => el("button", { type: "button", "data-k": k, onclick: () => { state.scan = k; state.shown = PAGE; paint(); } }, label));
    seg.append(...segBtns);
    view.append(el("div", { class: "search" }, el("label", {}, input, icon.search()), seg, count), holder);

    function paint() {
      const words = norm(state.query).split(/\s+/).filter(Boolean);
      const scan = state.scan || "all";
      const byWords = state.rows.filter((r) => words.every((w) => r.blob.includes(w)));
      const nDone = byWords.filter((r) => r.t.inspectionDone).length;
      segBtns.forEach((b) => {
        const k = b.dataset.k;
        b.classList.toggle("on", k === scan);
        b.textContent = opts.find((o) => o[0] === k)[1] + " (" + (k === "all" ? byWords.length : k === "done" ? nDone : byWords.length - nDone) + ")";
      });
      const list = byWords.filter((r) => scan === "all" || (scan === "done") === !!r.t.inspectionDone)
        .sort((a, b) => a.t.code.localeCompare(b.t.code));
      count.textContent = words.length ? `${list.length} من ${state.rows.length} معاملة` : `${list.length} معاملة`;
      holder.replaceChildren();
      fillCards(holder, list, true, true);
    }
    paint();
  }

  // ------------------------------------------------------------------ home

  const HOME_TILES = [
    { key: "stages", title: "مراحل المعاملات", sub: "المعاملات حسب كل مرحلة", c1: "#3B1FA0", c2: "#6A4BE0",
      ico: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>' },
    { key: "list", title: "قائمة المعاملات", sub: "بحث وتفاصيل كل معاملة", c1: "#0E7C9B", c2: "#27B3D6",
      ico: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>' },
    { key: "requests", title: "طلباتي", sub: "طلبات التقديم والإرجاع وحالتها", c1: "#C2410C", c2: "#FB8912",
      ico: '<path d="M4 4h16v13H8l-4 4z"/><path d="M8 9h8M8 13h5"/>' },
    { key: "violations", title: "المخالفات", sub: "الحالة والمبالغ وصور المخالفة", c1: "#B91C1C", c2: "#F26D5B",
      ico: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>' },
    { key: "quantities", title: "الكميات", sub: "الأمتار وحجم الحفر حسب الشهر", c1: "#0F766E", c2: "#34C3A8",
      ico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
    { key: "consultant", title: "جدول الاستشاري", sub: "التصميم الفني وأرابتك، ملف Excel", c1: "#1D4ED8", c2: "#5B8DEF",
      ico: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
    { key: "outage", title: "جدولة التطفئة", sub: "جدول D9 جاهز للإرسال", c1: "#B7791F", c2: "#F5B73D",
      ico: '<path d="M13 2.5L5.5 13H11l-1 8.5L18.5 10.5H13z"/>' }
  ];

  function renderHome(view) {
    const rows = state.rows;
    const total = rows.length;
    const stale = rows.filter((r) => r.t.isStale).length;
    const done = rows.filter((r) => r.t.inspectionDone).length;
    const pending = myRequests().filter((r) => !decided(r)).length;

    // the pipeline: every transaction as a slice of its phase colour, in stage order
    const order = [];
    state.main.forEach((s) => { if (!order.includes(s.phase)) order.push(s.phase); });
    rows.forEach((r) => { if (!order.includes(r.t.phase)) order.push(r.t.phase); });
    const byPhase = order.map((p) => ({ p, n: rows.filter((r) => r.t.phase === p).length })).filter((x) => x.n > 0);
    const biggest = rows.length ? Object.entries(rows.reduce((m, r) => (m[r.t.stepName] = (m[r.t.stepName] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0] : null;

    const hero = el("button", { type: "button", class: "hero", "aria-label": "مراحل المعاملات", onclick: () => go("stages") },
      el("div", { class: "hero-k", text: "المعاملات الجارية" }),
      el("div", { class: "hero-n" }, String(total), el("small", { text: "معاملة" })),
      el("div", { class: "pipe" }, byPhase.map((x, i) => el("i", { style: `--w:${x.n};--c:${color(x.p)};--i:${i}` }))),
      el("div", { class: "pipe-cap" }, el("span", { text: biggest ? `الأكثر في «${biggest[0]}» (${biggest[1]})` : "" }), el("span", { text: "المراحل ←" })));

    const R = 12, C = 2 * Math.PI * R, frac = total ? done / total : 0;
    const ring = svg(`<circle class="bg" cx="15" cy="15" r="${R}"/><circle class="fg" cx="15" cy="15" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/>`, 30);
    ring.setAttribute("class", "ring");
    ring.setAttribute("viewBox", "0 0 30 30");

    const kpi = (cls, n, label, fn, extra, i) => el("button", { type: "button", class: "kpi " + cls, style: `animation-delay:${120 + i * 70}ms`, onclick: fn }, extra, el("b", { text: n }), el("span", { text: label }));
    const kpis = el("div", { class: "kpis" },
      kpi("", done, `ممسوحة من ${total}`, () => { state.scan = "done"; go("list"); }, ring, 0),
      kpi(stale ? "warn" : "", stale, `راكدة (+${state.snap.staleDays || 7} يوم)`, () => go("stages"), null, 1),
      kpi("", pending, "طلباتي المعلّقة", () => go("requests"), pending ? el("em", { text: "!" }) : null, 2));

    const menu = el("div", { class: "menu" });
    HOME_TILES.forEach((t, i) => {
      const ready = ["stages", "list", "requests"].includes(t.key) || !!(window.ASHYAD_TOOLS || {})[t.key];
      menu.append(el("button", {
        type: "button", class: "row", style: `--c1:${t.c1};--c2:${t.c2};animation-delay:${260 + i * 60}ms`,
        onclick: (e) => { if (!ready) { toast("هذا القسم قريباً"); return; } ripple(e); setTimeout(() => go(t.key), 120); }
      }, el("span", { class: "ri" }, svg(t.ico, 24)),
        el("span", { class: "rt" }, el("strong", { text: t.title }), el("small", { text: ready ? t.sub : "قريباً" })),
        svg('<path d="M15 6l-6 6 6 6"/>', 20)));
    });
    menu.querySelectorAll(".row > svg").forEach((s) => s.classList.add("chev"));

    view.append(el("div", { class: "dash" }, hero, kpis, el("div", { class: "sec-t", text: "الأقسام" }), menu));
  }

  function ripple(e) {
    const b = e.currentTarget;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const dot = el("i", { class: "rip", style: `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px` });
    b.append(dot);
    setTimeout(() => dot.remove(), 600);
  }

  function go(tab) {
    state.tab = tab;
    state.shown = PAGE;
    render();
    $("view").scrollTop = 0;
    if (tab === "requests" && state.snap && Date.now() - state.lastFetch > 15000) refresh(false, "");
  }

  // ------------------------------------------------------------------ requests (advance / go back)

  const STATUS_TEXT = {
    pending: ["بانتظار قرار الديسك توب", "wait"], applied: ["تم التنفيذ", "ok"], rejected: ["مرفوض", "no"], outdated: ["متقادم", "old"]
  };

  function myRequests() {
    try { return JSON.parse(store.get(KEY.reqs) || "[]"); } catch (_) { return []; }
  }
  function saveRequests(list) {
    const cutoff = Date.now() - 45 * 86400000;
    store.set(KEY.reqs, JSON.stringify(list.filter((r) => new Date(r.createdAt).getTime() > cutoff).slice(-80)));
  }
  function serverStatus(r) { return (state.snap?.requests || []).find((q) => q.id === r.id); }
  function decided(r) { const q = serverStatus(r); return !!q && q.status !== "pending"; }

  function newId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join("");
  }

  function localIso() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function makeRequest(t, action, note) {
    const back = action === "back";
    return {
      id: newId(), transactionId: t.id, code: t.code, action,
      fromStepId: t.stepId || "", fromName: t.stepName || "",
      toStepId: (back ? t.prevId : t.nextId) || "", toName: (back ? t.prevName : t.nextName) || "",
      note: back ? note : "", createdAt: localIso(), sent: false
    };
  }

  async function sendRequest(r) {
    const owner = state.snap?.ownerEmail;
    if (!owner) throw new Error("لا يوجد حساب مستلم في البيانات. حدّث البيانات ثم أعد المحاولة.");
    allowRedirect = false;
    const t = await getToken("");
    const payload = { ...r }; delete payload.sent; delete payload.fileId;
    const boundary = "ashyad" + newId();
    const meta = JSON.stringify({ name: `ashyad-req-${r.id}.json`, mimeType: "application/json" });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;
    const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "multipart/related; boundary=" + boundary }, body
    });
    if (up.status === 401 || up.status === 403) { token = ""; throw new Error("expired"); }
    if (!up.ok) throw new Error("http " + up.status);
    const id = (await up.json()).id;
    const share = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, {
      method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "user", emailAddress: owner })
    });
    if (!share.ok) throw new Error("share " + share.status);
    return id;
  }

  let flushing = false;
  async function flushRequests(quiet) {
    if (flushing) return;
    const list = myRequests();
    if (!list.some((r) => !r.sent)) return;
    flushing = true;
    try {
      for (const r of list.filter((x) => !x.sent)) {
        try {
          r.fileId = await sendRequest(r);
          r.sent = true;
          saveRequests(list);
          if (!quiet) toast("تم إرسال الطلب إلى الديسك توب");
        } catch (e) {
          if (!quiet) toast(e.message === "expired" ? "انتهت الجلسة. اضغط التحديث لتسجيل الدخول ثم يُرسل الطلب." :
            /^(share|http)/.test(e.message) ? "تعذّر إرسال الطلب (" + e.message + ")" : e.message === "Failed to fetch" ? "لا يوجد اتصال. سيُرسل الطلب عند توفر الإنترنت." : e.message);
          break;
        }
      }
    } finally {
      flushing = false;
      if (state.tab === "requests") render();
    }
  }

  function renderRequests(view) {
    const list = myRequests().slice().reverse();
    const pics = window.AshyadPhotos ? AshyadPhotos.list() : [];
    if (!list.length && !pics.length) {
      view.append(el("div", { class: "empty" }, icon.inbox(), el("p", { text: "لا توجد طلبات بعد." }),
        el("small", { text: "افتح أي معاملة واضغط «طلب تقديم» أو «طلب إرجاع»، أو ارفع صورها." })));
      return;
    }
    view.append(el("div", { class: "count", text: "اضغط زر التحديث بالأعلى لمعرفة قرار الديسك توب." }));
    const wrap = el("div", { class: "cards" });
    list.forEach((r, i) => {
      const q = serverStatus(r);
      const [text, cls] = q ? (STATUS_TEXT[q.status] || ["", "wait"]) : (r.sent ? ["تم الإرسال، بانتظار وصوله", "wait"] : ["لم يُرسل بعد (بانتظار الإنترنت)", "queue"]);
      wrap.append(el("div", { class: "rq", style: `animation-delay:${Math.min(i, 8) * 30}ms` },
        el("div", { class: "rq-top" }, el("b", { text: r.code }), el("span", { class: "chip2 " + cls, text: text })),
        el("div", { class: "rq-mid", text: (r.action === "back" ? "إرجاع" : "تقديم") + `: «${r.fromName || "—"}» ← «${r.toName}»` }),
        r.action === "back" && r.note ? el("div", { class: "rq-note", text: "السبب: " + r.note }) : null,
        q?.note ? el("div", { class: "rq-note dec", text: "ملاحظة الديسك توب: " + q.note }) : null,
        el("div", { class: "rq-time", text: fmtTime(r.createdAt.slice(0, 19)) }),
        !r.sent && !q ? el("button", { class: "mini", type: "button", text: "إرسال الآن", onclick: () => flushRequests(false) }) : null));
    });
    view.append(wrap);
    if (pics.length) {
      view.append(el("div", { class: "count", text: "الصور المرسلة" }));
      view.append(el("div", { class: "cards" }, pics.map((b, i) => AshyadPhotos.card(b, i))));
    }
  }

  function requestPanel(t) {
    const box = el("div", { class: "panel req" }, el("h3", { text: "طلب تغيير المرحلة" }));
    const open = myRequests().find((r) => r.transactionId === t.id && !decided(r));
    if (open) {
      box.append(el("div", { class: "req-open", text: `لديك طلب ${open.action === "back" ? "إرجاع" : "تقديم"} قيد الانتظار لهذه المعاملة.` }));
      return box;
    }
    if (!t.nextId && !t.prevId) {
      box.append(el("div", { class: "count", text: "لا توجد مرحلة تالية أو سابقة متاحة." }));
      return box;
    }
    const form = el("div", { class: "req-form" });
    const buttons = el("div", { class: "req-btns" });
    const choose = (action) => {
      buttons.hidden = true;
      form.replaceChildren();
      const back = action === "back";
      const reason = back ? el("textarea", { rows: "3", maxlength: "400", "aria-label": "سبب الإرجاع", }) : null;
      const send = el("button", { type: "button", class: "btn-main", text: "إرسال الطلب" });
      if (back) { send.disabled = true; reason.addEventListener("input", () => { send.disabled = reason.value.trim().length < 3; }); }
      send.addEventListener("click", async () => {
        send.disabled = true;
        const list = myRequests();
        list.push(makeRequest(t, action, back ? reason.value.trim() : ""));
        saveRequests(list);
        const sheetPanel = $("sheet").querySelector(".sheet-panel");
        sheetPanel.replaceChildren(buildSheet(t));
        await flushRequests(false);
        if (!state.snap) return;
        paintTop();
      });
      form.append(
        el("div", { class: "req-ask", text: back ? `إرجاع من «${t.stepName}» إلى «${t.prevName}»` : `تقديم من «${t.stepName}» إلى «${t.nextName}»` }),
        reason,
        el("div", { class: "req-btns" }, send, el("button", { type: "button", class: "btn-ghost", text: "إلغاء", onclick: () => { form.replaceChildren(); buttons.hidden = false; } })));
    };
    if (t.nextId) buttons.append(el("button", { type: "button", class: "btn-main", text: "طلب تقديم إلى «" + t.nextName + "»", onclick: () => choose("advance") }));
    if (t.prevId) buttons.append(el("button", { type: "button", class: "btn-ghost warn", text: "طلب إرجاع إلى «" + t.prevName + "»", onclick: () => choose("back") }));
    box.append(buttons, form, el("div", { class: "count", text: "الطلب يصل إلى الديسك توب ويُنفَّذ بعد موافقة المسؤول." }));
    return box;
  }

  function api() {
    return { el, svg, icon, store, toast, norm, state, fmtTime, trimNum, go, ripple, KEY, myRequests };
  }

  if (window.AshyadPhotos) AshyadPhotos.init({
    api,
    getToken: () => { allowRedirect = false; return getToken(""); },
    expire: () => { token = ""; },
    owner: () => state.snap?.ownerEmail,
    changed: () => { if (state.tab === "requests") render(); }
  });

  // ---- details sheet

  function openSheet(t) {
    const sheet = $("sheet");
    const panel = sheet.querySelector(".sheet-panel");
    panel.replaceChildren(buildSheet(t));
    sheet.hidden = false;
    panel.scrollTop = 0;
    document.body.style.overflow = "hidden";
    try { history.pushState({ sheet: 1 }, ""); } catch (_) { /* ignore */ }
    requestAnimationFrame(() => panel.querySelector(".node.cur")?.scrollIntoView({ inline: "center", block: "nearest" }));
  }

  function closeSheet() {
    $("sheet").hidden = true;
    document.body.style.overflow = "";
  }

  function buildSheet(t) {
    const c = color(t.phase);
    const cur = state.steps.get(t.stepId);

    const facts = [
      ["رقم المعاملة", t.transactionNumber], ["رقم الطلب", t.requestNumber],
      ["الحي", t.neighborhood], ["المحطة", t.station],
      ["الطول", t.lengthM ? trimNum(t.lengthM) + " م" : ""], ["المسح", t.inspectionDone ? "تم المسح" : "لم يتم المسح"],
      ["حالة التصريح", t.permitStatus], ["حالة الكهرباء", t.electricityStatus],
      ["المقاول", t.contractor, true]
    ].filter(([, v]) => v);

    const body = el("div", { class: "sheet-body" });

    if (t.isStale) body.append(el("div", { class: "warn-box", text: `راكدة: لم تتحرك منذ ${t.daysInStep} يوم في «${t.stepName}»` }));

    body.append(el("div", { class: "panel" }, el("h3", { text: "مسار المعاملة" }), stageLine(t, cur),
      t.daysInStep != null ? el("div", { class: "count", text: "في هذه المرحلة " + daysText(t.daysInStep) }) : null));

    body.append(el("div", { class: "panel" }, el("h3", { text: "البيانات" }),
      el("div", { class: "facts" }, facts.map(([k, v, wide]) =>
        el("div", { class: "fact" + (wide ? " wide" : "") }, el("span", { text: k }), el("b", { text: v }))))));

    if (t.notes) body.append(el("div", { class: "panel" }, el("h3", { text: "ملاحظات" }), el("div", { class: "notes", text: t.notes })));

    body.append(requestPanel(t));
    if (window.AshyadPhotos) body.append(AshyadPhotos.panel(t));

    const map = mapLink(t);
    if (map) body.append(el("a", { class: "map-btn", href: map, target: "_blank", rel: "noopener noreferrer" }, icon.pin(), "فتح الموقع على الخريطة"));

    return el("div", {},
      el("div", { class: "sheet-head" },
        el("div", { class: "grab" }),
        el("div", { class: "sheet-title" },
          el("h2", { text: t.code }),
          el("span", { class: "pill", style: "--c:" + c, text: t.stepName }),
          el("button", { class: "x-btn", type: "button", "aria-label": "إغلاق", onclick: () => history.back() }, icon.close()))),
      body);
  }

  function mapLink(t) {
    if (t.mapUrl && /^https?:\/\//i.test(t.mapUrl)) return t.mapUrl;
    if (t.latitude != null && t.longitude != null) return `https://www.google.com/maps?q=${t.latitude},${t.longitude}`;
    return "";
  }

  function stageLine(t, cur) {
    const main = state.main;
    let curIdx = -1;
    if (cur) curIdx = main.findIndex((s) => s.id === (cur.isSide ? cur.anchorId : cur.id));
    const side = !!cur?.isSide;

    const line = el("div", { class: "line" });
    main.forEach((s, i) => {
      const isCur = i === curIdx;
      const done = curIdx >= 0 && i < curIdx;
      const mark = done ? "✓" : isCur && side ? "!" : String(i + 1);
      line.append(el("div", { class: "node" + (done ? " done" : "") + (isCur ? " cur" : "") + (isCur && side ? " side" : "") },
        el("div", { class: "rail" }, el("div", { class: "dot", text: mark })),
        el("span", { class: "nm", text: s.name })));
    });
    return line;
  }

  // ------------------------------------------------------------------ events

  function bind() {
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      state.shown = PAGE;
      render();
      $("view").scrollTop = 0;
    }));

    $("refresh").addEventListener("click", () => refresh(true, ""));
    $("signin").addEventListener("click", () => {
      $("login-msg").textContent = "";
      $("signin").disabled = true;
      startRedirect("select_account");
    });

    $("sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) history.back(); });
    window.addEventListener("popstate", () => { if (!$("sheet").hidden && !(window.AshyadX && AshyadX.popTaken())) closeSheet(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) history.back(); });

    document.querySelector(".top-logo").addEventListener("click", () => {
      if (!confirm("تسجيل الخروج من هذا الجهاز؟")) return;
      try { if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token); } catch (_) { /* ignore */ }
      token = ""; tokenExp = 0;
      [KEY.snap, KEY.file, KEY.signed, KEY.tok].forEach((k) => store.del(k));
      state.snap = null;
      showLogin("تم تسجيل الخروج.", true);
    });

    window.addEventListener("online", () => flushRequests(false));
    const every = Math.max(1, Math.min(2, Number(CFG.refreshMinutes) || 2)) * 60000;
    setInterval(() => { if (!document.hidden && state.snap && store.get(KEY.signed)) refresh(false, ""); }, every);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.snap && store.get(KEY.signed) && Date.now() - state.lastFetch > 60000) refresh(false, "");
    });
  }

  // ------------------------------------------------------------------ start

  function boot() {
    if ("serviceWorker" in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* optional */ });
    }
    bind();

    if (!CFG.clientId) {
      showLogin("لم يُضبط معرّف العميل (clientId) في ملف config.js.");
      $("signin").disabled = true;
      return;
    }

    loadSavedToken();
    const authErr = takeRedirectResult();

    let cached = null;
    try { cached = JSON.parse(store.get(KEY.snap) || "null"); } catch (_) { cached = null; }
    if (cached && cached.transactions) {
      setSnapshot(cached);
      showApp();
      render();
    } else {
      showLogin(authErr);
    }

    if (store.get(KEY.signed) && token) refresh(false, "");
    else if (store.get(KEY.signed) && cached && navigator.onLine !== false) {
      state.problem = "انتهت جلسة الدخول. اضغط زر التحديث لتسجيل الدخول وتحديث البيانات.";
      paintTop();
    }
  }

  boot();
})();
