(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let profile = null;
  let settings = null;
  let currentPage = "dashboard";
  let currentTerm = 1;
  const loaded = { lessons: false, activities: false, compliance: false };

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    await G10DataService.init();

    const demo = G10DataService.isDemo();
    $("#demoBanner").classList.toggle("hidden", !demo);
    $("#demoBtn").classList.toggle("hidden", !demo);
    $("#modePill").textContent = demo ? "DEMO" : "LIVE";
    $("#modePill").classList.toggle("demo", demo);

    bindEvents();

    if (!demo) {
      try {
        const restored = await G10DataService.restoreStudentSession();
        if (restored) {
          profile = restored;
          await enterApp();
        }
      } catch (err) {
        console.warn("Could not restore session:", err);
      }
    }
  }

  function bindEvents() {
    $("#loginForm").addEventListener("submit", handleLogin);
    $("#demoBtn").addEventListener("click", () => loginDemo());
    $("#togglePassword").addEventListener("click", togglePassword);
    $("#logoutBtn").addEventListener("click", logout);

    $$(".nav-btn, .mobile-nav-btn, .goto-page").forEach(btn => {
      btn.addEventListener("click", () => navigate(btn.dataset.page));
    });

    $("#termSelect").addEventListener("change", async e => {
      currentTerm = Number(e.target.value);
      loaded.lessons = false;
      loaded.activities = false;
      loaded.compliance = false;
      $("#currentTermText").textContent = `Term ${currentTerm}`;
      $("#complianceTerm").textContent = `Term ${currentTerm}`;
      await loadCurrentPage();
    });

    $$("[data-refresh]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const type = btn.dataset.refresh;
        G10DataService.clearPageCache(type);
        loaded[type] = false;
        await loadCurrentPage(true);
      });
    });

    $$("[data-close-viewer]").forEach(el => {
      el.addEventListener("click", closeViewer);
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("#viewerModal").classList.contains("hidden")) closeViewer();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const id = $("#studentId").value.trim();
    const password = $("#password").value;
    const button = $("#loginBtn");

    setError("");
    setButtonLoading(button, true, "SIGNING IN…");

    try {
      profile = await G10DataService.signInStudent(id, password);
      await enterApp();
    } catch (err) {
      setError(cleanAuthError(err));
    } finally {
      setButtonLoading(button, false, "SIGN IN");
    }
  }

  async function loginDemo() {
    $("#studentId").value = $("#studentId").value || "2026-10001";
    $("#password").value = $("#password").value || "123456";
    profile = await G10DataService.signInStudent($("#studentId").value, $("#password").value);
    await enterApp();
  }

  async function enterApp() {
    settings = await G10DataService.getSettings();
    currentTerm = Number(settings.currentTerm || G10_CONFIG.app.defaultTerm || 1);
    $("#termSelect").value = String(currentTerm);

    renderProfile();
    renderSettings();

    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    navigate("dashboard");
  }

  function renderProfile() {
    const name = profile.fullName || profile.studentId || "Student";
    $("#heroStudentName").textContent = name;
    $("#sideStudentName").textContent = name;
    $("#heroSection").textContent = profile.section || "Grade 10";
    $("#sideSection").textContent = profile.section || "Grade 10";

    const parts = name.split(/\s+/).filter(Boolean);
    $("#avatarInitials").textContent = (parts[0]?.[0] || "S") + (parts[parts.length - 1]?.[0] || "");
  }

  function renderSettings() {
    $("#schoolYearText").textContent = settings.schoolYear || G10_CONFIG.app.schoolYear;
    $("#currentTermText").textContent = `Term ${currentTerm}`;
    $("#latestLessonText").textContent = settings.latestLessonTitle || "Open Lessons to view";
    $("#latestActivityText").textContent = settings.latestActivityTitle || "Open Activities to view";
    $("#announcementText").textContent = settings.announcement || "Welcome to the Grade 10 Arduino learning hub.";
  }

  async function navigate(page) {
    if (!page) return;
    currentPage = page;

    $$(".page").forEach(p => p.classList.remove("active-page"));
    $(`#page-${page}`).classList.add("active-page");

    $$(".nav-btn, .mobile-nav-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.page === page);
    });

    const titles = {
      dashboard: ["Student Portal", "Dashboard"],
      lessons: ["Learning Materials", "Lessons"],
      activities: ["Performance Tasks", "Activities"],
      compliance: ["Published Snapshot", "Compliance"]
    };

    $("#pageEyebrow").textContent = titles[page][0];
    $("#pageTitle").textContent = titles[page][1];

    window.scrollTo({ top: 0, behavior: "instant" });
    await loadCurrentPage();
  }

  async function loadCurrentPage(force = false) {
    if (currentPage === "lessons" && (!loaded.lessons || force)) await loadLessons();
    if (currentPage === "activities" && (!loaded.activities || force)) await loadActivities();
    if (currentPage === "compliance" && (!loaded.compliance || force)) await loadCompliance();
  }

  async function loadLessons() {
    const target = $("#lessonsList");
    renderSkeletons(target, 3);

    try {
      const rows = await G10DataService.getLessons(currentTerm, profile.section);
      loaded.lessons = true;

      if (!rows.length) {
        target.innerHTML = emptyState("No published lessons yet", "Lessons for this term will appear here after your teacher publishes them.");
        return;
      }

      target.innerHTML = rows.map(item => `
        <article class="content-card">
          <div class="file-badge">LESSON ${escapeHtml(String(item.order || ""))}</div>
          <div class="content-card-body">
            <div class="content-meta">TERM ${escapeHtml(String(item.term))} • ${formatFileType(item.fileType)}</div>
            <h3>${escapeHtml(item.title || "Untitled Lesson")}</h3>
            <p>${escapeHtml(item.description || "")}</p>
            <div class="content-foot">
              <small>${item.fileName ? escapeHtml(item.fileName) : "Google Drive file"}</small>
              <button class="primary-small view-file"
                data-kind="lesson"
                data-title="${escapeAttr(item.title || "Lesson")}"
                data-file-id="${escapeAttr(item.fileId || "")}"
                data-file-type="${escapeAttr(item.fileType || "")}">
                VIEW LESSON
              </button>
            </div>
          </div>
        </article>
      `).join("");

      bindFileButtons();
    } catch (err) {
      target.innerHTML = errorState(err);
    }
  }

  async function loadActivities() {
    const target = $("#activitiesList");
    renderSkeletons(target, 3);

    try {
      const rows = await G10DataService.getActivities(currentTerm, profile.section);
      loaded.activities = true;

      if (!rows.length) {
        target.innerHTML = emptyState("No published activities yet", "Published activities for this term will appear here.");
        return;
      }

      target.innerHTML = rows.map(item => `
        <article class="content-card activity-card">
          <div class="file-badge red">TASK ${escapeHtml(String(item.order || ""))}</div>
          <div class="content-card-body">
            <div class="content-meta">${item.dueDate ? `DUE ${escapeHtml(formatDate(item.dueDate))}` : `TERM ${escapeHtml(String(item.term))}`}</div>
            <h3>${escapeHtml(item.title || "Untitled Activity")}</h3>
            <p>${escapeHtml(item.description || "")}</p>
            <div class="content-foot">
              <small>${item.fileName ? escapeHtml(item.fileName) : "Google Drive attachment"}</small>
              <button class="primary-small view-file"
                data-kind="activity"
                data-title="${escapeAttr(item.title || "Activity")}"
                data-file-id="${escapeAttr(item.fileId || "")}"
                data-file-type="${escapeAttr(item.fileType || "")}">
                VIEW ACTIVITY
              </button>
            </div>
          </div>
        </article>
      `).join("");

      bindFileButtons();
    } catch (err) {
      target.innerHTML = errorState(err);
    }
  }

  async function loadCompliance() {
    const target = $("#complianceList");
    target.innerHTML = `<div class="loading-line">Loading your published compliance record…</div>`;

    try {
      const record = await G10DataService.getCompliance(profile.uid, currentTerm);
      loaded.compliance = true;
      $("#complianceTerm").textContent = `Term ${currentTerm}`;
      $("#complianceUpdated").textContent = record.lastUpdated
        ? formatDateTime(record.lastUpdated)
        : "Not yet published";

      const tasks = Array.isArray(record.tasks) ? record.tasks : [];
      if (!tasks.length) {
        $("#missingCount").textContent = "0";
        $("#missingRequirementsCard").classList.remove("hidden");
        $("#missingHeading").textContent = "No requirements published yet";
        $("#missingBadge").textContent = "0";
        $("#missingRequirementsList").innerHTML = `
          <div class="complete-message neutral">
            Your teacher has not published the compliance list for this term yet.
          </div>`;
        target.innerHTML = emptyState("No status published yet", "Your teacher has not published compliance data for this term.");
        return;
      }

      const missingTasks = tasks.filter(isMissingTask);
      $("#missingCount").textContent = String(missingTasks.length);
      $("#missingRequirementsCard").classList.remove("hidden");
      $("#missingBadge").textContent = String(missingTasks.length);

      if (missingTasks.length) {
        $("#missingHeading").textContent = `${missingTasks.length} requirement${missingTasks.length === 1 ? "" : "s"} still need attention`;
        $("#missingRequirementsList").innerHTML = missingTasks.map(task => `
          <article class="missing-item">
            <div class="missing-item-icon">!</div>
            <div class="missing-item-text">
              <strong>${escapeHtml(task.displayName || task.taskName || "Requirement")}</strong>
              <small>${escapeHtml(missingReason(task))}</small>
            </div>
            <span class="missing-status">${escapeHtml(String(task.status || "Missing"))}</span>
          </article>
        `).join("");
      } else {
        $("#missingHeading").textContent = "Complete — No missing requirements";
        $("#missingRequirementsList").innerHTML = `
          <div class="complete-message">
            You currently have no missing requirements for Term ${escapeHtml(String(currentTerm))}.
          </div>`;
      }

      target.innerHTML = tasks.map(task => {
        const band = String(task.percentageBand || "neutral").toLowerCase();
        const status = String(task.status || "pending");
        const score = task.practicalExam && Number.isFinite(Number(task.score))
          ? `<span class="score-pill">${escapeHtml(String(task.score))}/${escapeHtml(String(task.maxScore || ""))}</span>`
          : "";

        return `
          <article class="compliance-row">
            <div class="status-bar band-${escapeAttr(band)}"></div>
            <div class="compliance-task">
              <small>${task.practicalExam ? "PRACTICAL EXAM" : "ACTIVITY"}</small>
              <strong>${escapeHtml(task.displayName || task.taskName || "Task")}</strong>
            </div>
            <div class="compliance-status">
              ${score}
              <span class="status-pill band-${escapeAttr(band)}">${escapeHtml(status)}</span>
            </div>
          </article>
        `;
      }).join("");
    } catch (err) {
      target.innerHTML = errorState(err);
    }
  }


  function isMissingTask(task) {
    if (task && task.missing === true) return true;
    if (task && task.completed === false) return true;

    const status = String((task && task.status) || "").trim().toLowerCase();
    const missingStatuses = [
      "missing",
      "incomplete",
      "not submitted",
      "not-submitted",
      "unsubmitted",
      "no submission",
      "needs completion",
      "for completion",
      "failed to submit",
      "absent"
    ];

    if (missingStatuses.includes(status)) return true;

    // Fallback for older snapshots that only stored a red band.
    // If your real grading system uses red for a low-but-submitted score,
    // set `missing: false` explicitly during sync to prevent it being listed here.
    if (task && task.missing !== false &&
        String(task.percentageBand || "").toLowerCase() === "red" &&
        !Number.isFinite(Number(task.score))) {
      return true;
    }

    return false;
  }

  function missingReason(task) {
    if (task && task.missingReason) return String(task.missingReason);
    const status = String((task && task.status) || "").trim().toLowerCase();

    if (status === "absent") return "Marked absent / requirement not completed.";
    if (status.includes("submit")) return "Submission is still missing.";
    if (status.includes("incomplete") || status.includes("completion")) return "This requirement is not yet complete.";
    return "This requirement still needs to be completed.";
  }

  function bindFileButtons() {
    $$(".view-file").forEach(btn => {
      btn.addEventListener("click", () => openViewer({
        title: btn.dataset.title,
        fileId: btn.dataset.fileId,
        fileType: btn.dataset.fileType,
        kind: btn.dataset.kind
      }));
    });
  }

  function openViewer(file) {
    const modal = $("#viewerModal");
    const body = $("#viewerBody");

    $("#viewerType").textContent = file.kind === "activity" ? "ACTIVITY VIEWER" : "LESSON VIEWER";
    $("#viewerTitle").textContent = file.title || "Document";
    body.innerHTML = `<div class="viewer-loading">Loading selected file…</div>`;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");

    if (!file.fileId) {
      body.innerHTML = `
        <div class="viewer-demo-message">
          <strong>Demo item</strong>
          <p>No Google Drive file ID is attached to this demo record yet.</p>
          <p>In live mode, the selected PDF/image/file will load here only after this button is clicked.</p>
        </div>`;
      return;
    }

    if ((file.fileType || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "viewer-image";
      img.alt = file.title || "Activity image";
      img.loading = "eager";
      img.src = G10DataService.driveImageUrl(file.fileId);
      img.onerror = () => {
        body.innerHTML = `<div class="viewer-demo-message"><strong>Image could not load.</strong><p>Check that the Drive file is shared as “Anyone with the link — Viewer”.</p></div>`;
      };
      body.innerHTML = "";
      body.appendChild(img);
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.className = "viewer-frame";
    iframe.title = file.title || "Google Drive file";
    iframe.src = G10DataService.drivePreviewUrl(file.fileId);
    iframe.setAttribute("allow", "autoplay");
    body.innerHTML = "";
    body.appendChild(iframe);
  }

  function closeViewer() {
    $("#viewerModal").classList.add("hidden");
    $("#viewerBody").innerHTML = "";
    document.body.classList.remove("modal-open");
  }

  async function logout() {
    await G10DataService.logout();
    profile = null;
    settings = null;
    loaded.lessons = loaded.activities = loaded.compliance = false;
    $("#appView").classList.add("hidden");
    $("#loginView").classList.remove("hidden");
    $("#password").value = "";
    setError("");
  }

  function togglePassword() {
    const input = $("#password");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("#togglePassword").textContent = showing ? "Show" : "Hide";
  }

  function setButtonLoading(button, state, label) {
    button.disabled = state;
    button.textContent = label;
  }

  function setError(message) {
    $("#loginError").textContent = message || "";
  }

  function cleanAuthError(err) {
    const code = err && err.code ? String(err.code) : "";
    if (code.includes("wrong-password") || code.includes("invalid-credential") || code.includes("user-not-found")) {
      return "Student ID or password is incorrect.";
    }
    if (code.includes("too-many-requests")) {
      return "Too many login attempts. Please try again later.";
    }
    if (code.includes("network-request-failed")) {
      return "Network error. Check your internet connection.";
    }
    return (err && err.message) || "Unable to sign in.";
  }

  function renderSkeletons(target, count) {
    target.innerHTML = Array.from({ length: count }, () => `
      <div class="skeleton-card">
        <div class="skeleton short"></div>
        <div class="skeleton title"></div>
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>`).join("");
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
  }

  function errorState(err) {
    return `<div class="empty-state error"><strong>Could not load this page.</strong><p>${escapeHtml((err && err.message) || "Unknown error")}</p></div>`;
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(`${value}T00:00:00`);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatDateTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-PH", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatFileType(type) {
    if (!type) return "FILE";
    if (type.includes("pdf")) return "PDF";
    if (type.startsWith("image/")) return "IMAGE";
    return "FILE";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
