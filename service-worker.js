const CACHE_NAME = "mcsian-ict10-portal-shell-v28-student-nav-login-first";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./styles.css?v=28-student-nav-login-first",
  "./firebase-config.js",
  "./demo-data.js?v=28-student-nav-login-first",
  "./data-service.js?v=28-student-nav-login-first",
  "./app.js?v=28-student-nav-login-first",
  "./admin.js?v=28-student-nav-login-first",
  "./pwa.js?v=28-student-nav-login-first",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Do not intercept Firebase, Google, CDN, Apps Script, or Drive requests.
  // Those remain live network requests.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          return caches.match("./index.html");
        }

        throw new Error("Network unavailable and no cached response exists.");
      })
  );
});
