/* أدوات مشتركة للاستشاري والتطفئة: تعديل قالب Excel داخل الجوال (بلا إنترنت) + مشاركة الملف + عناصر واجهة. */
(() => {
  "use strict";

  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const CELL_REF = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

  // ------------------------------------------------------------------ cell values

  const CellText = {
    empty: { text: null, number: null },
    ofText: (s) => ({ text: s, number: null }),
    ofNumber: (n) => ({ text: null, number: String(n) }),
    ofFraction: (d) => ({ text: null, number: String(d) }),
    /** digits only (no leading zero, up to 15) are written as a number, like the consultants typed them */
    from(s) {
      const t = String(s ?? "").trim();
      if (!t) return CellText.empty;
      if (t.length <= 15 && /^[0-9]+$/.test(t) && t[0] !== "0") return { text: null, number: t };
      return { text: t, number: null };
    }
  };

  // ------------------------------------------------------------------ references

  function columnOf(ref) {
    let n = 0;
    for (const ch of ref) {
      if (ch < "A" || ch > "Z") break;
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  }

  function columnName(index) {
    let s = "";
    while (index > 0) {
      index--;
      s = String.fromCharCode(65 + (index % 26)) + s;
      index = Math.floor(index / 26);
    }
    return s;
  }

  function shiftRefs(text, afterRow, count) {
    const bang = text.lastIndexOf("!");
    const head = bang >= 0 ? text.slice(0, bang + 1) : "";
    const tail = bang >= 0 ? text.slice(bang + 1) : text;
    return head + tail.replace(CELL_REF, (m, a, col, b, row) => {
      const r = parseInt(row, 10);
      return a + col + b + (r > afterRow ? r + count : r);
    });
  }

  // ------------------------------------------------------------------ the sheet

  class Sheet {
    constructor(book, doc) {
      this.book = book;
      this.doc = doc;
      this.root = doc.documentElement;
      this.data = Array.from(this.root.children).find((e) => e.localName === "sheetData");
    }

    rows() {
      return Array.from(this.data.children).filter((e) => e.localName === "row")
        .map((e) => ({ n: parseInt(e.getAttribute("r"), 10), el: e }));
    }

    rowElement(n) { return this.rows().find((r) => r.n === n)?.el || null; }

    appendRow(row) { this.data.appendChild(row); }

    static cells(row) { return Array.from(row.children).filter((e) => e.localName === "c"); }

    static clearCell(c) {
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute("t");
    }

    static cloneRow(source, n) {
      const row = source.cloneNode(true);
      row.setAttribute("r", String(n));
      for (const c of Sheet.cells(row)) {
        c.setAttribute("r", columnName(columnOf(c.getAttribute("r"))) + n);
        Sheet.clearCell(c);
      }
      return row;
    }

    insertRowsAfter(afterRow, count, prototype) {
      for (const r of this.rows().filter((x) => x.n > afterRow)) {
        const n = r.n + count;
        r.el.setAttribute("r", String(n));
        for (const c of Sheet.cells(r.el)) c.setAttribute("r", columnName(columnOf(c.getAttribute("r"))) + n);
      }
      let anchor = this.rowElement(afterRow);
      for (let i = 1; i <= count; i++) {
        const clone = Sheet.cloneRow(prototype, afterRow + i);
        anchor.after(clone);
        anchor = clone;
      }
      for (const m of this.root.getElementsByTagNameNS(NS, "mergeCell"))
        m.setAttribute("ref", shiftRefs(m.getAttribute("ref"), afterRow, count));
      for (const cf of Array.from(this.root.children).filter((e) => e.localName === "conditionalFormatting"))
        cf.setAttribute("sqref", shiftRefs(cf.getAttribute("sqref"), afterRow, count));
      this.book.shiftWorkbookRefs(afterRow, count);
    }

    setDimension(ref) {
      Array.from(this.root.children).find((e) => e.localName === "dimension")?.setAttribute("ref", ref);
    }

    replaceInConditionalRanges(pattern, fn) {
      for (const cf of Array.from(this.root.children).filter((e) => e.localName === "conditionalFormatting"))
        cf.setAttribute("sqref", cf.getAttribute("sqref").replace(pattern, fn));
    }

    static setCell(row, column, rowNumber, value) {
      const ref = column + rowNumber;
      let cell = Sheet.cells(row).find((c) => c.getAttribute("r") === ref);
      if (!cell) {
        cell = row.ownerDocument.createElementNS(NS, "c");
        cell.setAttribute("r", ref);
        const idx = columnOf(column);
        const before = Sheet.cells(row).find((c) => columnOf(c.getAttribute("r")) > idx);
        if (before) before.before(cell); else row.appendChild(cell);
      }
      Sheet.clearCell(cell);
      const doc = row.ownerDocument;
      if (value.number != null) {
        const v = doc.createElementNS(NS, "v");
        v.textContent = value.number;
        cell.appendChild(v);
      } else if (value.text != null) {
        cell.setAttribute("t", "inlineStr");
        const is = doc.createElementNS(NS, "is");
        const t = doc.createElementNS(NS, "t");
        t.textContent = value.text;
        if (value.text !== value.text.trim() || value.text.includes("  ")) t.setAttributeNS(XML_NS, "xml:space", "preserve");
        is.appendChild(t);
        cell.appendChild(is);
      }
    }

    static cellStyles(row) {
      const map = new Map();
      for (const c of Sheet.cells(row)) if (c.hasAttribute("s")) map.set(columnOf(c.getAttribute("r")), c.getAttribute("s"));
      return map;
    }

    toXml() {
      const xml = new XMLSerializer().serializeToString(this.doc);
      return xml.startsWith("<?xml") ? xml : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    }
  }

  // ------------------------------------------------------------------ the workbook (a zip)

  class Book {
    static async load(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("تعذّر تحميل قالب الملف (" + res.status + ")");
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const book = new Book(zip);
      let wb = await zip.file("xl/workbook.xml").async("string");
      // the author's own folder path kept by Excel is not carried into the new file
      book.workbookXml = wb.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, "");
      const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
      book.sheet = new Sheet(book, new DOMParser().parseFromString(xml, "application/xml"));
      return book;
    }

    constructor(zip) { this.zip = zip; this.workbookXml = ""; this.sheet = null; }

    replaceInWorkbook(pattern, replacement) {
      this.workbookXml = this.workbookXml.replace(new RegExp(pattern, "g"), () => replacement);
    }

    shiftWorkbookRefs(afterRow, count) {
      this.workbookXml = this.workbookXml.replace(/(<definedName[^>]*>)([^<]*)(<\/definedName>)/g,
        (m, a, b, c) => a + shiftRefs(b, afterRow, count) + c);
    }

    async save() {
      this.zip.file("xl/workbook.xml", this.workbookXml);
      this.zip.file("xl/worksheets/sheet1.xml", this.sheet.toXml());
      return this.zip.generateAsync({
        type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 },
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
    }
  }

  // ------------------------------------------------------------------ small formatting helpers

  const pad = (n) => String(n).padStart(2, "0");

  /** "8", "8:30", "8:30 pm", "8:30م", "14:15" -> minutes after midnight, or null (same rules as the desktop) */
  function parseTime(text) {
    const m = /^\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?\s*(am|pm|a|p|ص|م|صباحا|صباحاً|مساء|مساءً)?\s*$/i.exec(toLatinDigits(text || ""));
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (min > 59 || h > 23) return null;
    const suffix = (m[3] || "").toLowerCase();
    if (suffix) {
      const pm = ["pm", "p", "م", "مساء", "مساءً"].includes(suffix);
      if (h < 1 || h > 12) return null;
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else if (h >= 1 && h <= 6) h += 12; // field work is in daytime: "3" means 3 PM
    return h * 60 + min;
  }

  function toLatinDigits(s) {
    return String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  }

  const h12 = (mins) => { const h = Math.floor(mins / 60) % 24; return h % 12 === 0 ? 12 : h % 12; };
  const ampm = (mins) => (Math.floor(mins / 60) % 24 < 12 ? "AM" : "PM");
  /** "08:30 AM" – the form shown on screen */
  const formatTime = (mins) => `${pad(h12(mins))}:${pad(mins % 60)} ${ampm(mins)}`;
  /** "9:00:00AM" – the form of the outage sheet */
  const oneTime = (mins) => `${h12(mins)}:${pad(mins % 60)}:00${ampm(mins)}`;

  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const serial = (s) => Math.round((Date.UTC(...s.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) - Date.UTC(1899, 11, 30)) / 86400000);

  // ------------------------------------------------------------------ saving / sharing

  function fileFrom(blob, name) {
    return new File([blob], name, { type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function canShareFiles(file) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { return false; }
  }

  async function share(blob, name) {
    const file = fileFrom(blob, name);
    if (!canShareFiles(file)) return false;
    try {
      await navigator.share({ files: [file], title: name.replace(/\.xlsx$/, "") });
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return true; // the person closed the share sheet
      return false;
    }
  }

  // ------------------------------------------------------------------ overlay screens (editors, pickers)

  const overlays = [];
  window.addEventListener("popstate", () => { const top = overlays[overlays.length - 1]; if (top) top.close(true); });

  function overlay(api, title, build) {
    const { el, svg } = api;
    const body = el("div", { class: "ovl-body" });
    const box = el("div", { class: "ovl" },
      el("header", { class: "ovl-head" },
        el("button", { class: "icon-btn", type: "button", "aria-label": "رجوع", onclick: () => history.back() },
          svg('<path d="M9 6l6 6-6 6"/>', 22)),
        el("strong", { text: title })),
      body);
    const handle = {
      body,
      closed: false,
      close(fromPop) {
        if (handle.closed) return;
        handle.closed = true;
        overlays.splice(overlays.indexOf(handle), 1);
        box.classList.add("out");
        setTimeout(() => box.remove(), 180);
        if (!fromPop) { try { history.back(); } catch (_) { /* ignore */ } }
      }
    };
    overlays.push(handle);
    try { history.pushState({ ovl: 1 }, ""); } catch (_) { /* ignore */ }
    document.body.appendChild(box);
    build(body, handle);
    return handle;
  }

  /** closes the top overlay without leaving a dangling history entry */
  function closeTop() { const top = overlays[overlays.length - 1]; if (top) history.back(); }

  /** text input with a list of remembered suggestions */
  function suggestInput(api, { value, list, placeholder, onInput, type }) {
    const { el } = api;
    const id = "dl" + Math.random().toString(36).slice(2, 8);
    const input = el("input", { type: type || "text", value: value || "", placeholder: placeholder || "", autocomplete: "off", list: id, enterkeyhint: "done" });
    input.addEventListener("input", () => onInput && onInput(input.value));
    const dl = el("datalist", { id }, (list || []).map((x) => el("option", { value: x })));
    return el("span", { class: "sg" }, input, dl);
  }

  window.AshyadX = {
    NS, Sheet, Book, CellText, columnOf, columnName, shiftRefs,
    parseTime, formatTime, oneTime, ymd, parseYmd, serial, pad, toLatinDigits,
    download, share, canShareFiles, fileFrom, overlay, closeTop, suggestInput
  };
})();
