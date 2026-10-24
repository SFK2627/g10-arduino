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

  let loginReminderRequested = false;
  let tinkercadLoadSerial = 0;
  let projectReviewLoadSerial = 0;
  const PROJECT_REVIEW_STATUSES = {
    "not-reviewed": "Not Reviewed", "for-checking": "For Checking",
    "checked": "Checked", "needs-revision": "Needs Revision"
  };

  const DEFAULT_LOGIN_REMINDER_POSITIVE =
    "Great! You have no lacking requirements. Keep up the good work and continue maintaining your performance.";

  const DEFAULT_LOGIN_REMINDER_WARNING =
    "The {term} is nearing its end. Please complete the following missing requirements as soon as possible to avoid delays in your subject completion.";

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

          // Firebase keeps the student session active after refresh/reload.
          // Show the reminder again on every portal load while the student
          // is still authenticated.
          loginReminderRequested = true;

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

    $("#closeStudentLoginReminderBtn").addEventListener("click", closeStudentLoginReminder);
    $("#studentLoginReminderContinueBtn").addEventListener("click", closeStudentLoginReminder);
    $("#studentLoginReminderPlayMusicBtn").addEventListener("click", playStudentLoginReminderMusic);

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
      $("#complianceGradeTerm").textContent = `TERM ${currentTerm}`;
      await Promise.all([
        refreshDashboardMaterialCards(true),
        refreshDashboardRunningGrade(true)
      ]);
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

    $("#tcStudentRefreshBtn").addEventListener("click", () => {
      void Promise.all([loadTinkercadAccess(true), loadStudentProjectReviews(true)]);
    });
    $("#pmStudentRefresh").addEventListener("click", () => loadStudentProjectReviews(true));
    $("#tcStudentAccess").addEventListener("click", handleTinkercadAction);

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

      if (!$("#studentLoginReminderModal").classList.contains("hidden")) {
        closeStudentLoginReminder();
        return;
      }

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
      loginReminderRequested = true;
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
    loginReminderRequested = true;
    await enterApp();
  }

  async function enterApp() {
    if (requiresPasswordChange()) {
      showPasswordChangeModal();
      return;
    }

    // As soon as authentication succeeds, replace Login with a loading gate.
    // The Dashboard must not be painted before the login reminder is visible.
    const reminderRequested = loginReminderRequested;
    if (reminderRequested) {
      $("#studentLoginPreparing").classList.remove("hidden");
      $("#loginView").classList.add("hidden");
      $("#appView").classList.add("hidden");
    }

    try {
      settings = await G10DataService.getSettings(true);
    } catch (err) {
      $("#studentLoginPreparing").classList.add("hidden");
      $("#loginView").classList.remove("hidden");
      throw err;
    }
    currentTerm = Number(settings.currentTerm || G10_CONFIG.app.defaultTerm || 1);
    $("#termSelect").value = String(currentTerm);

    renderProfile();
    renderSettings();
    loginReminderRequested = false;

    if (reminderRequested && studentReminderSettings().enabled && profile?.studentId) {
      try {
        // Only compliance/reminder data is required here. Other dashboard
        // requests do not block the reminder's appearance.
        if (await maybeShowStudentLoginReminder()) return;
      } catch (err) {
        console.warn("Login reminder could not be prepared:", err);
      }
    }

    revealStudentPortal();
  }

  function revealStudentPortal() {
    $("#studentLoginPreparing").classList.add("hidden");
    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    // Start the dashboard immediately; do not force multiple sequential
    // refreshes before students can interact with their portal.
    void navigate("dashboard").catch(err => console.warn("Dashboard loading failed:", err));
    void refreshDashboardRunningGrade(false).catch(err => console.warn("Running grade loading failed:", err));
  }



  function termDisplayName(term) {
    const value = Number(term);
    if (value === 1) return "First Term";
    if (value === 2) return "Second Term";
    if (value === 3) return "Third Term";
    return `Term ${value || 1}`;
  }

  function reminderMessageTemplate(value, fallback) {
    return String(value || fallback || "")
      .replace(/\{term\}/gi, termDisplayName(currentTerm))
      .replace(/\{name\}/gi, profile?.fullName || profile?.studentId || "Student");
  }

  let studentReminderTracks = [];
  let studentReminderTrackIndex = -1;
  let studentReminderShuffle = true;

  function studentReminderSettings() {
    return {
      enabled: settings?.loginReminderEnabled !== false,
      musicEnabled: settings?.loginReminderMusicEnabled === true,
      musicShuffle: settings?.loginReminderMusicShuffle !== false,
      musicUrls: G10MusicPlaylist.normalize(
        Array.isArray(settings?.loginReminderMusicUrls) && settings.loginReminderMusicUrls.length
          ? settings.loginReminderMusicUrls : [settings?.loginReminderMusicUrl || ""]
      ),
      positiveMessage: reminderMessageTemplate(
        settings?.loginReminderPositiveMessage,
        DEFAULT_LOGIN_REMINDER_POSITIVE
      ),
      warningMessage: reminderMessageTemplate(
        settings?.loginReminderWarningMessage,
        DEFAULT_LOGIN_REMINDER_WARNING
      )
    };
  }

  async function maybeShowStudentLoginReminder() {
    const reminder = studentReminderSettings();
    if (!reminder.enabled || !profile?.studentId) return false;

    let record = null;
    let loadError = null;

    try {
      // Never leave a student on an endless loading screen if the connection
      // stalls. Show a useful fallback reminder after the timeout instead.
      record = await Promise.race([
        G10DataService.getCompliance(profile.studentId, currentTerm, true),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("The grade check is taking longer than expected.")), 9000
        ))
      ]);
    } catch (err) {
      loadError = err;
      console.warn("Could not load Login Reminder compliance:", err);
    }

    const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
    const missingTasks = tasks.filter(isMissingTask);

    renderStudentLoginReminder({
      missingTasks,
      reminder,
      record,
      loadError
    });

    $("#studentLoginReminderModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    animateStudentGradeTrend("studentReminderGrade");

    if (reminder.musicEnabled && reminder.musicUrls.length) {
      // Autoplay is optional and must never delay or block modal display.
      void startLoginReminderAudio(
        $("#studentLoginReminderAudio"),
        $("#studentLoginReminderPlayMusicBtn"),
        reminder.musicUrls, reminder.musicShuffle
      );
    } else {
      stopLoginReminderAudio(
        $("#studentLoginReminderAudio"),
        $("#studentLoginReminderPlayMusicBtn")
      );
    }
    return true;
  }

  function renderStudentLoginReminder({ missingTasks, reminder, record, loadError }) {
    const dialog = $("#studentLoginReminderDialog");
    const title = $("#studentLoginReminderTitle");
    const meta = $("#studentLoginReminderMeta");
    const icon = $("#studentLoginReminderIcon");
    const statusTitle = $("#studentLoginReminderStatusTitle");
    const message = $("#studentLoginReminderMessage");
    const missingSection = $("#studentLoginReminderMissingSection");
    const missingCount = $("#studentLoginReminderMissingCount");
    const list = $("#studentLoginReminderList");

    dialog.classList.remove("is-positive", "is-warning", "is-neutral");

    const studentName = profile?.fullName || profile?.studentId || "Student";
    meta.textContent = `${studentName} • ${termDisplayName(currentTerm)}`;
    $("#studentReminderGradeTerm").textContent = `TERM ${currentTerm}`;
    showStudentGrade(record, "studentReminderGrade", loadError);
    if (!loadError) showStudentGrade(record, "dashboardGrade");

    if (loadError) {
      dialog.classList.add("is-neutral");
      icon.textContent = "i";
      title.textContent = "Requirements Reminder";
      statusTitle.textContent = "Your current status could not be loaded.";
      message.textContent =
        "You can continue to the portal and open Compliance to check your latest requirement status.";
      missingSection.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    if (!Array.isArray(record?.tasks) || !record.tasks.length) {
      dialog.classList.add("is-neutral");
      icon.textContent = "i";
      title.textContent = "Academic Update";
      statusTitle.textContent = "No requirements published for this term yet.";
      message.textContent = "Your running grade will appear above after your teacher publishes an update.";
      missingSection.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    if (!missingTasks.length) {
      dialog.classList.add("is-positive");
      icon.textContent = "✓";
      title.textContent = "Great Work!";
      statusTitle.textContent = "You have no lacking requirements.";
      message.textContent = reminder.positiveMessage;
      missingSection.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    dialog.classList.add("is-warning");
    icon.textContent = "!";
    title.textContent = "Action Needed";
    statusTitle.textContent =
      `${missingTasks.length} missing requirement${missingTasks.length === 1 ? "" : "s"}`;
    message.textContent = reminder.warningMessage;

    missingCount.textContent = String(missingTasks.length);
    missingSection.classList.remove("hidden");

    list.innerHTML = missingTasks.map((task, index) => {
      const category = String(
        task?.categoryLabel ||
        task?.category ||
        task?.taskId ||
        "Requirement"
      ).trim();

      return `
        <article class="login-reminder-list-item">
          <span class="login-reminder-list-no">${index + 1}</span>
          <div>
            <small>${escapeHtml(category)}</small>
            <strong>${escapeHtml(task?.displayName || task?.taskName || "Requirement")}</strong>
          </div>
          <span class="login-reminder-missing-pill">Missing</span>
        </article>
      `;
    }).join("");
  }

  async function startLoginReminderAudio(audio, playButton, urls, shuffleEnabled) {
    stopLoginReminderAudio(audio, playButton);
    if (!audio || !playButton) return;
    studentReminderShuffle = shuffleEnabled !== false;
    const initial = G10MusicPlaylist.startPlayback(urls, studentReminderShuffle);
    studentReminderTracks = initial.tracks;
    studentReminderTrackIndex = initial.index;
    if (!studentReminderTracks.length) return;

    audio.onended = () => {
      if ($("#studentLoginReminderModal").classList.contains("hidden")) return;
      const next = G10MusicPlaylist.advancePlayback(
        studentReminderTracks, studentReminderTrackIndex, studentReminderShuffle
      );
      studentReminderTracks = next.tracks;
      studentReminderTrackIndex = next.index;
      void playStudentReminderCurrentTrack();
    };
    await playStudentReminderCurrentTrack();
  }

  async function playStudentReminderCurrentTrack() {
    const audio = $("#studentLoginReminderAudio");
    const button = $("#studentLoginReminderPlayMusicBtn");
    const url = studentReminderTracks[studentReminderTrackIndex];
    if (!audio || !button || !url) return;
    if (audio.getAttribute("src") !== url) audio.src = url;
    audio.loop = false;
    audio.volume = 0.45;
    try {
      await audio.play();
      button.classList.add("hidden");
    } catch (_) {
      button.classList.remove("hidden");
      button.textContent = "▶ Play Music";
    }
  }

  async function playStudentLoginReminderMusic() {
    const reminder = studentReminderSettings();
    if (!reminder.musicEnabled || !reminder.musicUrls.length) {
      $("#studentLoginReminderPlayMusicBtn").classList.add("hidden");
      return;
    }
    if (!studentReminderTracks.length) {
      await startLoginReminderAudio(
        $("#studentLoginReminderAudio"),
        $("#studentLoginReminderPlayMusicBtn"),
        reminder.musicUrls, reminder.musicShuffle
      );
    } else {
      await playStudentReminderCurrentTrack();
    }
  }

  function stopLoginReminderAudio(audio, playButton) {
    studentReminderTracks = [];
    studentReminderTrackIndex = -1;
    if (audio) {
      audio.onended = null;
      audio.pause();
      try { audio.currentTime = 0; } catch (_) {}
      audio.removeAttribute("src");
      audio.load();
    }
    if (playButton) {
      playButton.classList.add("hidden");
      playButton.textContent = "▶ Play Music";
    }
  }

  function closeStudentLoginReminder() {
    $("#studentLoginReminderModal").classList.add("hidden");
    stopLoginReminderAudio(
      $("#studentLoginReminderAudio"),
      $("#studentLoginReminderPlayMusicBtn")
    );

    if (
      $("#passwordChangeModal").classList.contains("hidden") &&
      $("#complianceLegendModal").classList.contains("hidden") &&
      $("#viewerModal").classList.contains("hidden")
    ) {
      document.body.classList.remove("modal-open");
    }
    // Only now unhide the portal: no Dashboard flash before the reminder.
    if (profile && $("#appView").classList.contains("hidden")) {
      revealStudentPortal();
    }
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
    // If the grade arrived while this page was hidden, reveal its arrow once
    // when the student first opens the card.
    if (page === "dashboard") animateStudentGradeTrend("dashboardGrade");
    if (page === "compliance") animateStudentGradeTrend("complianceGrade");

    $$(".nav-btn, .mobile-nav-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.page === page);
    });

    const titles = {
      dashboard: ["Student Portal", "Dashboard"],
      announcements: ["Class Updates", "Announcements"],
      lessons: ["ICT 10", "Lessons"],
      activities: ["ICT 10", "Activities"],
      compliance: ["ICT 10", "Compliance"],
      tinkercad: ["ICT 10", "Tinkercad Access"]
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
    if (currentPage === "tinkercad") {
      await Promise.all([loadTinkercadAccess(force), loadStudentProjectReviews(force)]);
    }
  }


  async function loadTinkercadAccess(force = false) {
    const target = $("#tcStudentAccess");
    if (!profile) return;
    const serial = ++tinkercadLoadSerial;
    target.innerHTML = '<div class="tc-student-placeholder">Loading your Tinkercad classroom…</div>';
    try {
      const classroom = await G10DataService.getTinkercadClassroom();
      if (serial !== tinkercadLoadSerial || !profile) return;
      if (!classroom) {
        target.innerHTML = emptyState("Tinkercad classroom not active", "Your teacher will publish the class invitation link in Arduino Hub.");
        return;
      }
      // The authenticated student's OWN Firebase profile supplies the actual
      // Tinkercad seat nickname. Keep Student ID formatting including hyphens.
      const loginCode = String(profile.studentId || "").trim();
      if (!loginCode) {
        target.innerHTML = emptyState("Student ID unavailable", "Contact your teacher to correct your Student ID in Arduino Hub.");
        return;
      }
      const tinkercadLink = safeTinkercadClassLink(classroom.classLink);
      target.innerHTML = `
        <article class="tc-student-card">
          <div class="tc-student-card-head">
            <div><span class="card-kicker">YOUR TINKERCAD CLASS SEAT</span><h3>${escapeHtml(profile.fullName || "Student")}</h3></div>
            <span class="tc-status-ready">Class details available</span>
          </div>
          <div class="tc-credential-grid">
            <div class="tc-credential"><small>CLASS CODE</small><strong id="tcStudentClassValue">${escapeHtml(classroom.classCode)}</strong><button class="mini-btn" type="button" data-tc-copy="class">Copy Class Code</button></div>
            <div class="tc-credential"><small>YOUR STUDENT LOGIN / NICKNAME</small><strong id="tcStudentLoginValue">${escapeHtml(loginCode)}</strong><button class="mini-btn" type="button" data-tc-copy="login">Copy Student Login</button><span class="tc-student-id-note">Automatically taken from your Student ID (hyphens preserved).</span></div>
          </div>
          <p id="tcStudentActionStatus" class="tc-student-feedback" role="status"></p>
          <a class="primary-btn tc-launch-button" href="${escapeAttr(tinkercadLink)}" target="_blank" rel="noopener noreferrer">Open Tinkercad Class ↗</a>
          <div class="tc-student-help"><strong>How to log in:</strong> Open the class link, choose the Class Seat / Student Login option, and enter your Student Login exactly as shown. These details must match the seat already created by your teacher on Tinkercad. Arduino Hub does not automatically sign you in to Autodesk.</div>
          <p class="tc-student-privacy">Use only your own seat and sign out on shared computers. If Tinkercad does not recognize your Student ID, tell your teacher.</p>
        </article>`;
    } catch (err) {
      if (serial !== tinkercadLoadSerial) return;
      const message = String(err?.code || "").includes("permission-denied")
        ? "Cannot read the classroom setting. Ask your teacher to check Firestore settings permissions."
        : (err?.message || "Unable to load your classroom.");
      target.innerHTML = errorState(new Error(message));
    }
  }

  // Teacher-maintained project reviews, NOT a Tinkercad project sync.
  // Every review is read by exact Firebase UID; students never list peers.
  async function loadStudentProjectReviews() {
    const target = $("#pmStudentList");
    const serial = ++projectReviewLoadSerial;
    const term = currentTerm;
    const currentProfile = profile;
    if (!currentProfile) return;
    if (G10DataService.isDemo()) {
      target.textContent = "Review tracking requires your live student account.";
      return;
    }
    target.innerHTML = '<p class="pm-muted">Loading your teacher’s project reviews…</p>';
    try {
      const database = G10DataService.getFirebaseHandles().db;
      const activitySnap = await database.collection("tinkercadProjectTasks").get();
      if (serial !== projectReviewLoadSerial || currentProfile !== profile || term !== currentTerm) return;
      const section = String(currentProfile.section || "").trim().replace(/\s+/g, " ");
      const tasks = activitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(task => task.active === true && Number(task.term) === term &&
          (task.section === "ALL_SECTIONS" || String(task.section || "").trim().replace(/\s+/g, " ") === section))
        .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
      if (!tasks.length) {
        target.innerHTML = '<p class="pm-muted">Your teacher has not published any project review activities for this term yet.</p>';
        return;
      }
      const details = await Promise.all(tasks.map(async task => {
        const snap = await database.collection("tinkercadProjectReviews").doc(task.id)
          .collection("students").doc(currentProfile.uid).get();
        return { task, review: snap.exists ? snap.data() : {} };
      }));
      if (serial !== projectReviewLoadSerial || currentProfile !== profile || term !== currentTerm) return;
      target.innerHTML = details.map(({ task, review }) => {
        const status = PROJECT_REVIEW_STATUSES[review?.status] ? review.status : "not-reviewed";
        const note = String(review?.note || "").trim();
        let date = "";
        if (review?.reviewedAt?.toDate) {
          date = review.reviewedAt.toDate().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        }
        return `<article class="pm-student-review-card">
          <div class="pm-student-review-card-head"><h4>${escapeHtml(task.title || "Arduino activity")}</h4><span class="pm-chip pm-${status}">${escapeHtml(PROJECT_REVIEW_STATUSES[status])}</span></div>
          ${note ? `<p class="pm-feedback-note"><strong>Teacher feedback:</strong> ${escapeHtml(note)}</p>` : ""}
          ${date ? `<small class="pm-review-date">Last reviewed: ${escapeHtml(date)}</small>` : ""}
        </article>`;
      }).join("") + '<p class="pm-muted pm-review-disclaimer">Review statuses are updated by your teacher. Your actual saved circuits are on Tinkercad; “Not Reviewed” does not mean you have not submitted a project.</p>';
    } catch (err) {
      if (serial !== projectReviewLoadSerial) return;
      target.textContent = String(err?.code || "").includes("permission-denied")
        ? "Project reviews are temporarily unavailable. Ask your teacher to deploy the updated Firestore Rules."
        : "Unable to load your reviews. Please refresh or try again later.";
    }
  }

  function safeTinkercadClassLink(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol === "https:" && ["www.tinkercad.com", "tinkercad.com"].includes(url.hostname) &&
          /^\/joinclass\/[A-Za-z0-9]{5,20}\/?$/.test(url.pathname)) return url.href;
    } catch (_) {}
    return "https://www.tinkercad.com/";
  }

  async function handleTinkercadAction(event) {
    const copy = event.target.closest("[data-tc-copy]");
    if (!copy) return;
    const code = copy.dataset.tcCopy === "login"
      ? $("#tcStudentLoginValue")?.textContent
      : $("#tcStudentClassValue")?.textContent;
    const status = $("#tcStudentActionStatus");
    if (!code || !status) return;
    try {
      await navigator.clipboard.writeText(code);
      status.textContent = "Copied! Paste it into Tinkercad's Class Seat login.";
    } catch (_) {
      status.textContent = "Copy is unavailable. Select the visible text to copy manually.";
    }
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
    const rows = Array.isArray(item?.attachments)
      ? item.attachments
      : [];

    const attachments = [];
    const seen = new Set();

    rows.forEach(file => {
      const fileId = String(file?.fileId || "").trim();
      if (!fileId || seen.has(fileId) || attachments.length >= 5) return;

      seen.add(fileId);
      attachments.push({
        fileId,
        fileName: String(file?.fileName || `Attachment ${attachments.length + 1}`),
        fileType: String(file?.fileType || ""),
        fileSize: file?.fileSize ?? null
      });
    });

    if (attachments.length) return attachments;

    // Backward compatibility for Activities made before multi-file support.
    const legacyFileId = String(item?.fileId || "").trim();
    if (legacyFileId) {
      return [{
        fileId: legacyFileId,
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
          <small>${attachments.length} / 5 attachment${attachments.length === 1 ? "" : "s"}</small>
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

  // Animate only the first visible appearance of a valid grade movement.
  // The animation never changes the underlying comparison or grade value.
  const animatedStudentGradeTrends = new Set();

  function animateStudentGradeTrend(prefix) {
    const pill = $(`#${prefix}Trend`);
    const trend = pill?.dataset.trend;
    if (!pill || !["improved", "declined", "unchanged"].includes(trend)) return;
    if (pill.classList.contains("hidden") || !pill.getClientRects().length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const key = `${profile?.studentId || "student"}:${currentTerm}:${prefix}:${trend}`;
    if (animatedStudentGradeTrends.has(key)) return;

    // Remove the animation class after the arrow settles so reopening a
    // hidden Dashboard/Compliance page does not replay a completed animation.
    if (!pill.dataset.trendAnimationCleanupBound) {
      pill.addEventListener("animationend", event => {
        if (event.target?.classList?.contains("grade-trend-arrow")) {
          pill.classList.remove("grade-trend-animate");
        }
      });
      pill.dataset.trendAnimationCleanupBound = "true";
    }

    // Animate after the modal/card has actually become visible.
    window.requestAnimationFrame(() => {
      if (!pill.isConnected || !pill.getClientRects().length ||
          pill.dataset.trend !== trend || animatedStudentGradeTrends.has(key)) return;
      animatedStudentGradeTrends.add(key);
      pill.classList.add("grade-trend-animate");
    });
  }

  /** This is a display of the last published grade, not a live recalculation. */
  function gradeAsOfLabel(record) {
    const published = record?.publishedAt || record?.lastUpdated;
    if (!published) return "As of the latest published update (date unavailable)";

    let date;
    if (typeof published.toDate === "function") date = published.toDate();
    else if (typeof published.seconds === "number") date = new Date(published.seconds * 1000);
    else date = new Date(published);

    if (!Number.isFinite(date.getTime())) {
      return "As of the latest published update (date unavailable)";
    }
    return `As of ${date.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true
    })} (PH time)`;
  }

  function studentGradeView(record) {
    const status = String(record?.gradeStatus || "").trim().toUpperCase();
    const type = String(record?.gradeType || "").trim().toLowerCase();
    const value = record?.termGrade;
    const label = "RUNNING GRADE";
    const asOf = gradeAsOfLabel(record);

    if (status === "INC" || type === "incomplete") {
      return { label, value: status || "INC",
        note: `Incomplete standing • ${asOf}. Check your missing requirements.` };
    }
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) {
      const number = Number(value);
      const text = String(Math.round(number * 100) / 100);
      return { label, value: text,
        note: `${asOf}${type === "provisional" ? " • Pending confirmation" : ""}` };
    }
    return { label, value: "—",
      note: "Not yet available. Your teacher needs to publish an updated grade." };
  }

  function showStudentGrade(record, prefix, loadError = null) {
    const grade = loadError
      ? { label: "RUNNING GRADE", value: "—", note: "Unable to load right now. Please refresh." }
      : studentGradeView(record);
    $(`#${prefix}Label`).textContent = grade.label;
    $(`#${prefix}Value`).textContent = grade.value;
    $(`#${prefix}Note`).textContent = grade.note;

    const pill = $(`#${prefix}Trend`);
    if (pill) {
      const trend = loadError ? null : G10GradeTrend.forDisplay(record, currentTerm);
      const oldTrend = pill.dataset.trend || "";
      const changed = oldTrend !== trend || pill.dataset.term !== String(currentTerm);
      pill.classList.remove("improved", "declined", "unchanged", "unavailable");
      if (changed) pill.classList.remove("grade-trend-animate");
      const options = {
        improved: { symbol: "↑", label: "Improved" },
        declined: { symbol: "↓", label: "Declined" },
        unchanged: { symbol: "→", label: "Unchanged" },
        unavailable: { symbol: "—", label: "No comparison" }
      };
      const detail = trend ? options[trend] : null;
      pill.dataset.trend = detail ? trend : "";
      pill.dataset.term = String(currentTerm);
      pill.classList.toggle("hidden", !detail);
      // Reusing the arrow node prevents the CSS animation from replaying
      // when the same grade is fetched again during one portal session.
      if (changed || !pill.firstElementChild) {
        pill.replaceChildren();
        if (detail) {
          const arrow = document.createElement("span");
          arrow.className = "grade-trend-arrow";
          arrow.setAttribute("aria-hidden", "true");
          arrow.textContent = detail.symbol;
          const label = document.createElement("span");
          label.className = "grade-trend-text";
          label.textContent = detail.label;
          pill.append(arrow, label);
        }
      }
      if (detail) pill.classList.add(trend);
      pill.title = detail ? (trend === "unavailable"
        ? `No valid Term ${currentTerm - 1} grade is available for comparison`
        : `${detail.label} compared with Term ${currentTerm - 1}`) : "";
      pill.setAttribute("aria-label", detail ? (trend === "unavailable"
        ? `No valid Term ${currentTerm - 1} grade for comparison`
        : `${detail.label} since Term ${currentTerm - 1}`) : "No previous-term comparison");
      animateStudentGradeTrend(prefix);
    }
  }

  async function refreshDashboardRunningGrade(force = false) {
    const termAtRequest = currentTerm;
    $("#dashboardGradeTerm").textContent = `TERM ${termAtRequest}`;
    $("#dashboardGradeValue").textContent = "…";
    try {
      const record = await G10DataService.getCompliance(profile.studentId, termAtRequest, force);
      if (termAtRequest === currentTerm) showStudentGrade(record, "dashboardGrade");
    } catch (error) {
      console.warn("Could not load running grade:", error);
      if (termAtRequest === currentTerm) showStudentGrade(null, "dashboardGrade", error);
    }
  }

  async function loadCompliance() {
    const target = $("#complianceList");
    target.innerHTML = `<div class="loading-line">Loading compliance status…</div>`;

    try {
      const record = await G10DataService.getCompliance(profile.studentId, currentTerm, true);
      loaded.compliance = true;
      showStudentGrade(record, "complianceGrade");
      showStudentGrade(record, "dashboardGrade");
      $("#dashboardGradeTerm").textContent = `TERM ${currentTerm}`;
      $("#complianceTerm").textContent = `Term ${currentTerm}`;
      $("#complianceGradeTerm").textContent = `TERM ${currentTerm}`;
      const lastPublished = record?.publishedAt || record?.lastUpdated;
      $("#complianceUpdated").textContent = lastPublished
        ? formatDateTime(lastPublished)
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

      const pendingWWColors = tasks.filter(task => {
        const category = String(task?.category || "").toLowerCase();
        const id = String(task?.taskId || "").toLowerCase();
        const ww = category === "ww" || /^ww\d+$/.test(id);
        return ww && !isMissingTask(task) &&
          !["red", "orange", "yellow", "lime", "green"].includes(
            String(task?.percentageBand || "").toLowerCase()
          );
      });
      const pendingNotice = pendingWWColors.length
        ? `<div class="complete-message neutral ww-color-pending" role="status">` +
          `Written Work colors have not been published for ${pendingWWColors.length} completed task(s) yet. ` +
          `Ask your teacher to check/repair the WW colors in Admin Compliance. ` +
          `Scores remain private.</div>`
        : "";
      target.innerHTML = pendingNotice + tasks.map(task => {
        const missing = isMissingTask(task);
        const rawPercent = task?.scorePercent;
        const hasPercent = rawPercent !== null && rawPercent !== undefined &&
          rawPercent !== "" && Number.isFinite(Number(rawPercent));

        const taskId = String(task?.taskId || "").toLowerCase();
        const category = String(task?.category || "").toLowerCase();
        const categoryLabel = String(task?.categoryLabel || "").toLowerCase();
        const isWrittenWork = category === "ww" || /^ww\d+$/.test(taskId);
        const allowedBands = ["red", "orange", "yellow", "lime", "green"];
        const publishedBand = String(task?.percentageBand || "").toLowerCase();

        // WW: only use the teacher-published color category; never read or
        // display WW raw scores, HPS, or exact percentages in the student UI.
        // PT/TA: prefer numeric percentage, falling back to published band.
        // Old WW records without a band stay gray until the next Sync & Publish.
        const band = missing
          ? "black"
          : isWrittenWork
            ? (allowedBands.includes(publishedBand) ? publishedBand : "neutral")
            : hasPercent
              ? complianceBandFromPercent(Number(rawPercent))
              : (allowedBands.includes(publishedBand) ? publishedBand : "neutral");

        const status = missing ? "Missing" : "Completed";

        const isPerformanceTask = category === "pt" || /^pt\d+$/.test(taskId);
        const isTermAssessment =
          category === "ta" ||
          taskId.startsWith("ta") ||
          categoryLabel.includes("term assessment");

        const numericScore = Number(task?.score);
        const numericMaxScore = Number(task?.maxScore);

        const hasMax = task?.maxScore !== null && task?.maxScore !== undefined &&
          task?.maxScore !== "" && Number.isFinite(numericMaxScore) && numericMaxScore > 0;
        const hasScore = !missing && task?.score !== null && task?.score !== undefined &&
          task?.score !== "" && Number.isFinite(numericScore);

        const score = (isTermAssessment || isPerformanceTask) && hasMax
          ? `<span class="score-pill term-assessment-score">${hasScore ? escapeHtml(formatComplianceScore(numericScore)) : "—"} / ${escapeHtml(formatComplianceScore(numericMaxScore))}</span>`
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
      showStudentGrade(null, "complianceGrade", err);
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
    loginReminderRequested = false;
    ++tinkercadLoadSerial;
    ++projectReviewLoadSerial;
    $("#tcStudentAccess").textContent = "";
    $("#pmStudentList").textContent = "";
    $("#studentLoginPreparing").classList.add("hidden");

    if (!$("#studentLoginReminderModal").classList.contains("hidden")) {
      closeStudentLoginReminder();
    }

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
