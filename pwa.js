(() => {
  "use strict";

  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
  }

  function isCoarsePointerDevice() {
    return window.matchMedia("(pointer: coarse)").matches
      || navigator.maxTouchPoints > 0;
  }

  function isPhoneSize() {
    // Phone: shortest physical CSS screen side below 600px.
    // 600px+ short side is treated as tablet, so landscape remains allowed.
    const shortSide = Math.min(
      Number(window.screen?.width || window.innerWidth),
      Number(window.screen?.height || window.innerHeight)
    );

    return isCoarsePointerDevice() && shortSide < 600;
  }

  function isLandscape() {
    return window.matchMedia("(orientation: landscape)").matches
      || window.innerWidth > window.innerHeight;
  }

  function ensureOrientationGuard() {
    let guard = document.getElementById("phoneOrientationGuard");

    if (!guard) {
      guard = document.createElement("div");
      guard.id = "phoneOrientationGuard";
      guard.className = "phone-orientation-guard";
      guard.setAttribute("role", "status");
      guard.setAttribute("aria-live", "polite");
      guard.innerHTML = `
        <div class="phone-orientation-card">
          <div class="phone-orientation-icon" aria-hidden="true">↻</div>
          <strong>Portrait Mode Only</strong>
          <p>Please rotate your phone back to portrait to continue.</p>
        </div>
      `;
      document.body.appendChild(guard);
    }

    return guard;
  }

  function updateOrientationGuard() {
    const blockLandscape = isPhoneSize() && isLandscape();
    const guard = ensureOrientationGuard();

    document.documentElement.classList.toggle(
      "phone-landscape-blocked",
      blockLandscape
    );

    guard.classList.toggle("show", blockLandscape);
  }

  async function tryLockPhonePortrait() {
    if (!isPhoneSize() || !isStandalone()) return;
    if (!screen.orientation || typeof screen.orientation.lock !== "function") return;

    try {
      await screen.orientation.lock("portrait");
    } catch (_) {
      // Not all browsers allow orientation locking.
      // The visual guard remains the reliable fallback.
    }
  }

  function setupInstallButton() {
    const button = document.getElementById("installAppBtn");
    if (!button) return;

    if (isStandalone()) {
      button.classList.add("hidden");
      return;
    }

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      button.classList.remove("hidden");
    });

    button.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;

      button.disabled = true;

      try {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
      } finally {
        deferredInstallPrompt = null;
        button.classList.add("hidden");
        button.disabled = false;
      }
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      button.classList.add("hidden");
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;

    try {
      await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./"
      });
    } catch (error) {
      console.warn("PWA service worker registration failed:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateOrientationGuard();
    setupInstallButton();
    registerServiceWorker();
    tryLockPhonePortrait();

    window.addEventListener("resize", updateOrientationGuard, { passive: true });
    window.addEventListener("orientationchange", () => {
      setTimeout(updateOrientationGuard, 80);
      setTimeout(tryLockPhonePortrait, 120);
    });
  });
})();
