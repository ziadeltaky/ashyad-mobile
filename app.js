/* موقع أشياد للجوال: يقرأ snapshot.json من Google Drive ويعرض مراحل المعاملات. للقراءة فقط. */
(() => {
  "use strict";

  const CFG = window.ASHYAD_CONFIG || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  const KEY = { snap: "ashyad.snapshot", file: "ashyad.fileId", signed: "ashyad.signed", tab: "ashyad.tab", stage: "ashyad.stage" };
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
    tab: store.get(KEY.tab) === "list" ? "list" : "stages",
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

  let tokenClient = null;
  let token = "";
  let tokenExp = 0;
  let pending = null;

  function initAuth() {
    if (tokenClient || !CFG.clientId || !window.google?.accounts?.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending; pending = null;
        if (resp.error) { p?.reject(new Error(resp.error)); return; }
        token = resp.access_token;
        tokenExp = Date.now() + (Number(resp.expires_in || 3600) - 90) * 1000;
        store.set(KEY.signed, "1");
        p?.resolve(token);
      },
      error_callback: (err) => {
        const p = pending; pending = null;
        p?.reject(new Error(err?.type || "popup"));
      }
    });
  }

  window.__gsiReady = initAuth;

  function waitForGoogle() {
    return new Promise((resolve, reject) => {
      let waited = 0;
      const tick = () => {
        initAuth();
        if (tokenClient) return resolve();
        waited += 150;
        if (waited > 10000) return reject(new Error("gsi"));
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  async function getToken(prompt) {
    if (token && Date.now() < tokenExp) return token;
    await waitForGoogle();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: prompt ?? "" });
    });
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
    $("refresh").classList.add("spin");
    try {
      const snap = await loadFromDrive(prompt);
      const changed = !state.snap || state.snap.generatedAt !== snap.generatedAt;
      state.problem = "";
      state.lastFetch = Date.now();
      setSnapshot(snap);
      store.set(KEY.snap, JSON.stringify(snap));
      showApp();
      if (changed) render();
      else paintTop();
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

  function paintTop() {
    const banner = $("banner");
    const when = fmtTime(state.snap?.generatedAt);
    $("top-sub").textContent = when ? "بيانات " + when : "مراحل المعاملات";

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
    if (state.tab === "stages") renderStages(view);
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
    view.append(el("div", { class: "search" }, el("label", {}, input, icon.search()), count), holder);

    function paint() {
      const words = norm(state.query).split(/\s+/).filter(Boolean);
      const list = state.rows.filter((r) => words.every((w) => r.blob.includes(w)))
        .sort((a, b) => a.t.code.localeCompare(b.t.code));
      count.textContent = words.length ? `${list.length} من ${state.rows.length} معاملة` : `${list.length} معاملة`;
      holder.replaceChildren();
      fillCards(holder, list, true, true);
    }
    paint();
  }

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
      store.set(KEY.tab, state.tab);
      render();
      $("view").scrollTop = 0;
    }));

    $("refresh").addEventListener("click", () => refresh(true, ""));
    $("signin").addEventListener("click", async () => {
      const m = $("login-msg");
      m.textContent = "";
      $("signin").disabled = true;
      try {
        await getToken("select_account");
        await refresh(true, "");
      } catch (e) {
        const text = e.message === "gsi" ? "تعذّر تحميل خدمة جوجل. تحقق من الإنترنت." :
          /access_denied|popup_closed/.test(e.message) ? "لم يكتمل تسجيل الدخول." : "تعذّر تسجيل الدخول (" + e.message + ").";
        showLogin(text);
      }
    });

    $("sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) history.back(); });
    window.addEventListener("popstate", () => { if (!$("sheet").hidden) closeSheet(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) history.back(); });

    document.querySelector(".top-logo").addEventListener("click", () => {
      if (!confirm("تسجيل الخروج من هذا الجهاز؟")) return;
      try { if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token); } catch (_) { /* ignore */ }
      token = "";
      [KEY.snap, KEY.file, KEY.signed].forEach((k) => store.del(k));
      state.snap = null;
      showLogin("تم تسجيل الخروج.", true);
    });

    const every = Math.max(1, Number(CFG.refreshMinutes) || 5) * 60000;
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

    let cached = null;
    try { cached = JSON.parse(store.get(KEY.snap) || "null"); } catch (_) { cached = null; }
    if (cached && cached.transactions) {
      setSnapshot(cached);
      showApp();
      render();
    } else {
      showLogin("");
    }

    if (store.get(KEY.signed)) refresh(false, "");
  }

  boot();
})();
