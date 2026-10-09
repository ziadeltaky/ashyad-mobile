// Service worker: يخزّن ملفات الواجهة فقط ليفتح الموقع بسرعة. بيانات المعاملات تأتي دائماً من Drive.
const VERSION = "ashyad-v6";
const FILES = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "icon-192.png", "logo.png", "jszip.min.js", "xlsxtools.js", "consultant.js", "outage.js", "photos.js",
  "consultant_design.xlsx", "consultant_arabtec.xlsx", "outage_d9.xlsx"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // الشبكة أولاً (لتصل التعديلات)، وإن فشلت فالنسخة المخزنة
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
