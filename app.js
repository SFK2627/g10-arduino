(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let profile = null;
  let settings = null;
  let currentPage = "dashboard";
  let currentTerm = 1;
  const loaded = { announcements: false, lessons: false, activities: false, compliance: false };
  const announcementById = new Map();
  const announcementHeartState = new Map();
  const announcementReadState = new Map();
  let currentAnnouncementRows = [];

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
        const restored = await G10DataService.restoreAccountSession();

        if (restored?.role === "admin") {
          window.location.replace("admin.html");
          return;
        }

        if (restored?.role === "student" && restored.profile) {
          profile = restored.profile;
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
    $("#mobileLogoutBtn").addEventListener("click", logout);
    $("#passwordChangeForm").addEventListener("submit", handlePasswordChange);
    $("#passwordChangeLogoutBtn").addEventListener("click", logoutFromPasswordChange);

    $("#dashboardAnnouncementAttachment").addEventListener("click", () => {
      const button = $("#dashboardAnnouncementAttachment");
      if (!button.dataset.fileId) return;

      openViewer({
        title: button.dataset.title || "Announcement attachment",
        fileId: button.dataset.fileId,
        fileType: button.dataset.fileType || "",
        kind: "announcement"
      });
    });

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
      await refreshDashboardMaterialCards(true);
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

    $("#openComplianceLegendBtn").addEventListener("click", openComplianceLegend);

    $$("[data-close-compliance-legend]").forEach(el => {
      el.addEventListener("click", closeComplianceLegend);
    });

    document.addEventListener("click", async e => {
      const heartButton = e.target.closest(".announcement-heart-btn");
      if (!heartButton) return;
      await handleAnnouncementHeart(heartButton);
    });

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;

      if (!$("#complianceLegendModal").classList.contains("hidden")) {
        closeComplianceLegend();
        return;
      }

      if (!$("#viewerModal").classList.contains("hidden")) {
        closeViewer();
      }
    });
  }

  function openComplianceLegend() {
    $("#complianceLegendModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeComplianceLegend() {
    $("#complianceLegendModal").classList.add("hidden");

    if (
      $("#viewerModal").classList.contains("hidden") &&
      $("#passwordChangeModal").classList.contains("hidden")
    ) {
      document.body.classList.remove("modal-open");
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const identifier = $("#studentId").value.trim();
    const password = $("#password").value;
    const button = $("#loginBtn");

    setError("");
    setButtonLoading(button, true, "SIGNING IN…");

    try {
      const account = await G10DataService.signInAccount(identifier, password);

      if (account.role === "admin") {
        window.location.replace("admin.html");
        return;
      }

      profile = account.profile;
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
    if (requiresPasswordChange()) {
      showPasswordChangeModal();
      return;
    }

    settings = await G10DataService.getSettings(true);
    currentTerm = Number(settings.currentTerm || G10_CONFIG.app.defaultTerm || 1);
    $("#termSelect").value = String(currentTerm);

    renderProfile();
    renderSettings();

    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");

    await Promise.all([
      refreshDashboardMaterialCards(true),
      refreshDashboardAnnouncement(true)
    ]);
    navigate("dashboard");
  }


  function requiresPasswordChange() {
    // New accounts explicitly store true. Legacy imported student profiles
    // without the field are also treated as first-login accounts once.
    return !!profile && profile.mustChangePassword !== false;
  }

  function showPasswordChangeModal() {
    $("#loginView").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#passwordChangeModal").classList.remove("hidden");
    $("#passwordChangeError").textContent = "";
    $("#newStudentPasswordChange").value = "";
    $("#confirmStudentPasswordChange").value = "";
    document.body.classList.add("modal-open");

    setTimeout(() => {
      $("#newStudentPasswordChange").focus();
    }, 50);
  }

  function hidePasswordChangeModal() {
    $("#passwordChangeModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  async function handlePasswordChange(event) {
    event.preventDefault();

    const newPassword = $("#newStudentPasswordChange").value;
    const confirmPassword = $("#confirmStudentPasswordChange").value;
    const button = $("#passwordChangeBtn");
    const error = $("#passwordChangeError");

    error.textContent = "";

    if (newPassword.length < 6) {
      error.textContent = "Your new password must contain at least 6 characters.";
      return;
    }

    if (newPassword === "123456") {
      error.textContent = "123456 is only a temporary password. Please create your own password.";
      return;
    }

    if (newPassword !== confirmPassword) {
      error.textContent = "The passwords do not match.";
      return;
    }

    setButtonLoading(button, true, "SAVING…");

    try {
      profile = await G10DataService.changeStudentPassword(newPassword);
      hidePasswordChangeModal();
      await enterApp();
    } catch (err) {
      const code = err && err.code ? String(err.code) : "";

      if (code.includes("requires-recent-login")) {
        error.textContent = "For security, sign out and sign in again using your current password, then create your new password.";
      } else if (code.includes("weak-password")) {
        error.textContent = "Please create a stronger password with at least 6 characters.";
      } else {
        error.textContent = (err && err.message) || "Unable to change password.";
      }
    } finally {
      setButtonLoading(button, false, "SAVE NEW PASSWORD");
    }
  }

  async function logoutFromPasswordChange() {
    hidePasswordChangeModal();
    await logout();
  }

  function renderProfile() {
    const name = profile.fullName || profile.studentId || "Student";
    $("#heroStudentName").textContent = name;
    $("#sideStudentName").textContent = name;
    $("#heroSection").textContent = profile.section || "Grade 10";
    $("#sideSection").textContent = profile.section || "Grade 10";
    $("#taskStatusStudentName").textContent = name;

    const parts = name.split(/\s+/).filter(Boolean);
    $("#avatarInitials").textContent = (parts[0]?.[0] || "S") + (parts[parts.length - 1]?.[0] || "");
  }

  function renderSettings() {
    $("#schoolYearText").textContent = settings.schoolYear || G10_CONFIG.app.schoolYear;
    $("#currentTermText").textContent = `Term ${currentTerm}`;

    // Dashboard cards are verified against actual student-facing feeds.
    setDashboardMaterialCard("lesson", "");
    setDashboardMaterialCard("activity", "");
    renderDashboardAnnouncement(null);
  }

  function setDashboardMaterialCard(kind, title) {
    const isLesson = kind === "lesson";
    const text = $(`#latest${isLesson ? "Lesson" : "Activity"}Text`);
    if (!text) return;

    const cleanTitle = String(title || "").trim();
    text.textContent = cleanTitle;

    const card = text.closest(".info-card");
    if (card) card.classList.toggle("hidden", !cleanTitle);
  }

  function latestDashboardItem(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;

    // Lesson/activity order is teacher-controlled. The highest display order
    // in the selected term is treated as the current/latest item.
    return rows
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .at(-1) || null;
  }

  async function refreshDashboardMaterialCards(force = false) {
    if (!profile) return;

    // Hide first so stale titles never remain visible while checking.
    setDashboardMaterialCard("lesson", "");
    setDashboardMaterialCard("activity", "");

    const [lessonResult, activityResult] = await Promise.allSettled([
      G10DataService.getLessons(currentTerm, profile.section, force),
      G10DataService.getActivities(currentTerm, profile.section, force)
    ]);

    if (lessonResult.status === "fulfilled") {
      const latest = latestDashboardItem(lessonResult.value);
      setDashboardMaterialCard("lesson", latest?.title || "");
    }

    if (activityResult.status === "fulfilled") {
      const latest = latestDashboardItem(activityResult.value);
      setDashboardMaterialCard("activity", latest?.title || "");
    }
  }



  function announcementDateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function hydrateAnnouncementHearts(posts) {
    const rows = Array.isArray(posts) ? posts : [];
    rows.forEach(post => announcementById.set(post.id, post));

    const states = await G10DataService.getAnnouncementHeartStates(
      rows.map(post => post.id)
    );

    Object.entries(states).forEach(([id, hearted]) => {
      announcementHeartState.set(id, Boolean(hearted));
    });
  }

  function latestAnnouncementByPublishDate(rows) {
    return (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a, b) => {
        const aTime = announcementDateValue(a.publishAt)?.getTime() || 0;
        const bTime = announcementDateValue(b.publishAt)?.getTime() || 0;
        return bTime - aTime;
      })[0] || null;
  }

  async function hydrateAnnouncementReads(posts) {
    const ids = await G10DataService.getAnnouncementReadIds();
    const readIds = new Set(ids);

    (Array.isArray(posts) ? posts : []).forEach(post => {
      announcementReadState.set(post.id, readIds.has(post.id));
    });

    updateAnnouncementUnreadBadges(posts);
  }

  function unreadAnnouncementCount(posts = currentAnnouncementRows) {
    return (Array.isArray(posts) ? posts : [])
      .filter(post => announcementReadState.get(post.id) !== true)
      .length;
  }

  function updateAnnouncementUnreadBadges(posts = currentAnnouncementRows) {
    const count = unreadAnnouncementCount(posts);

    const side = $("#announcementUnreadBadgeSide");
    const mobile = $("#announcementUnreadBadgeMobile");

    [side, mobile].forEach(badge => {
      if (!badge) return;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.toggle("hidden", count === 0);
    });

    const latest = latestAnnouncementByPublishDate(posts);
    const dashboardNew = $("#dashboardAnnouncementNewBadge");

    if (dashboardNew) {
      const latestUnread = latest &&
        announcementReadState.get(latest.id) !== true;

      dashboardNew.classList.toggle("hidden", !latestUnread);
    }
  }

  async function markCurrentAnnouncementsRead(posts) {
    const unread = (Array.isArray(posts) ? posts : [])
      .filter(post => announcementReadState.get(post.id) !== true);

    if (!unread.length) return;

    try {
      await G10DataService.markAnnouncementsRead(unread);
      unread.forEach(post => announcementReadState.set(post.id, true));

      $$(".announcement-new-badge[data-announcement-id]").forEach(badge => {
        if (announcementReadState.get(badge.dataset.announcementId) === true) {
          badge.classList.add("hidden");
        }
      });

      updateAnnouncementUnreadBadges(currentAnnouncementRows);
    } catch (err) {
      console.warn("Could not mark announcements as read:", err);
    }
  }

  function renderDashboardAnnouncement(post) {
    const card = $("#dashboardAnnouncementCard");
    if (!card) return;

    const attachment = $("#dashboardAnnouncementAttachment");

    if (!post) {
      card.classList.add("hidden");
      $("#dashboardAnnouncementTitle").textContent = "";
      $("#dashboardAnnouncementMessage").textContent = "";
      $("#dashboardAnnouncementMeta").textContent = "";
      $("#dashboardAnnouncementNewBadge").classList.add("hidden");
      $("#dashboardAnnouncementHeart").removeAttribute("data-announcement-id");

      attachment.classList.add("hidden");
      attachment.removeAttribute("data-file-id");
      attachment.removeAttribute("data-file-type");
      attachment.removeAttribute("data-title");
      return;
    }

    announcementById.set(post.id, post);

    $("#dashboardAnnouncementTitle").textContent =
      post.title || "Announcement";

    $("#dashboardAnnouncementMessage").textContent =
      post.message || "";

    const publishDate = announcementDateValue(post.publishAt);
    $("#dashboardAnnouncementMeta").textContent = publishDate
      ? `Published ${formatDateTime(publishDate)}`
      : "Published";

    const heart = $("#dashboardAnnouncementHeart");
    heart.dataset.announcementId = post.id;
    updateHeartButtons(post.id, announcementHeartState.get(post.id) === true);

    const isUnread = announcementReadState.get(post.id) !== true;
    $("#dashboardAnnouncementNewBadge").classList.toggle("hidden", !isUnread);

    if (post.fileId) {
      attachment.dataset.fileId = post.fileId;
      attachment.dataset.fileType = post.fileType || "";
      attachment.dataset.title = post.fileName || `${post.title || "Announcement"} attachment`;
      attachment.textContent = post.fileName
        ? `Open: ${post.fileName}`
        : "Open attachment";
      attachment.classList.remove("hidden");
    } else {
      attachment.classList.add("hidden");
      attachment.removeAttribute("data-file-id");
    }

    card.classList.remove("hidden");
  }

  async function refreshDashboardAnnouncement(force = false) {
    if (!profile) return;

    renderDashboardAnnouncement(null);

    try {
      const rows = await G10DataService.getAnnouncements(
        profile.section,
        force
      );

      currentAnnouncementRows = rows;

      if (!rows.length) {
        updateAnnouncementUnreadBadges([]);
        return;
      }

      await Promise.all([
        hydrateAnnouncementHearts(rows),
        hydrateAnnouncementReads(rows)
      ]);

      const latest = latestAnnouncementByPublishDate(rows);
      renderDashboardAnnouncement(latest);
      updateAnnouncementUnreadBadges(rows);
    } catch (err) {
      console.warn("Could not refresh dashboard announcement:", err);
    }
  }

  function announcementPostHtml(post) {
    const publishDate = announcementDateValue(post.publishAt);
    const hearted = announcementHeartState.get(post.id) === true;
    const unread = announcementReadState.get(post.id) !== true;

    const pinnedBadge = post.pinned === true
      ? `<span class="announcement-pinned-badge">PINNED</span>`
      : "";

    const newBadge = `
      <span
        class="announcement-new-badge ${unread ? "" : "hidden"}"
        data-announcement-id="${escapeAttr(post.id)}">
        NEW
      </span>
    `;

    const attachment = post.fileId
      ? `
        <button
          class="secondary-small view-file announcement-attachment-btn"
          data-kind="announcement"
          data-title="${escapeAttr(post.fileName || `${post.title || "Announcement"} attachment`)}"
          data-file-id="${escapeAttr(post.fileId)}"
          data-file-type="${escapeAttr(post.fileType || "")}">
          ${escapeHtml(post.fileName ? `Open: ${post.fileName}` : "Open attachment")}
        </button>
      `
      : "";

    return `
      <article class="announcement-post ${post.pinned === true ? "pinned" : ""}">
        <div class="announcement-post-head">
          <div>
            <div class="announcement-post-badges">
              <div class="card-kicker">ANNOUNCEMENT</div>
              ${pinnedBadge}
              ${newBadge}
            </div>
            <h3>${escapeHtml(post.title || "Announcement")}</h3>
          </div>
          <span class="announcement-date">
            ${escapeHtml(publishDate ? formatDateTime(publishDate) : "Published")}
          </span>
        </div>

        <p class="announcement-post-message">${escapeHtml(post.message || "")}</p>

        ${attachment ? `<div class="announcement-attachment-row">${attachment}</div>` : ""}

        <div class="announcement-post-footer">
          <small>${escapeHtml(post.createdByName || "ICT Teacher")}</small>
          <button
            class="announcement-heart-btn ${hearted ? "hearted" : ""}"
            type="button"
            data-announcement-id="${escapeAttr(post.id)}"
            aria-pressed="${hearted ? "true" : "false"}">
            <span class="heart-symbol">♥</span>
            <span class="heart-label">${hearted ? "Hearted" : "Heart"}</span>
          </button>
        </div>
      </article>
    `;
  }

  async function loadAnnouncements(force = false) {
    const target = $("#announcementsList");
    target.innerHTML = `<div class="loading-line">Loading announcements…</div>`;

    try {
      const rows = await G10DataService.getAnnouncements(
        profile.section,
        force
      );

      currentAnnouncementRows = rows;
      loaded.announcements = true;

      if (!rows.length) {
        target.innerHTML = emptyState(
          "No announcements yet",
          "There are no published announcements for your section right now."
        );
        renderDashboardAnnouncement(null);
        updateAnnouncementUnreadBadges([]);
        return;
      }

      await Promise.all([
        hydrateAnnouncementHearts(rows),
        hydrateAnnouncementReads(rows)
      ]);

      target.innerHTML = rows
        .map(announcementPostHtml)
        .join("");

      bindFileButtons();

      const latest = latestAnnouncementByPublishDate(rows);
      renderDashboardAnnouncement(latest);
      updateAnnouncementUnreadBadges(rows);

      // Opening the Announcements page counts as reading the visible posts.
      // A short delay lets the student actually see the NEW markers first.
      setTimeout(() => {
        if (currentPage === "announcements") {
          markCurrentAnnouncementsRead(rows);
        }
      }, 900);
    } catch (err) {
      target.innerHTML = errorState(err);
    }
  }

  async function handleAnnouncementHeart(button) {
    const announcementId = String(button.dataset.announcementId || "").trim();
    const post = announcementById.get(announcementId);

    if (!announcementId || !post || button.disabled) return;

    button.disabled = true;

    try {
      const hearted = await G10DataService.toggleAnnouncementHeart(post);
      announcementHeartState.set(announcementId, hearted);
      updateHeartButtons(announcementId, hearted);
    } catch (err) {
      alert((err && err.message) || "Could not update your heart reaction.");
    } finally {
      button.disabled = false;
    }
  }

  function updateHeartButtons(announcementId, hearted) {
    $$(`.announcement-heart-btn[data-announcement-id="${cssEscape(announcementId)}"]`)
      .forEach(button => {
        button.classList.toggle("hearted", hearted);
        button.setAttribute("aria-pressed", hearted ? "true" : "false");

        const label = button.querySelector(".heart-label");
        if (label) label.textContent = hearted ? "Hearted" : "Heart";
      });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value || ""));
    }

    return String(value || "").replace(/["\\]/g, "\\$&");
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
      announcements: ["Class Updates", "Announcements"],
      lessons: ["ICT 10", "Lessons"],
      activities: ["ICT 10", "Activities"],
      compliance: ["ICT 10", "Compliance"]
    };

    $("#pageEyebrow").textContent = titles[page][0];
    $("#pageTitle").textContent = titles[page][1];

    window.scrollTo({ top: 0, behavior: "instant" });
    await loadCurrentPage();
  }

  async function loadCurrentPage(force = false) {
    if (currentPage === "dashboard") {
      await Promise.all([
        refreshDashboardMaterialCards(force),
        refreshDashboardAnnouncement(force)
      ]);
    }
    if (currentPage === "announcements" && (!loaded.announcements || force)) {
      await loadAnnouncements(force);
    }
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

  function normalizeActivityAttachments(item) {
    const attachments = Array.isArray(item?.attachments)
      ? item.attachments
          .filter(file => file && file.fileId)
          .slice(0, 5)
      : [];

    if (attachments.length) return attachments;

    // Backward compatibility for Activities made before multi-file support.
    if (item?.fileId) {
      return [{
        fileId: item.fileId,
        fileName: item.fileName || "Google Drive attachment",
        fileType: item.fileType || "",
        fileSize: item.fileSize ?? null
      }];
    }

    return [];
  }

  function activityAttachmentsHtml(item) {
    const attachments = normalizeActivityAttachments(item);

    if (!attachments.length) {
      return `
        <div class="activity-no-attachment">
          <small>No attachment for this activity.</small>
        </div>
      `;
    }

    return `
      <div class="activity-attachments">
        <div class="activity-attachments-head">
          <small>${attachments.length} attachment${attachments.length === 1 ? "" : "s"}</small>
        </div>

        <div class="activity-attachment-buttons">
          ${attachments.map((file, index) => `
            <button class="activity-file-button view-file"
              type="button"
              data-kind="activity"
              data-title="${escapeAttr(
                attachments.length === 1
                  ? (item.title || "Activity")
                  : `${item.title || "Activity"} — Attachment ${index + 1}`
              )}"
              data-file-id="${escapeAttr(file.fileId || "")}"
              data-file-type="${escapeAttr(file.fileType || "")}">
              <span class="activity-file-index">${index + 1}</span>
              <span class="activity-file-copy">
                <strong>${escapeHtml(file.fileName || `Attachment ${index + 1}`)}</strong>
                <small>${escapeHtml(formatFileType(file.fileType || ""))}</small>
              </span>
              <span class="activity-file-open">OPEN</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
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
            ${activityAttachmentsHtml(item)}
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
    target.innerHTML = `<div class="loading-line">Loading compliance status…</div>`;

    try {
      const record = await G10DataService.getCompliance(profile.studentId, currentTerm, true);
      loaded.compliance = true;
      $("#complianceTerm").textContent = `Term ${currentTerm}`;
      $("#complianceUpdated").textContent = record.lastUpdated
        ? formatDateTime(record.lastUpdated)
        : "Not yet published";

      const tasks = Array.isArray(record.tasks) ? record.tasks : [];
      if (!tasks.length) {
        $("#missingCount").textContent = "0";
        $("#totalTaskCount").textContent = "0";
        $("#missingRequirementsCard").classList.remove("hidden");
        $("#missingHeading").textContent = "No requirements published yet";
        $("#missingBadge").textContent = "0";
        $("#missingRequirementsList").innerHTML = `
          <div class="complete-message neutral">
            No task status is available for this term yet.
          </div>`;
        target.innerHTML = emptyState("No status published yet", "No task status is available for this term yet.");
        return;
      }

      const missingTasks = tasks.filter(isMissingTask);
      const storedMissing = Number(record?.summary?.missing);
      const missingCount = Number.isFinite(storedMissing)
        ? storedMissing
        : missingTasks.length;

      $("#missingCount").textContent = String(missingCount);
      $("#totalTaskCount").textContent = String(tasks.length);
      $("#missingRequirementsCard").classList.remove("hidden");
      $("#missingBadge").textContent = String(missingCount);

      if (missingTasks.length) {
        $("#missingHeading").textContent = `${missingCount} requirement${missingCount === 1 ? "" : "s"} still need attention`;
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
        const missing = isMissingTask(task);
        const percent = Number(task?.scorePercent);

        // scorePercent is the source of truth for completed-task colors.
        // percentageBand remains only as a backward-compatible fallback.
        const band = missing
          ? "black"
          : (
              Number.isFinite(percent)
                ? complianceBandFromPercent(percent)
                : String(task.percentageBand || "neutral").toLowerCase()
            );

        const status = missing ? "Missing" : "Completed";

        const taskId = String(task?.taskId || "").toLowerCase();
        const category = String(task?.category || "").toLowerCase();
        const categoryLabel = String(task?.categoryLabel || "").toLowerCase();

        const isTermAssessment =
          category === "ta" ||
          taskId.startsWith("ta") ||
          categoryLabel.includes("term assessment");

        const numericScore = Number(task?.score);
        const numericMaxScore = Number(task?.maxScore);

        const hasScore =
          Number.isFinite(numericScore) &&
          Number.isFinite(numericMaxScore) &&
          numericMaxScore > 0;

        const score = isTermAssessment && hasScore
          ? `<span class="score-pill term-assessment-score">${escapeHtml(formatComplianceScore(numericScore))}/${escapeHtml(formatComplianceScore(numericMaxScore))}</span>`
          : "";

        return `
          <article class="compliance-row band-card-${escapeAttr(band)}">
            <div class="status-bar band-${escapeAttr(band)}"></div>
            <div class="compliance-task">
              <small>${escapeHtml(task.categoryLabel || "ACTIVITY")}</small>
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


  function complianceBandFromPercent(percent) {
    const value = Number(percent);

    if (!Number.isFinite(value)) return "neutral";

    // Universal score bands for WW, PT, and Term Assessment.
    if (value <= 30) return "red";
    if (value <= 69) return "orange";
    if (value <= 84) return "yellow";
    if (value <= 90) return "lime";
    return "green";
  }

  function formatComplianceScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Number.isInteger(number)
      ? String(number)
      : String(Math.round(number * 100) / 100);
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

    return false;
  }

  function missingReason() {
    // Student UI intentionally hides source-system / class-record details.
    return "No score yet.";
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
          <p>No Google Drive file is attached here yet.</p>
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
    hidePasswordChangeModal();
    await G10DataService.logout();
    profile = null;
    settings = null;
    loaded.announcements = loaded.lessons = loaded.activities = loaded.compliance = false;
    currentAnnouncementRows = [];
    announcementById.clear();
    announcementHeartState.clear();
    announcementReadState.clear();
    updateAnnouncementUnreadBadges([]);
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
      return "Student ID/Admin Email or password is incorrect.";
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
    let d;

    if (value && typeof value.toDate === "function") {
      d = value.toDate();
    } else if (value && typeof value.seconds === "number") {
      d = new Date(value.seconds * 1000);
    } else {
      d = new Date(value);
    }

    if (Number.isNaN(d.getTime())) return String(value || "");

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
