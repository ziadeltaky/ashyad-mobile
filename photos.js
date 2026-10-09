/* صور المعاملات: ضغط الصور على الجوال ثم رفعها إلى Drive ومشاركتها مع حساب الديسك توب.
   بعد أن ينزّلها الديسك توب (ويكتب ذلك في snapshot.json) يحذفها الجوال من Drive فتتحرر المساحة. */
(() => {
  "use strict";

  const LS = "ashyad.photos";
  const MIN_SURVEY = 2, MAX = 8, MAX_SIDE = 1600, QUALITY = 0.8, KEEP_DAYS = 45;
  const KINDS = { survey: "صور المسح", general: "صور عامة", violation: "صور المخالفة" };
  const THUMB = 220;

  let ctx = null;
  let flushing = false;
  let cleaning = false;

  // ------------------------------------------------------------------ small storage

  const batches = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch (_) { return []; } };
  const saveBatches = (list) => {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const keep = list.filter((b) => !b.cleaned || new Date(b.createdAt).getTime() > cutoff).slice(-60);
    try { localStorage.setItem(LS, JSON.stringify(keep)); } catch (_) { /* full: ignore */ }
  };

  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open("ashyad-photos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("blobs", { keyPath: "key" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction("blobs", mode);
      const out = fn(tx.objectStore("blobs"));
      tx.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  }
  const putBlob = (key, blob) => idb("readwrite", (s) => s.put({ key, blob }));
  const getBlob = (key) => idb("readonly", (s) => s.get(key)).then((r) => r?.blob);
  const delBlob = (key) => idb("readwrite", (s) => s.delete(key));

  // ------------------------------------------------------------------ compression

  async function shrink(file, maxSide, quality) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (_) {
      bmp = await new Promise((res, rej) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
        img.src = url;
      });
    }
    const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, (maxSide || MAX_SIDE) / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", quality || QUALITY));
  }

  const newId = () => (window.crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, "") :
    Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join(""));

  // ------------------------------------------------------------------ upload

  async function authHeader() {
    const t = await ctx.getToken();
    return { Authorization: "Bearer " + t };
  }

  function guard(res) {
    if (res.status === 401) { ctx.expire(); throw new Error("expired"); }
    return res;
  }

  async function uploadOne(b, item) {
    const owner = ctx.owner();
    if (!owner) throw new Error("لا يوجد حساب مستلم في البيانات. حدّث البيانات ثم أعد المحاولة.");
    const h = await authHeader();
    if (!item.fileId) {
      const blob = await getBlob(b.id + ":" + item.n);
      if (!blob) throw new Error("missing");
      const boundary = "ashyad" + newId();
      const meta = JSON.stringify({
        name: `ashyad-photo-${b.id}-${item.n}.jpg`, mimeType: "image/jpeg",
        properties: { batch: b.id, n: String(item.n), total: String(b.total), kind: b.kind, tx: b.tx, code: b.code, note: (b.comment || "").slice(0, 50) }
      });
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`, blob, `\r\n--${boundary}--`]);
      const up = guard(await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST", headers: { ...h, "Content-Type": "multipart/related; boundary=" + boundary }, body
      }));
      if (up.status === 403) { ctx.expire(); throw new Error("expired"); }
      if (!up.ok) throw new Error("http " + up.status);
      item.fileId = (await up.json()).id;
      saveAll();
    }
    if (!item.shared) {
      const sh = guard(await fetch(`https://www.googleapis.com/drive/v3/files/${item.fileId}/permissions?sendNotificationEmail=false`, {
        method: "POST", headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "user", emailAddress: owner })
      }));
      if (!sh.ok) throw new Error("share " + sh.status);
      item.shared = true;
      saveAll();
    }
    await delBlob(b.id + ":" + item.n).catch(() => {});
    item.sent = true;
    saveAll();
  }

  let cache = null;
  function saveAll() { if (cache) saveBatches(cache); }

  function explain(e) {
    const m = e.message || "";
    return m === "expired" ? "انتهت الجلسة. اضغط التحديث لتسجيل الدخول ثم تُرفع الصور." :
      m === "Failed to fetch" ? "لا يوجد اتصال. سترفع الصور عند توفر الإنترنت." :
      /^(share|http)/.test(m) ? "تعذّر رفع الصور (" + m + ")" : m;
  }

  async function flush(quiet) {
    if (flushing || !ctx) return;
    cache = batches();
    if (!cache.some((b) => b.items.some((i) => !i.sent))) return;
    flushing = true;
    try {
      for (const b of cache) {
        for (const item of b.items.filter((i) => !i.sent)) {
          try { await uploadOne(b, item); }
          catch (e) { if (!quiet) ctx.api().toast(explain(e)); return; }
        }
        if (b.items.every((i) => i.sent) && !b.notified) {
          b.notified = true; saveAll();
          if (!quiet) ctx.api().toast("تم رفع الصور وبانتظار الديسك توب");
        }
      }
    } finally {
      flushing = false;
      ctx.changed();
    }
  }

  // ------------------------------------------------------------------ cleanup once the desktop has the photos

  async function reconcile(snap) {
    if (!ctx || cleaning) return;
    const known = new Map((snap?.photoBatches || []).map((p) => [p.id, p]));
    cache = batches();
    let dirty = false;
    for (const b of cache) {
      const s = known.get(b.id);
      if (!s) continue;
      if (b.status !== s.status || (b.note || "") !== (s.note || "")) { b.status = s.status; b.note = s.note || ""; dirty = true; }
    }
    if (dirty) saveAll();
    pruneThumbs();
    const todo = cache.filter((b) => known.has(b.id) && !b.cleaned && b.items.every((i) => i.sent));
    if (!todo.length) return;
    cleaning = true;
    try {
      const h = await authHeader();
      for (const b of todo) {
        let all = true;
        for (const item of b.items) {
          if (item.removed) continue;
          try {
            const r = await fetch(`https://www.googleapis.com/drive/v3/files/${item.fileId}`, { method: "DELETE", headers: h });
            if (r.status === 401) { ctx.expire(); all = false; break; }
            if (r.ok || r.status === 404) item.removed = true; else all = false;
          } catch (_) { all = false; break; }
        }
        if (all) b.cleaned = true;
        saveAll();
      }
    } catch (_) { /* try again at the next refresh */ }
    finally { cleaning = false; ctx.changed(); }
  }

  /** thumbnails of batches that were dropped from the list (older than the keeping time) */
  async function pruneThumbs() {
    try {
      const d = await db();
      const alive = new Set(batches().map((b) => b.id));
      await new Promise((res) => {
        const st = d.transaction("blobs", "readwrite").objectStore("blobs");
        const q = st.openCursor();
        q.onsuccess = () => {
          const c = q.result; if (!c) { res(); return; }
          const m = /^th:([^:]+):/.exec(c.key);
          if (m && !alive.has(m[1])) c.delete();
          c.continue();
        };
        q.onerror = () => res();
      });
    } catch (_) { /* optional */ }
  }

  // ------------------------------------------------------------------ status text

  function statusOf(b) {
    const sent = b.items.filter((i) => i.sent).length;
    if (sent < b.total) return [`جارٍ الرفع (${sent}/${b.total}) — بانتظار الإنترنت`, "queue"];
    if (b.status === "approved") return ["اعتُمد المسح", "ok"];
    if (b.status === "rejected") return ["مرفوض", "no"];
    if (b.status === "received") return [b.kind === "survey" ? "وصلت، بانتظار اعتماد المسح" : "وصلت إلى الديسك توب", b.kind === "survey" ? "wait" : "ok"];
    return ["تم الرفع، بانتظار الديسك توب", "wait"];
  }

  const list = () => batches().slice().reverse();

  function card(el, fmtTime, b, i) {
    const [text, cls] = statusOf(b);
    return el("div", { class: "rq", style: `animation-delay:${Math.min(i, 8) * 30}ms` },
      el("div", { class: "rq-top" }, el("b", { text: b.code }), el("span", { class: "chip2 " + cls, text })),
      el("div", { class: "rq-mid", text: `${KINDS[b.kind]}: ${b.total} صور` }),
      b.comment ? el("div", { class: "rq-note", text: "التعليق: " + b.comment }) : null,
      b.status === "rejected" && b.note ? el("div", { class: "rq-note dec", text: "سبب الرفض: " + b.note }) : null,
      el("div", { class: "rq-time", text: fmtTime(b.createdAt.slice(0, 19)) }),
      b.items.some((i) => !i.sent) ? el("button", { class: "mini", type: "button", text: "إعادة المحاولة", onclick: () => flush(false) }) : null);
  }

  // ------------------------------------------------------------------ screens

  function panel(t, kinds) {
    kinds = kinds || ["survey", "general"];
    const { el, icon } = ctx.api();
    const box = el("div", { class: "panel photos" }, el("h3", { text: "الصور" }));
    const btns = el("div", { class: "req-btns" }, kinds.map((k, i) =>
      el("button", { type: "button", class: i === 0 ? "btn-main" : "btn-ghost", text: KINDS[k], onclick: () => picker(t, k, box) })));
    box.append(btns);
    const mine = batches().filter((b) => b.tx === t.id && kinds.includes(b.kind)).reverse().slice(0, 4);
    mine.forEach((b) => {
      const [text, cls] = statusOf(b);
      const strip = el("div", { class: "ph-strip" });
      box.append(el("div", { class: "ph-line" }, el("span", { text: `${KINDS[b.kind]} (${b.total})` }), el("span", { class: "chip2 " + cls, text })), strip);
      if (b.comment) box.append(el("div", { class: "rq-note", text: b.comment }));
      b.items.forEach((i) => getBlob("th:" + b.id + ":" + i.n).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        strip.append(el("img", { src: url, alt: "", onclick: () => viewer(b, t) }));
      }).catch(() => {}));
    });
    return box;
  }

  /** the sent photos of one batch, larger (the copies kept on this phone) */
  function viewer(b, t) {
    const api = ctx.api();
    window.AshyadX.overlay(api, `${KINDS[b.kind]} — ${t.code}`, (body) => {
      const grid = el0(api, "div", { class: "ph-big" });
      body.append(grid);
      b.items.forEach((i) => getBlob("th:" + b.id + ":" + i.n).then((blob) => { if (blob) grid.append(api.el("img", { src: URL.createObjectURL(blob), alt: "" })); }).catch(() => {}));
    });
  }
  const el0 = (api, tag, props) => api.el(tag, props);

  function picker(t, kind, host) {
    const kinds = kind === "violation" ? ["violation"] : ["survey", "general"];
    const api = ctx.api();
    const { el, toast } = api;
    const survey = kind === "survey";
    const picked = []; // {blob, url}
    window.AshyadX.overlay(api, `${KINDS[kind]} — ${t.code}`, (body, handle) => {
      const grid = el("div", { class: "ph-grid" });
      const count = el("div", { class: "count" });
      const input = el("input", { type: "file", accept: "image/*", multiple: "", hidden: "" });
      const add = el("button", { type: "button", class: "btn-ghost", text: "إضافة صور" });
      const send = el("button", { type: "button", class: "btn-main", text: "إرسال" });
      const confirmBox = el("div", { class: "ph-confirm", hidden: "" });
      const comment = el("input", { type: "text", maxlength: "50", "aria-label": "تعليق" });

      const paint = () => {
        grid.replaceChildren(...picked.map((p, i) => el("div", { class: "ph-th" },
          el("img", { src: p.url, alt: "" }),
          el("button", { type: "button", "aria-label": "حذف", text: "×", onclick: () => { URL.revokeObjectURL(p.url); picked.splice(i, 1); paint(); } }))));
        const n = picked.length;
        count.textContent = survey ? `${n} من ${MAX} (الحد الأدنى ${MIN_SURVEY})` : `${n} من ${MAX}`;
        add.disabled = n >= MAX;
        send.disabled = survey ? n < MIN_SURVEY : n < 1;
      };

      add.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const files = Array.from(input.files || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
        input.value = "";
        add.disabled = true;
        let bad = 0;
        for (const f of files) {
          if (picked.length >= MAX) { toast(`الحد الأقصى ${MAX} صور`); break; }
          try { const blob = await shrink(f); picked.push({ blob, url: URL.createObjectURL(blob) }); } catch (_) { bad++; }
        }
        if (bad) toast("تعذّر قراءة " + bad + " من الصور");
        paint();
      });

      const doSend = async () => {
        send.disabled = true;
        const b = { id: newId(), tx: t.id, code: t.code, kind, total: picked.length, comment: comment.value.trim(), createdAt: (() => {
          const d = new Date(), p = (n) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        })(), items: picked.map((_, i) => ({ n: i + 1, sent: false })) };
        try {
          for (let i = 0; i < picked.length; i++) {
            await putBlob(b.id + ":" + (i + 1), picked[i].blob);
            try { await putBlob("th:" + b.id + ":" + (i + 1), await shrink(picked[i].blob, THUMB, 0.7)); } catch (_) { /* thumbnails are optional */ }
          }
        } catch (_) { toast("تعذّر حفظ الصور على الجهاز"); send.disabled = false; return; }
        const all = batches(); all.push(b); saveBatches(all);
        picked.forEach((p) => URL.revokeObjectURL(p.url));
        picked.length = 0;
        handle.close(false);
        toast("جارٍ رفع الصور...");
        const repaint = () => document.querySelectorAll(".panel.photos").forEach((x) => x.replaceWith(panel(t, kinds)));
        repaint();
        await flush(false);
        repaint();
      };

      send.addEventListener("click", () => {
        if (!survey) { doSend(); return; }
        confirmBox.hidden = false;
        confirmBox.replaceChildren(
          el("div", { class: "req-ask", text: `المعاملة ${t.code} ستُعدّ «تم مسحها» بعد أن يعتمد الديسك توب صور المسح.` }),
          el("div", { class: "req-btns" },
            el("button", { type: "button", class: "btn-main", text: "تأكيد الإرسال", onclick: () => { confirmBox.hidden = true; doSend(); } }),
            el("button", { type: "button", class: "btn-ghost", text: "رجوع", onclick: () => { confirmBox.hidden = true; } })));
      });

      body.append(el("div", { class: "form" }, count, grid, input, el("div", { class: "req-btns" }, add),
        el("label", { class: "fld" }, el("span", { text: "تعليق" }), comment), confirmBox, el("div", { class: "ovl-foot" }, send)));
      paint();
    });
  }

  window.AshyadPhotos = {
    init(c) { ctx = c; },
    panel: (t, kinds) => panel(t, kinds),
    flush, reconcile, list,
    card: (b, i) => card(ctx.api().el, ctx.api().fmtTime, b, i)
  };
})();
