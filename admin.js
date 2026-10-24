(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let admin = null;
  let db = null;
  let previewPayload = null;
  let bulkStudentRows = [];
  let knownSections = [];
  let loginReminderMusicPlaylist = [];
  let adminReminderPreviewTracks = [];
  let adminReminderPreviewTrackIndex = -1;
  let adminReminderPreviewShuffle = true;
  let cachedStudentProfiles = [];
  let tinkercadClassConfig = null;
  let tinkercadLoadingSerial = 0;
  let pmActivities = [];
  let pmReviewMap = new Map();
  let pmDisplayStudents = [];
  let pmLoadSerial = 0;
  let pmInitialized = false;
  const PM_STATUSES = {
    "not-reviewed": "Not Reviewed", "for-checking": "For Checking",
    "checked": "Checked", "needs-revision": "Needs Revision"
  };

  let complianceSettingsCache = null;
  let activeComplianceTaskGroup = "ww";

  let editingAnnouncementId = null;
  let editingAnnouncementAttachment = null;
  let adminNotificationUnsubscribe = null;
  let currentUnreadNotifications = [];

  let activeStudentComplianceProfile = null;
  let studentComplianceNavigationUids = [];
  let studentComplianceNavigationSource = "students";
  let studentComplianceLoadSerial = 0;
  let studentComplianceOpenSerial = 0;
  let missingComplianceOverviewRows = [];
  let missingComplianceNavigationRows = [];
  let performanceModel = null;
  let performanceSelectedSection = "*";
  let performanceDisplayedRows = [];
  let performanceLoadSerial = 0;

  const DEFAULT_LOGIN_REMINDER_POSITIVE =
    "Great! You have no lacking requirements. Keep up the good work and continue maintaining your performance.";

  const DEFAULT_LOGIN_REMINDER_WARNING =
    "The {term} is nearing its end. Please complete the following missing requirements as soon as possible to avoid delays in your subject completion.";

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    await G10DataService.init();
    bindEvents();

    if (G10DataService.isDemo()) {
      $("#adminLoginError").textContent = "Admin live mode cannot run from file://. Upload the folder to GitHub Pages or another HTTPS static host first.";
      $("#adminLoginBtn").disabled = true;
      return;
    }

    const handles = G10DataService.getFirebaseHandles();
    db = handles.db;

    try {
      const restored = await G10DataService.restoreAccountSession();

      if (restored?.role === "admin" && restored.admin) {
        admin = restored.admin;
        await enterAdmin();
        return;
      }

      if (restored?.role === "student") {
        window.location.replace("index.html");
      }
    } catch (err) {
      console.warn("Could not restore Admin session:", err);
    }
  }

  function bindEvents() {
    $("#adminLoginForm").addEventListener("submit", adminLogin);
    $("#adminLogout").addEventListener("click", adminLogout);

    $$(".admin-tab").forEach(btn => {
      btn.addEventListener("click", () => openAdminPage(btn.dataset.adminPage));
    });

    $("#settingsForm").addEventListener("submit", saveSettings);
    $("#settingLoginReminderMusicEnabled").addEventListener("change", updateLoginReminderAdminControls);
    $("#settingLoginReminderMusicShuffle").addEventListener("change", updateLoginReminderShuffleDescription);
    $("#settingLoginReminderBulkMusic").addEventListener("input", updateMusicBulkDetection);
    $("#loginReminderAddSingleMusicBtn").addEventListener("click", addSingleMusicLink);
    $("#loginReminderAddBulkMusicBtn").addEventListener("click", addBulkMusicLinks);
    $("#loginReminderMusicList").addEventListener("click", event => {
      const removeBtn = event.target.closest("[data-remove-music-index]");
      if (!removeBtn) return;
      const index = Number(removeBtn.dataset.removeMusicIndex);
      if (!Number.isInteger(index) || index < 0 || index >= loginReminderMusicPlaylist.length) return;
      loginReminderMusicPlaylist.splice(index, 1);
      renderMusicPlaylist();
    });
    $("#previewLoginReminderBtn").addEventListener("click", previewLoginReminderModal);
    $("#adminLoginReminderPreviewPlayMusicBtn").addEventListener("click", playAdminReminderPreviewMusic);

    $$("[data-close-admin-login-reminder-preview]").forEach(el => {
      el.addEventListener("click", closeAdminLoginReminderPreview);
    });

    $("#lessonForm").addEventListener("submit", saveLesson);
    $("#activityForm").addEventListener("submit", saveActivity);
    $("#activityFile").addEventListener("change", renderActivityAttachmentSelection);
    $("#activityFileId").addEventListener("input", renderActivityAttachmentSelection);
    $("#announcementForm").addEventListener("submit", saveAnnouncement);
    $("#cancelAnnouncementEditBtn").addEventListener("click", resetAnnouncementForm);
    $("#refreshAnnouncementsAdmin").addEventListener("click", loadAdminAnnouncements);
    $("#refreshAdminDashboard").addEventListener("click", loadAdminDashboardStats);
    $("#perfRefresh").addEventListener("click", () => loadPerformanceDashboard(true));
    $("#perfTerm").addEventListener("change", () => loadPerformanceDashboard(true));
    $("#perfAllSections").addEventListener("click", () => selectPerformanceSection("*"));
    ["#perfSearch", "#perfBand", "#perfTrend", "#perfRequirements"].forEach(selector => {
      $(selector).addEventListener(selector === "#perfSearch" ? "input" : "change", renderPerformanceStudentTable);
    });
    $("#perfSections").addEventListener("click", e => {
      const btn = e.target.closest("[data-perf-section]");
      if (btn) selectPerformanceSection(btn.dataset.perfSection);
    });
    $("#perfGradeChart").addEventListener("click", e => {
      const btn = e.target.closest("[data-perf-band]");
      if (!btn) return;
      $("#perfBand").value = $("#perfBand").value === btn.dataset.perfBand ? "*" : btn.dataset.perfBand;
      renderPerformanceStudentTable();
      $("#perfStudents").closest(".perf-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#admin-page-performance").addEventListener("click", event => {
      const scores = event.target.closest("[data-perf-scores]");
      const projects = event.target.closest("[data-perf-projects]");
      const uid = scores?.dataset.perfScores || projects?.dataset.perfProjects;
      const record = performanceModel?.rows.find(r => r.uid === uid);
      if (!record) return;
      if (scores) void openStudentComplianceProfile(uid, Number($("#perfTerm").value), "performance");
      if (projects) void openPerformanceProjectReviews(record);
    });
    $("#missingComplianceCard").addEventListener("click", openMissingComplianceOverview);
    $("#studentComplianceTerm").addEventListener("change", loadActiveStudentComplianceProfile);
    $("#studentCompliancePreviousBtn").addEventListener("click", () => stepStudentCompliance(-1));
    $("#studentComplianceNextBtn").addEventListener("click", () => stepStudentCompliance(1));
    $("#missingOverviewTerm").addEventListener("change", loadMissingComplianceOverview);
    $("#missingOverviewSection").addEventListener("change", renderMissingComplianceOverview);
    $("#missingOverviewSort").addEventListener("change", renderMissingComplianceOverview);

    $$("[data-close-student-compliance]").forEach(el => {
      el.addEventListener("click", closeStudentComplianceProfile);
    });

    $$("[data-close-missing-compliance]").forEach(el => {
      el.addEventListener("click", closeMissingComplianceOverview);
    });

    document.addEventListener("keydown", e => {
      // Arrow keys only navigate when the View Scores modal is open. Do not
      // steal arrow keys from inputs, dropdowns, or editable elements.
      if (!$("#studentComplianceModal").classList.contains("hidden") &&
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          !e.target.closest("input, select, textarea, [contenteditable], [role='combobox']")) {
        e.preventDefault();
        stepStudentCompliance(e.key === "ArrowRight" ? 1 : -1);
        return;
      }

      if (e.key !== "Escape") return;

      if (!$("#adminLoginReminderPreviewModal").classList.contains("hidden")) {
        closeAdminLoginReminderPreview();
        return;
      }

      if (!$("#studentPasswordResetModal").classList.contains("hidden")) {
        closeStudentPasswordResetModal();
        return;
      }

      if (!$("#studentComplianceModal").classList.contains("hidden")) {
        closeStudentComplianceProfile();
        return;
      }

      if (!$("#missingComplianceModal").classList.contains("hidden")) {
        closeMissingComplianceOverview();
      }
    });

    $("#adminNotificationBtn").addEventListener("click", toggleAdminNotificationPanel);
    $("#markNotificationsReadBtn").addEventListener("click", markAllAdminNotificationsRead);
    $$("[data-close-hearts]").forEach(el => {
      el.addEventListener("click", closeAdminHeartsModal);
    });
    $("#studentForm").addEventListener("submit", createStudent);
    $("#bulkStudentForm").addEventListener("submit", previewBulkStudents);
    $("#bulkImportBtn").addEventListener("click", importBulkStudents);
    $("#newStudentSection").addEventListener("change", handleNewStudentSectionChange);
    $("#studentSectionFilter").addEventListener("change", renderStudentProfiles);
    $("#studentSearchInput").addEventListener("input", renderStudentProfiles);

    $("#tinkercadClassForm").addEventListener("submit", saveTinkercadClassroom);
    $("#tcAdminClassLink").addEventListener("input", previewTinkercadClassCode);
    $("#tcAdminSearch").addEventListener("input", renderTinkercadRoster);
    $("#tcAdminSection").addEventListener("change", renderTinkercadRoster);
    $("#tcAdminRefreshBtn").addEventListener("click", () => loadTinkercadManager(true));

    $("#pmTaskForm").addEventListener("submit", createProjectMonitoringActivity);
    $("#pmRefresh").addEventListener("click", () => loadProjectMonitoring(true));
    $("#pmArchiveTask").addEventListener("click", archiveProjectMonitoringActivity);
    $("#pmTermFilter").addEventListener("change", () => renderProjectTaskOptions());
    $("#pmSectionFilter").addEventListener("change", () => renderProjectTaskOptions());
    $("#pmTaskFilter").addEventListener("change", () => loadProjectReviewRecords());
    $("#pmStudentSearch").addEventListener("input", renderProjectReviewStudents);
    $("#pmStudentList").addEventListener("click", saveProjectReviewFromList);
    $("#pmStudentList").addEventListener("input", event => {
      const row = event.target.closest("[data-pm-uid]");
      const button = row?.querySelector("[data-pm-save]");
      if (button && !button.disabled) button.textContent = "SAVE & NEXT →";
    });
    $("#pmStudentList").addEventListener("change", event => {
      if (!event.target.matches("[data-pm-status]")) return;
      const button = event.target.closest("[data-pm-uid]")?.querySelector("[data-pm-save]");
      if (button && !button.disabled) button.textContent = "SAVE & NEXT →";
    });

    $$("[data-close-student-password-reset]").forEach(el => {
      el.addEventListener("click", closeStudentPasswordResetModal);
    });
    $("#copyStudentTemporaryPassword").addEventListener("click", copyStudentTemporaryPassword);

    $("#saveComplianceSettingsBtn").addEventListener("click", saveComplianceSettingsToFirebase);
    $("#syncTerm").addEventListener("change", handleComplianceTermChange);
    $("#complianceSelectAllBtn").addEventListener("click", () => setAllComplianceSectionsChecked(true));
    $("#complianceClearAllBtn").addEventListener("click", () => setAllComplianceSectionsChecked(false));
    $("#resetComplianceTaskNamesBtn").addEventListener("click", resetCurrentComplianceTaskGroup);
    $$("[data-compliance-task-group]").forEach(btn => {
      btn.addEventListener("click", () => {
        captureVisibleComplianceTaskNames();
        activeComplianceTaskGroup = btn.dataset.complianceTaskGroup || "ww";
        renderComplianceTaskGroup();
      });
    });
    $("#previewComplianceBtn").addEventListener("click", previewSync);
    $("#publishSyncBtn").addEventListener("click", publishSync);
    $("#repairWWColorsBtn").addEventListener("click", repairWrittenWorkColors);

    $("#refreshLessonsAdmin").addEventListener("click", loadAdminLessons);
    $("#refreshActivitiesAdmin").addEventListener("click", loadAdminActivities);
    $("#refreshStudentsAdmin").addEventListener("click", loadStudents);
  }

  async function adminLogin(e) {
    e.preventDefault();
    const btn = $("#adminLoginBtn");
    setBusy(btn, true, "SIGNING IN…");
    $("#adminLoginError").textContent = "";

    try {
      admin = await G10DataService.signInAdmin($("#adminEmail").value, $("#adminPassword").value);
      db = G10DataService.getFirebaseHandles().db;
      await enterAdmin();
    } catch (err) {
      $("#adminLoginError").textContent = err.message || "Admin sign-in failed.";
    } finally {
      setBusy(btn, false, "ADMIN SIGN IN");
    }
  }

  async function enterAdmin() {
    $("#adminLoginView").classList.add("hidden");
    $("#adminApp").classList.remove("hidden");
    $("#adminName").textContent = admin.name || admin.email || "Admin";
    await loadSettings();
    await loadSectionDirectory();
    resetAnnouncementForm();
    startAdminNotificationListener();
    await loadAdminDashboardStats();
  }

  async function adminLogout() {
    if (!$("#adminLoginReminderPreviewModal").classList.contains("hidden")) {
      closeAdminLoginReminderPreview();
    }

    if (adminNotificationUnsubscribe) {
      adminNotificationUnsubscribe();
      adminNotificationUnsubscribe = null;
    }

    await G10DataService.logout();
    admin = null;
    $("#adminApp").classList.add("hidden");
    $("#adminLoginView").classList.remove("hidden");
    $("#adminPassword").value = "";
  }

  async function openAdminPage(page) {
    $$(".admin-tab").forEach(b => b.classList.toggle("active", b.dataset.adminPage === page));
    $$(".admin-page").forEach(p => p.classList.remove("active"));
    $(`#admin-page-${page}`).classList.add("active");

    if (page === "overview") await loadAdminDashboardStats();
    if (page === "performance") {
      $("#perfTerm").value = String(currentAdminTerm());
      await loadPerformanceDashboard(true);
    }
    if (page === "announcements") await loadAdminAnnouncements();
    if (page === "lessons") await loadAdminLessons();
    if (page === "activities") await loadAdminActivities();
    if (page === "students") await loadStudents();
    if (page === "tinkercad") await loadTinkercadManager();
    if (page === "project-monitor") await loadProjectMonitoring();
    if (page === "sync") await loadComplianceSetup();
  }


  function normalizeSectionName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  async function loadSectionDirectory(force = false) {
    if (!force && knownSections.length) {
      renderSectionControls();
      return knownSections;
    }

    try {
      const snap = await db.collection("students").get();
      cachedStudentProfiles = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

      knownSections = Array.from(new Set(
        cachedStudentProfiles
          .map(student => normalizeSectionName(student.section))
          .filter(Boolean)
      )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      renderSectionControls();
      return knownSections;
    } catch (err) {
      console.warn("Could not load section directory:", err);
      knownSections = [];
      renderSectionControls();
      return knownSections;
    }
  }

  function optionHtml(value, label, selected = false) {
    return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function renderSectionControls() {
    // Add One Student
    const studentSelect = $("#newStudentSection");
    if (studentSelect) {
      const previous = studentSelect.value;
      studentSelect.innerHTML =
        optionHtml("", "Select section") +
        knownSections.map(section => optionHtml(section, section, previous === section)).join("") +
        optionHtml("__new__", "+ Add new section", previous === "__new__");

      if (previous && !knownSections.includes(previous) && previous !== "__new__") {
        studentSelect.value = "";
      }
    }

    // Student Profiles filter
    const filter = $("#studentSectionFilter");
    if (filter) {
      const previous = filter.value || "*";
      filter.innerHTML =
        optionHtml("*", "All Sections", previous === "*") +
        knownSections.map(section => optionHtml(section, section, previous === section)).join("");
      if (previous !== "*" && knownSections.includes(previous)) filter.value = previous;
    }

    // Compliance section setup is rendered by loadComplianceSetup()
    // using the same unique section directory from the student roster.

    renderMultiSectionPicker("announcement", $("#announcementSectionsOptions"));
    renderMultiSectionPicker("lesson", $("#lessonSectionsOptions"));
    renderMultiSectionPicker("activity", $("#activitySectionsOptions"));
  }

  function renderMultiSectionPicker(prefix, target) {
    if (!target) return;

    const current = getSelectedSections(prefix);
    const allSelected = !current.length || current.includes("*");

    target.innerHTML = `
      <label class="section-check all-section-check">
        <input type="checkbox" data-section-picker="${prefix}" value="*" ${allSelected ? "checked" : ""}>
        <span>All Sections</span>
      </label>
      ${knownSections.map(section => `
        <label class="section-check">
          <input type="checkbox" data-section-picker="${prefix}" value="${escapeHtml(section)}"
            ${!allSelected && current.includes(section) ? "checked" : ""}>
          <span>${escapeHtml(section)}</span>
        </label>
      `).join("")}
      ${knownSections.length ? "" : '<div class="section-empty">Import/create students first to build the section list.</div>'}
    `;

    target.querySelectorAll(`input[data-section-picker="${prefix}"]`).forEach(input => {
      input.addEventListener("change", () => handleSectionPickerChange(prefix, input));
    });

    updateSectionPickerSummary(prefix);
  }

  function handleSectionPickerChange(prefix, changedInput) {
    const inputs = $$(`input[data-section-picker="${prefix}"]`);
    const allInput = inputs.find(input => input.value === "*");

    if (changedInput.value === "*" && changedInput.checked) {
      inputs.forEach(input => {
        if (input.value !== "*") input.checked = false;
      });
    } else if (changedInput.value !== "*" && changedInput.checked && allInput) {
      allInput.checked = false;
    }

    const selectedSpecific = inputs.filter(input => input.value !== "*" && input.checked);
    if (!selectedSpecific.length && allInput) allInput.checked = true;

    updateSectionPickerSummary(prefix);
  }

  function getSelectedSections(prefix) {
    const inputs = $$(`input[data-section-picker="${prefix}"]`);
    if (!inputs.length) return ["*"];

    const values = inputs.filter(input => input.checked).map(input => input.value);
    return values.length ? values : ["*"];
  }

  function updateSectionPickerSummary(prefix) {
    const summary = $(`#${prefix}SectionSummary`);
    if (!summary) return;

    const values = getSelectedSections(prefix);
    if (values.includes("*")) {
      summary.textContent = "All Sections";
    } else if (values.length === 1) {
      summary.textContent = values[0];
    } else {
      summary.textContent = `${values.length} Sections Selected`;
    }
  }

  function handleNewStudentSectionChange() {
    const isNew = $("#newStudentSection").value === "__new__";
    $("#newStudentSectionCustomWrap").classList.toggle("hidden", !isNew);
    $("#newStudentSectionCustom").required = isNew;
    if (!isNew) $("#newStudentSectionCustom").value = "";
  }

  function getNewStudentSection() {
    const selected = $("#newStudentSection").value;
    if (selected === "__new__") {
      return normalizeSectionName($("#newStudentSectionCustom").value);
    }
    return normalizeSectionName(selected);
  }

  async function loadSettings() {
    const snap = await db.collection("settings").doc("main").get();
    const data = snap.exists ? snap.data() : {};

    $("#settingSchoolYear").value =
      data.schoolYear || G10_CONFIG.app.schoolYear || "2026-2027";

    $("#settingCurrentTerm").value = String(data.currentTerm || 1);

    $("#settingLoginReminderEnabled").checked =
      data.loginReminderEnabled !== false;

    $("#settingLoginReminderMusicEnabled").checked =
      data.loginReminderMusicEnabled === true;
    // Legacy playlists had random starting tracks: preserve that default.
    $("#settingLoginReminderMusicShuffle").checked =
      data.loginReminderMusicShuffle !== false;
    updateLoginReminderShuffleDescription();

    // Keep backwards compatibility with the original single-song setting.
    loginReminderMusicPlaylist = G10MusicPlaylist.normalize(
      Array.isArray(data.loginReminderMusicUrls) && data.loginReminderMusicUrls.length
        ? data.loginReminderMusicUrls : [data.loginReminderMusicUrl || ""]
    );
    $("#settingLoginReminderMusicUrl").value = "";
    $("#settingLoginReminderBulkMusic").value = "";
    renderMusicPlaylist();
    updateMusicBulkDetection();

    $("#settingLoginReminderPositiveMessage").value =
      String(data.loginReminderPositiveMessage || DEFAULT_LOGIN_REMINDER_POSITIVE);

    $("#settingLoginReminderWarningMessage").value =
      String(data.loginReminderWarningMessage || DEFAULT_LOGIN_REMINDER_WARNING);

    updateLoginReminderAdminControls();
  }

  async function saveSettings(e) {
    e.preventDefault();
    setStatus("#settingsStatus", "Saving…");

    try {
      // Also process links still in either paste field if Save is clicked first.
      const draftSingle = $("#settingLoginReminderMusicUrl").value.trim();
      const draftBulk = $("#settingLoginReminderBulkMusic").value;
      if (draftSingle && !G10MusicPlaylist.validUrl(draftSingle)) {
        throw new Error("The single music URL is invalid. Please enter a direct http(s) link.");
      }
      const parsedBulk = G10MusicPlaylist.extract(draftBulk);
      if (draftBulk.trim() && parsedBulk.urls.length === 0) {
        throw new Error("No valid music URLs found in the bulk input.");
      }
      const mergedMusic = G10MusicPlaylist.merge(
        loginReminderMusicPlaylist, [...(draftSingle ? [draftSingle] : []), ...parsedBulk.urls]
      );
      if (mergedMusic.excess) {
        throw new Error(`Playlist supports up to ${G10MusicPlaylist.MAX_TRACKS} music links. Remove some first.`);
      }
      const data = {
        schoolYear: $("#settingSchoolYear").value.trim(),
        currentTerm: Number($("#settingCurrentTerm").value),

        loginReminderEnabled: $("#settingLoginReminderEnabled").checked,
        loginReminderMusicEnabled: $("#settingLoginReminderMusicEnabled").checked,
        loginReminderMusicShuffle: $("#settingLoginReminderMusicShuffle").checked,
        loginReminderMusicUrl: mergedMusic.urls[0] || "", // legacy clients
        loginReminderMusicUrls: mergedMusic.urls,
        loginReminderPositiveMessage:
          $("#settingLoginReminderPositiveMessage").value.trim() ||
          DEFAULT_LOGIN_REMINDER_POSITIVE,
        loginReminderWarningMessage:
          $("#settingLoginReminderWarningMessage").value.trim() ||
          DEFAULT_LOGIN_REMINDER_WARNING,

        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("settings").doc("main").set(data, { merge: true });
      loginReminderMusicPlaylist = mergedMusic.urls;
      $("#settingLoginReminderMusicUrl").value = "";
      $("#settingLoginReminderBulkMusic").value = "";
      renderMusicPlaylist();
      updateMusicBulkDetection();
      setStatus("#settingsStatus", `Settings saved. ${loginReminderMusicPlaylist.length} music track(s) in playlist.`, true);
      await loadAdminDashboardStats();
    } catch (err) {
      setStatus("#settingsStatus", err.message, false);
    }
  }


  function updateLoginReminderAdminControls() {
    // Keep the playlist editor editable even while background music is OFF.
    // This allows the teacher to prepare a playlist before enabling playback.
  }

  function updateLoginReminderShuffleDescription() {
    const enabled = $("#settingLoginReminderMusicShuffle").checked;
    $("#loginReminderShuffleDescription").textContent = enabled
      ? "ON: Plays all tracks in a random order before repeating. No repeat until the playlist finishes."
      : "OFF: Plays in the playlist order, starting at track 1, then repeats from the beginning.";
  }

  function renderMusicPlaylist() {
    $("#loginReminderMusicCount").textContent =
      `(${loginReminderMusicPlaylist.length} / ${G10MusicPlaylist.MAX_TRACKS})`;
    $("#loginReminderMusicList").innerHTML = loginReminderMusicPlaylist.length
      ? loginReminderMusicPlaylist.map((url, index) => `
        <div class="reminder-music-track">
          <span class="reminder-music-number">${index + 1}</span>
          <span class="reminder-music-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
          <button class="secondary-btn" type="button" data-remove-music-index="${index}" aria-label="Remove track ${index + 1}">Remove</button>
        </div>`).join("")
      : '<p class="reminder-music-empty">No music added yet.</p>';
  }

  function updateMusicBulkDetection() {
    const parsed = G10MusicPlaylist.extract($("#settingLoginReminderBulkMusic").value);
    const merged = G10MusicPlaylist.merge(loginReminderMusicPlaylist, parsed.urls);
    $("#loginReminderBulkDetection").textContent =
      `${parsed.detected} URL(s) detected • ${merged.added.length} new • ` +
      `${parsed.duplicates + merged.duplicates} duplicate(s) • ` +
      `${parsed.invalid.length} invalid • ${merged.excess} over limit`;
    $("#loginReminderAddBulkMusicBtn").disabled = !merged.added.length;
  }

  function addSingleMusicLink() {
    const input = $("#settingLoginReminderMusicUrl");
    const url = input.value.trim();
    if (!G10MusicPlaylist.validUrl(url)) {
      setStatus("#settingsStatus", "Enter a valid http(s) music URL first.", false);
      return;
    }
    const result = G10MusicPlaylist.merge(loginReminderMusicPlaylist, [url]);
    if (!result.added.length) {
      setStatus("#settingsStatus", result.excess ? "Playlist limit reached (100 tracks)." : "That URL is already in the playlist.", false);
      return;
    }
    loginReminderMusicPlaylist = result.urls;
    input.value = "";
    renderMusicPlaylist();
    updateMusicBulkDetection();
    setStatus("#settingsStatus", "Music link added. Click SAVE SETTINGS to publish.", true);
  }

  function addBulkMusicLinks() {
    const input = $("#settingLoginReminderBulkMusic");
    const parsed = G10MusicPlaylist.extract(input.value);
    const merged = G10MusicPlaylist.merge(loginReminderMusicPlaylist, parsed.urls);
    if (!merged.added.length) {
      setStatus("#settingsStatus", "No new valid music links found. Check duplicates or URL format.", false);
      return;
    }
    loginReminderMusicPlaylist = merged.urls;
    input.value = "";
    renderMusicPlaylist();
    updateMusicBulkDetection();
    setStatus("#settingsStatus",
      `${merged.added.length} track(s) added. ${merged.duplicates + parsed.duplicates} duplicate(s) ignored.` +
      (merged.excess ? ` ${merged.excess} exceeded the 100-track limit.` : "") +
      " Click SAVE SETTINGS to publish.", true);
  }

  function currentPreviewMusicTracks() {
    const single = $("#settingLoginReminderMusicUrl").value.trim();
    const pasted = G10MusicPlaylist.extract($("#settingLoginReminderBulkMusic").value);
    return G10MusicPlaylist.merge(loginReminderMusicPlaylist,
      [...(G10MusicPlaylist.validUrl(single) ? [single] : []), ...pasted.urls]).urls;
  }

  function adminReminderTermName() {
    const term = Number($("#settingCurrentTerm").value || 1);
    if (term === 1) return "First Term";
    if (term === 2) return "Second Term";
    if (term === 3) return "Third Term";
    return `Term ${term}`;
  }

  function adminReminderTemplate(value, fallback) {
    return String(value || fallback || "")
      .replace(/\{term\}/gi, adminReminderTermName())
      .replace(/\{name\}/gi, "Student Preview");
  }

  async function previewLoginReminderModal() {
    const mode = $("#settingLoginReminderPreviewMode").value || "missing";
    const isMissing = mode === "missing";

    const dialog = $("#adminLoginReminderPreviewDialog");
    const title = $("#adminLoginReminderPreviewTitle");
    const meta = $("#adminLoginReminderPreviewMeta");
    const icon = $("#adminLoginReminderPreviewIcon");
    const statusTitle = $("#adminLoginReminderPreviewStatusTitle");
    const message = $("#adminLoginReminderPreviewMessage");
    const missingSection = $("#adminLoginReminderPreviewMissingSection");
    const count = $("#adminLoginReminderPreviewMissingCount");
    const list = $("#adminLoginReminderPreviewList");

    dialog.classList.remove("is-positive", "is-warning", "is-neutral");
    meta.textContent = `Student Preview • ${adminReminderTermName()}`;
    $("#adminLoginReminderPreviewGradeTerm").textContent = `TERM ${Number($("#settingCurrentTerm").value || 1)}`;
    $("#adminLoginReminderPreviewGradeNote").textContent = "Sample display • Actual grade and update date will appear for each student.";

    if (isMissing) {
      const sampleTasks = [
        ["Written Works", "Seatwork #1"],
        ["Performance Task", "Mini PETA #1"],
        ["Performance Task", "Activity #2"]
      ];

      dialog.classList.add("is-warning");
      icon.textContent = "!";
      title.textContent = "Action Needed";
      statusTitle.textContent = `${sampleTasks.length} missing requirements`;
      message.textContent = adminReminderTemplate(
        $("#settingLoginReminderWarningMessage").value,
        DEFAULT_LOGIN_REMINDER_WARNING
      );

      count.textContent = String(sampleTasks.length);
      missingSection.classList.remove("hidden");
      list.innerHTML = sampleTasks.map((task, index) => `
        <article class="login-reminder-list-item">
          <span class="login-reminder-list-no">${index + 1}</span>
          <div>
            <small>${escapeHtml(task[0])}</small>
            <strong>${escapeHtml(task[1])}</strong>
          </div>
          <span class="login-reminder-missing-pill">Missing</span>
        </article>
      `).join("");
    } else {
      dialog.classList.add("is-positive");
      icon.textContent = "✓";
      title.textContent = "Great Work!";
      statusTitle.textContent = "You have no lacking requirements.";
      message.textContent = adminReminderTemplate(
        $("#settingLoginReminderPositiveMessage").value,
        DEFAULT_LOGIN_REMINDER_POSITIVE
      );
      missingSection.classList.add("hidden");
      list.innerHTML = "";
    }

    $("#adminLoginReminderPreviewModal").classList.remove("hidden");
    document.body.classList.add("modal-open");

    const musicEnabled = $("#settingLoginReminderMusicEnabled").checked;
    const musicUrls = currentPreviewMusicTracks();

    if (musicEnabled && musicUrls.length) {
      await startAdminReminderPreviewAudio(musicUrls, $("#settingLoginReminderMusicShuffle").checked);
    } else {
      stopAdminReminderPreviewAudio();
    }
  }

  async function startAdminReminderPreviewAudio(urls, shuffleEnabled) {
    stopAdminReminderPreviewAudio();
    adminReminderPreviewShuffle = shuffleEnabled !== false;
    const initial = G10MusicPlaylist.startPlayback(urls, adminReminderPreviewShuffle);
    adminReminderPreviewTracks = initial.tracks;
    adminReminderPreviewTrackIndex = initial.index;
    if (!adminReminderPreviewTracks.length) return;
    const audio = $("#adminLoginReminderPreviewAudio");
    audio.onended = () => {
      if ($("#adminLoginReminderPreviewModal").classList.contains("hidden")) return;
      const next = G10MusicPlaylist.advancePlayback(
        adminReminderPreviewTracks, adminReminderPreviewTrackIndex, adminReminderPreviewShuffle
      );
      adminReminderPreviewTracks = next.tracks;
      adminReminderPreviewTrackIndex = next.index;
      void playAdminPreviewCurrentTrack();
    };
    await playAdminPreviewCurrentTrack();
  }

  async function playAdminPreviewCurrentTrack() {
    const audio = $("#adminLoginReminderPreviewAudio");
    const button = $("#adminLoginReminderPreviewPlayMusicBtn");
    const url = adminReminderPreviewTracks[adminReminderPreviewTrackIndex];
    if (!url) return;
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

  async function playAdminReminderPreviewMusic() {
    if (!adminReminderPreviewTracks.length) {
      await startAdminReminderPreviewAudio(
        currentPreviewMusicTracks(), $("#settingLoginReminderMusicShuffle").checked
      );
      return;
    }
    await playAdminPreviewCurrentTrack();
  }

  function stopAdminReminderPreviewAudio() {
    const audio = $("#adminLoginReminderPreviewAudio");
    const button = $("#adminLoginReminderPreviewPlayMusicBtn");
    adminReminderPreviewTracks = [];
    adminReminderPreviewTrackIndex = -1;
    if (audio) {
      audio.onended = null;
      audio.pause();
      try { audio.currentTime = 0; } catch (_) {}
      audio.removeAttribute("src");
      audio.load();
    }
    if (button) {
      button.classList.add("hidden");
      button.textContent = "▶ Play Music";
    }
  }

  function closeAdminLoginReminderPreview() {
    $("#adminLoginReminderPreviewModal").classList.add("hidden");
    stopAdminReminderPreviewAudio();

    const otherOpen = [
      "#studentPasswordResetModal",
      "#studentComplianceModal",
      "#missingComplianceModal",
      "#adminHeartsModal"
    ].some(selector => {
      const el = $(selector);
      return el && !el.classList.contains("hidden");
    });

    if (!otherOpen) {
      document.body.classList.remove("modal-open");
    }
  }


  function parseSections(text) {
    const items = String(text || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    return items.length ? items : ["*"];
  }


  function setAdminStat(id, value) {
    const target = $(id);
    if (target) target.textContent = String(value);
  }

  async function countMissingComplianceForTerm(term) {
    const students = cachedStudentProfiles.length
      ? cachedStudentProfiles
      : (await db.collection("students").get()).docs
          .map(doc => ({ uid: doc.id, ...doc.data() }));

    const activeStudents = students.filter(student => student.active !== false);
    let count = 0;

    // Direct document reads avoid requiring a collection-group index.
    for (let i = 0; i < activeStudents.length; i += 25) {
      const batchStudents = activeStudents.slice(i, i + 25);

      const snapshots = await Promise.all(
        batchStudents.map(student => {
          const studentId = G10DataService.normalizeStudentId(student.studentId);
          if (!studentId) return Promise.resolve(null);

          return db.collection("studentCompliance")
            .doc(studentId)
            .collection("terms")
            .doc(`term${term}`)
            .get()
            .catch(() => null);
        })
      );

      snapshots.forEach(snap => {
        if (!snap || !snap.exists) return;
        const data = snap.data() || {};
        if (Number(data.summary?.missing || 0) > 0) count++;
      });
    }

    return count;
  }

  async function loadAdminDashboardStats() {
    const ids = [
      "#statTotalStudents",
      "#statPublishedLessons",
      "#statActiveActivities",
      "#statMissingCompliance",
      "#statScheduledAnnouncements",
      "#statNewHearts"
    ];

    ids.forEach(id => setAdminStat(id, "…"));

    try {
      const term = Number($("#settingCurrentTerm")?.value || 1);
      const now = Date.now();

      const [
        studentsResult,
        lessonsResult,
        activitiesResult,
        announcementsResult,
        heartsResult
      ] = await Promise.all([
        db.collection("students").get(),
        db.collection("lessons").where("published", "==", true).get(),
        db.collection("activities").where("published", "==", true).get(),
        db.collection("announcements").where("published", "==", true).get(),
        db.collection("adminNotifications").where("seen", "==", false).get()
      ]);

      cachedStudentProfiles = studentsResult.docs
        .map(doc => ({ uid: doc.id, ...doc.data() }));

      const activeStudents = cachedStudentProfiles
        .filter(student => student.active !== false);

      const activeActivities = activitiesResult.docs
        .map(doc => doc.data())
        .filter(item => Number(item.term || 0) === term)
        .length;

      const scheduled = announcementsResult.docs
        .map(doc => doc.data())
        .filter(item => {
          const date = announcementTimestampDate(item.publishAt);
          return date && date.getTime() > now;
        })
        .length;

      setAdminStat("#statTotalStudents", activeStudents.length);
      setAdminStat("#statPublishedLessons", lessonsResult.size);
      setAdminStat("#statActiveActivities", activeActivities);
      setAdminStat("#statScheduledAnnouncements", scheduled);
      setAdminStat("#statNewHearts", heartsResult.size);

      $("#statActiveActivitiesNote").textContent = `Term ${term} published activities`;
      $("#statMissingComplianceNote").textContent = `Term ${term} students with missing tasks`;

      try {
        const missingCount = await countMissingComplianceForTerm(term);
        setAdminStat("#statMissingCompliance", missingCount);
      } catch (err) {
        console.warn("Could not calculate missing compliance count:", err);
        setAdminStat("#statMissingCompliance", "—");
      }
    } catch (err) {
      console.warn("Admin dashboard count load failed:", err);
      ids.forEach(id => {
        const node = $(id);
        if (node && node.textContent === "…") node.textContent = "—";
      });
    }
  }

  async function callAppsScriptSecure(payload) {
    const url = String(G10_CONFIG.appsScriptUrl || "").trim();
    if (!url) {
      throw new Error("Apps Script Web App URL is not configured yet.");
    }

    const handles = G10DataService.getFirebaseHandles();
    const user = handles.auth && handles.auth.currentUser;

    if (!user) {
      throw new Error("Admin session expired. Please sign in again.");
    }

    // Fresh Firebase ID token proves who is calling the Apps Script bridge.
    // It is sent in the JSON body so the simple text/plain request avoids
    // unnecessary browser CORS preflight complexity.
    const idToken = await user.getIdToken(true);

    const response = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        ...payload,
        idToken
      })
    });

    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error("Apps Script returned an unreadable response. Check the Web App deployment and access settings.");
    }

    if (!result.ok) {
      if (result.code === "UNAUTHORIZED") {
        throw new Error("Apps Script rejected this request because the Firebase account is not an authorized admin.");
      }
      throw new Error(result.error || "Apps Script request failed.");
    }

    return result;
  }

  async function uploadFileObject(file, category) {
    if (!file) return null;

    if (!String(G10_CONFIG.appsScriptUrl || "").trim()) {
      throw new Error("A file was selected, but appsScriptUrl is still blank. Either configure Apps Script or paste a Drive File ID/URL instead.");
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error(
        `${file.name}: keep each browser-to-Apps-Script upload at 8 MB or less. ` +
        `Larger files can be uploaded directly to Drive and then referenced by File ID.`
      );
    }

    const base64 = await fileToBase64(file);
    const result = await callAppsScriptSecure({
      action: "uploadFile",
      category,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64
    });

    return result.file;
  }

  async function maybeUploadFile(input, category) {
    const file = input.files && input.files[0];
    return uploadFileObject(file, category);
  }

  function activityManualDriveIds() {
    const raw = String($("#activityFileId")?.value || "");

    return raw
      .split(/[\n,]+/)
      .map(value => G10DataService.extractDriveFileId(value))
      .map(value => String(value || "").trim())
      .filter(Boolean);
  }

  function selectedActivityFiles() {
    return Array.from($("#activityFile")?.files || []);
  }

  function validateActivityAttachmentCount(manualIds, files) {
    const total = manualIds.length + files.length;

    if (manualIds.length > 5) {
      throw new Error("Maximum 5 Activity attachments only. You pasted more than 5 Drive files.");
    }

    if (files.length > 5) {
      throw new Error("Maximum 5 Activity attachments only. Please select no more than 5 files.");
    }

    if (total > 5) {
      throw new Error(
        `Maximum 5 Activity attachments only. You currently have ${manualIds.length} Drive link(s) + ${files.length} uploaded file(s).`
      );
    }
  }

  function formatUploadBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "File";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
    return `${Math.round(value / (1024 * 102.4)) / 10} MB`;
  }

  function renderActivityAttachmentSelection() {
    const target = $("#activityAttachmentSelection");
    if (!target) return;

    const manualIds = activityManualDriveIds();
    const files = selectedActivityFiles();
    const total = manualIds.length + files.length;

    target.classList.toggle("limit-exceeded", total > 5);

    if (!total) {
      target.innerHTML = "No files selected.";
      return;
    }

    const rows = [
      ...manualIds.map((fileId, index) => ({
        label: `Drive attachment ${index + 1}`,
        detail: fileId
      })),
      ...files.map(file => ({
        label: file.name,
        detail: `${formatUploadBytes(file.size)}${file.type ? ` • ${file.type}` : ""}`
      }))
    ];

    target.innerHTML = `
      <div class="activity-attachment-selection-head">
        <strong>${total} / 5 attachment${total === 1 ? "" : "s"}</strong>
        ${total > 5 ? "<span>Too many files</span>" : ""}
      </div>
      <div class="activity-attachment-selection-list">
        ${rows.map(row => `
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <small>${escapeHtml(row.detail)}</small>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function buildActivityAttachments() {
    const manualIds = activityManualDriveIds();
    const files = selectedActivityFiles();

    // Validate before upload so no unnecessary Drive files are created.
    validateActivityAttachmentCount(manualIds, files);

    const attachments = [];
    const seenIds = new Set();

    manualIds.forEach((fileId, index) => {
      if (seenIds.has(fileId)) return;
      seenIds.add(fileId);

      attachments.push({
        fileId,
        fileName: `Google Drive attachment ${index + 1}`,
        fileType: "application/octet-stream",
        fileSize: null,
        source: "drive"
      });
    });

    if (attachments.length + files.length > 5) {
      throw new Error("Maximum 5 unique Activity attachments only.");
    }

    for (const file of files) {
      const uploaded = await uploadFileObject(file, "activities");
      if (!uploaded?.fileId || seenIds.has(uploaded.fileId)) continue;

      seenIds.add(uploaded.fileId);
      attachments.push({
        fileId: uploaded.fileId,
        fileName: uploaded.fileName || file.name,
        fileType: uploaded.fileType || file.type || "application/octet-stream",
        fileSize: uploaded.fileSize ?? file.size ?? null,
        source: "upload"
      });
    }

    if (attachments.length > 5) {
      throw new Error("Maximum 5 Activity attachments only.");
    }

    return attachments;
  }



  function announcementFeedTargets(allowedSections) {
    const sections = Array.isArray(allowedSections) && allowedSections.length
      ? allowedSections
      : ["*"];

    if (sections.includes("*")) return ["ALL_SECTIONS"];

    return Array.from(new Set(
      sections
        .map(section => normalizeSectionName(section))
        .filter(Boolean)
    ));
  }

  async function syncAnnouncementFeeds(announcementId, payload) {
    const cleanupTargets = ["ALL_SECTIONS", ...knownSections];
    const cleanupBatch = db.batch();

    cleanupTargets.forEach(sectionKey => {
      cleanupBatch.delete(
        db.collection("announcementFeeds")
          .doc(sectionKey)
          .collection("items")
          .doc(announcementId)
      );
    });

    await cleanupBatch.commit();

    if (!payload || payload.published !== true) return;

    const feedPayload = {
      title: payload.title || "",
      message: payload.message || "",
      allowedSections: payload.allowedSections || ["*"],
      published: true,
      publishAt: payload.publishAt,
      pinned: payload.pinned === true,
      fileId: payload.fileId || "",
      fileName: payload.fileName || "",
      fileType: payload.fileType || "",
      fileSize: payload.fileSize || null,
      createdByName: payload.createdByName || "ICT Teacher",
      sourceId: announcementId,
      feedVersion: 1,
      feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const writeBatch = db.batch();

    announcementFeedTargets(payload.allowedSections).forEach(sectionKey => {
      writeBatch.set(
        db.collection("announcementFeeds")
          .doc(sectionKey)
          .collection("items")
          .doc(announcementId),
        feedPayload
      );
    });

    await writeBatch.commit();
  }

  function toLocalDateTimeInput(date) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = value => String(value).padStart(2, "0");

    return [
      d.getFullYear(),
      "-",
      pad(d.getMonth() + 1),
      "-",
      pad(d.getDate()),
      "T",
      pad(d.getHours()),
      ":",
      pad(d.getMinutes())
    ].join("");
  }

  function announcementTimestampDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatAdminDateTime(value) {
    const date = announcementTimestampDate(value);
    if (!date) return "No publish date";

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function announcementAdminStatus(item) {
    if (item.published !== true) {
      return { label: "UNPUBLISHED", className: "unpublished" };
    }

    const publishDate = announcementTimestampDate(item.publishAt);
    if (publishDate && publishDate.getTime() > Date.now()) {
      return { label: "SCHEDULED", className: "scheduled" };
    }

    return { label: "PUBLISHED", className: "published" };
  }

  function resetAnnouncementForm() {
    editingAnnouncementId = null;
    editingAnnouncementAttachment = null;

    const form = $("#announcementForm");
    if (form) form.reset();

    $("#announcementPublished").checked = true;
    $("#announcementPinned").checked = false;
    $("#announcementPublishAt").value = toLocalDateTimeInput(new Date());
    $("#announcementFileId").value = "";
    $("#announcementExistingAttachment").textContent = "";
    $("#announcementExistingAttachment").classList.add("hidden");
    $("#announcementRemoveAttachmentRow").classList.add("hidden");
    $("#announcementRemoveAttachment").checked = false;

    $("#announcementFormHeading").textContent = "Create Announcement";
    $("#announcementEditBadge").classList.add("hidden");
    $("#cancelAnnouncementEditBtn").classList.add("hidden");
    $("#saveAnnouncementBtn").textContent = "SAVE ANNOUNCEMENT";

    renderMultiSectionPicker(
      "announcement",
      $("#announcementSectionsOptions")
    );
  }

  function setSectionPickerValues(prefix, values) {
    const requested = Array.isArray(values) && values.length
      ? values
      : ["*"];

    const inputs = $$(`input[data-section-picker="${prefix}"]`);
    const useAll = requested.includes("*");

    inputs.forEach(input => {
      input.checked = useAll
        ? input.value === "*"
        : requested.includes(input.value);
    });

    updateSectionPickerSummary(prefix);
  }

  async function ensureAnnouncementPinLimit(excludeId = null) {
    const snap = await db
      .collection("announcements")
      .where("pinned", "==", true)
      .get();

    const pinnedCount = snap.docs.filter(doc => doc.id !== excludeId).length;

    if (pinnedCount >= 3) {
      throw new Error("Maximum of 3 pinned announcements only. Unpin one first.");
    }
  }

  async function saveAnnouncement(e) {
    e.preventDefault();

    const btn = $("#saveAnnouncementBtn");
    const wasEditing = Boolean(editingAnnouncementId);

    setBusy(btn, true, wasEditing ? "UPDATING…" : "SAVING…");
    setStatus("#announcementStatus", "Saving announcement…");

    try {
      const dateInput = $("#announcementPublishAt").value;
      const publishDate = dateInput ? new Date(dateInput) : new Date();

      if (Number.isNaN(publishDate.getTime())) {
        throw new Error("Please enter a valid publish date and time.");
      }

      const pinned = $("#announcementPinned").checked;
      if (pinned) {
        await ensureAnnouncementPinLimit(editingAnnouncementId);
      }

      let fileId = editingAnnouncementAttachment?.fileId || "";
      let fileName = editingAnnouncementAttachment?.fileName || "";
      let fileType = editingAnnouncementAttachment?.fileType || "";
      let fileSize = editingAnnouncementAttachment?.fileSize || null;

      if ($("#announcementRemoveAttachment").checked) {
        fileId = "";
        fileName = "";
        fileType = "";
        fileSize = null;
      }

      const manualFileId = G10DataService.extractDriveFileId(
        $("#announcementFileId").value
      );

      if (manualFileId) {
        const sameExisting = manualFileId === editingAnnouncementAttachment?.fileId;
        fileId = manualFileId;

        if (!sameExisting) {
          fileName = "Google Drive attachment";
          fileType = "application/octet-stream";
          fileSize = null;
        }
      }

      const uploaded = await maybeUploadFile(
        $("#announcementFile"),
        "announcements"
      );

      if (uploaded) {
        fileId = uploaded.fileId;
        fileName = uploaded.fileName;
        fileType = uploaded.fileType;
        fileSize = uploaded.fileSize;
      }

      const payload = {
        title: $("#announcementTitle").value.trim(),
        message: $("#announcementMessage").value.trim(),
        allowedSections: getSelectedSections("announcement"),
        published: $("#announcementPublished").checked,
        pinned,
        publishAt: firebase.firestore.Timestamp.fromDate(publishDate),
        fileId,
        fileName,
        fileType,
        fileSize,
        createdByName: admin.name || admin.email || "ICT Teacher",
        createdByEmail: admin.email || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (!payload.title || !payload.message) {
        throw new Error("Announcement title and message are required.");
      }

      let ref;

      if (editingAnnouncementId) {
        ref = db.collection("announcements").doc(editingAnnouncementId);
        await ref.set(payload, { merge: true });
      } else {
        ref = await db.collection("announcements").add({
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      await syncAnnouncementFeeds(ref.id, payload);

      await ref.set({
        feedVersion: 2,
        feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const status = announcementAdminStatus(payload);

      setStatus(
        "#announcementStatus",
        status.label === "SCHEDULED"
          ? `Announcement scheduled for ${formatAdminDateTime(payload.publishAt)}.`
          : status.label === "PUBLISHED"
            ? "Announcement published."
            : "Announcement saved as unpublished.",
        true
      );

      resetAnnouncementForm();
      await Promise.all([
        loadAdminAnnouncements(),
        loadAdminDashboardStats()
      ]);
    } catch (err) {
      setStatus(
        "#announcementStatus",
        err.message || "Could not save announcement.",
        false
      );
    } finally {
      setBusy(
        btn,
        false,
        wasEditing ? "UPDATE ANNOUNCEMENT" : "SAVE ANNOUNCEMENT"
      );
    }
  }

  async function loadAdminAnnouncements() {
    const target = $("#adminAnnouncementsList");
    if (!target) return;

    target.innerHTML = "Loading…";

    try {
      const snap = await db.collection("announcements").get();
      const rows = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const aDate = announcementTimestampDate(a.publishAt)?.getTime() || 0;
          const bDate = announcementTimestampDate(b.publishAt)?.getTime() || 0;
          return bDate - aDate;
        });

      for (const item of rows) {
        if (item.feedVersion !== 2) {
          await syncAnnouncementFeeds(item.id, item);
          await db.collection("announcements").doc(item.id).set({
            feedVersion: 2,
            feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }

      target.innerHTML = rows.length
        ? rows.map(adminAnnouncementItem).join("")
        : '<div class="announcement-admin-empty">No announcements yet.</div>';

      bindAnnouncementAdminButtons();
    } catch (err) {
      target.textContent = err.message || "Could not load announcements.";
    }
  }

  function adminAnnouncementItem(item) {
    const status = announcementAdminStatus(item);
    const allowed = Array.isArray(item.allowedSections)
      ? item.allowedSections
      : ["*"];

    const audience = allowed.includes("*")
      ? "All Sections"
      : allowed.join(", ");

    return `
      <article class="admin-announcement-item">
        <div class="admin-announcement-main">
          <div class="admin-announcement-title-row">
            <strong>${escapeHtml(item.title || "Untitled Announcement")}</strong>
            <span class="announcement-status-pill ${status.className}">
              ${status.label}
            </span>
            ${item.pinned === true ? '<span class="announcement-pinned-badge">PINNED</span>' : ''}
            ${item.fileId ? '<span class="announcement-attachment-badge">ATTACHMENT</span>' : ''}
          </div>

          <p>${escapeHtml(item.message || "")}</p>

          <small>
            ${escapeHtml(audience)}
            • ${escapeHtml(formatAdminDateTime(item.publishAt))}
          </small>
        </div>

        <div class="admin-announcement-actions">
          <button class="mini-btn announcement-view-hearts"
            data-id="${escapeHtml(item.id)}"
            data-title="${escapeHtml(item.title || "Announcement")}">
            ♥ View Hearts
          </button>

          <button class="mini-btn announcement-pin"
            data-id="${escapeHtml(item.id)}"
            data-pinned="${item.pinned === true ? "1" : "0"}">
            ${item.pinned === true ? "Unpin" : "Pin"}
          </button>

          <button class="mini-btn announcement-edit"
            data-id="${escapeHtml(item.id)}">
            Edit
          </button>

          <button class="mini-btn announcement-toggle"
            data-id="${escapeHtml(item.id)}"
            data-published="${item.published ? "1" : "0"}">
            ${item.published ? "Unpublish" : "Publish"}
          </button>

          <button class="mini-btn danger announcement-delete"
            data-id="${escapeHtml(item.id)}">
            Delete
          </button>
        </div>
      </article>
    `;
  }

  function bindAnnouncementAdminButtons() {
    $$(".announcement-view-hearts").forEach(btn => {
      btn.addEventListener("click", () =>
        openAnnouncementHearts(btn.dataset.id, btn.dataset.title)
      );
    });

    $$(".announcement-pin").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ref = db.collection("announcements").doc(btn.dataset.id);
        const snap = await ref.get();
        if (!snap.exists) return;

        const current = { id: snap.id, ...snap.data() };
        const nextPinned = btn.dataset.pinned !== "1";

        if (nextPinned) {
          try {
            await ensureAnnouncementPinLimit(btn.dataset.id);
          } catch (err) {
            alert(err.message);
            return;
          }
        }

        const updated = {
          ...current,
          pinned: nextPinned,
          feedVersion: 2,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await ref.update({
          pinned: nextPinned,
          feedVersion: 2,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await syncAnnouncementFeeds(btn.dataset.id, updated);
        await loadAdminAnnouncements();
      });
    });

    $$(".announcement-edit").forEach(btn => {
      btn.addEventListener("click", () =>
        editAnnouncement(btn.dataset.id)
      );
    });

    $$(".announcement-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ref = db.collection("announcements").doc(btn.dataset.id);
        const snap = await ref.get();
        if (!snap.exists) return;

        const current = { id: snap.id, ...snap.data() };
        const nextPublished = btn.dataset.published !== "1";

        const updated = {
          ...current,
          published: nextPublished,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await ref.update({
          published: nextPublished,
          feedVersion: materialFeedVersion(btn.dataset.collection),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await syncAnnouncementFeeds(btn.dataset.id, updated);
        await loadAdminAnnouncements();
      });
    });

    $$(".announcement-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this announcement and its heart reactions?")) return;

        await deleteAnnouncement(btn.dataset.id);
        await loadAdminAnnouncements();
      });
    });
  }

  async function editAnnouncement(announcementId) {
    const snap = await db.collection("announcements").doc(announcementId).get();
    if (!snap.exists) return;

    const item = { id: snap.id, ...snap.data() };
    editingAnnouncementId = item.id;

    $("#announcementTitle").value = item.title || "";
    $("#announcementMessage").value = item.message || "";
    $("#announcementPublished").checked = item.published === true;
    $("#announcementPinned").checked = item.pinned === true;

    editingAnnouncementAttachment = item.fileId
      ? {
          fileId: item.fileId,
          fileName: item.fileName || "Google Drive attachment",
          fileType: item.fileType || "",
          fileSize: item.fileSize || null
        }
      : null;

    $("#announcementFileId").value = item.fileId || "";
    $("#announcementRemoveAttachment").checked = false;

    if (editingAnnouncementAttachment) {
      $("#announcementExistingAttachment").textContent =
        `Current attachment: ${editingAnnouncementAttachment.fileName}`;
      $("#announcementExistingAttachment").classList.remove("hidden");
      $("#announcementRemoveAttachmentRow").classList.remove("hidden");
    } else {
      $("#announcementExistingAttachment").classList.add("hidden");
      $("#announcementRemoveAttachmentRow").classList.add("hidden");
    }

    const publishDate = announcementTimestampDate(item.publishAt) || new Date();
    $("#announcementPublishAt").value = toLocalDateTimeInput(publishDate);

    renderMultiSectionPicker(
      "announcement",
      $("#announcementSectionsOptions")
    );
    setSectionPickerValues("announcement", item.allowedSections);

    $("#announcementFormHeading").textContent = "Edit Announcement";
    $("#announcementEditBadge").classList.remove("hidden");
    $("#cancelAnnouncementEditBtn").classList.remove("hidden");
    $("#saveAnnouncementBtn").textContent = "UPDATE ANNOUNCEMENT";

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteAnnouncement(announcementId) {
    const ref = db.collection("announcements").doc(announcementId);
    const snap = await ref.get();

    if (snap.exists) {
      await syncAnnouncementFeeds(
        announcementId,
        { ...snap.data(), published: false }
      );
    }

    const heartSnap = await db
      .collection("announcementHearts")
      .doc(announcementId)
      .collection("hearts")
      .get();

    for (let i = 0; i < heartSnap.docs.length; i += 350) {
      const batch = db.batch();

      heartSnap.docs.slice(i, i + 350).forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
    }

    const notificationSnap = await db
      .collection("adminNotifications")
      .where("announcementId", "==", announcementId)
      .get();

    for (let i = 0; i < notificationSnap.docs.length; i += 350) {
      const batch = db.batch();

      notificationSnap.docs.slice(i, i + 350).forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
    }

    await ref.delete();
  }

  async function openAnnouncementHearts(announcementId, title) {
    $("#adminHeartsTitle").textContent = title || "Announcement";
    $("#adminHeartsList").innerHTML = "Loading heart reactions…";
    $("#adminHeartsModal").classList.remove("hidden");

    try {
      const snap = await db
        .collection("announcementHearts")
        .doc(announcementId)
        .collection("hearts")
        .get();

      const rows = snap.docs
        .map(doc => ({ uid: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const aDate = announcementTimestampDate(a.createdAt)?.getTime() || 0;
          const bDate = announcementTimestampDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

      $("#adminHeartsList").innerHTML = rows.length
        ? `
          <div class="admin-heart-count">♥ ${rows.length} student${rows.length === 1 ? "" : "s"}</div>
          ${rows.map(row => `
            <div class="admin-heart-person">
              <div>
                <strong>${escapeHtml(row.fullName || row.studentId || "Student")}</strong>
                <small>${escapeHtml(row.studentId || "")} • ${escapeHtml(row.section || "")}</small>
              </div>
              <time>${escapeHtml(formatAdminDateTime(row.createdAt))}</time>
            </div>
          `).join("")}
        `
        : '<div class="notification-empty">No students have hearted this announcement yet.</div>';
    } catch (err) {
      $("#adminHeartsList").textContent =
        err.message || "Could not load heart reactions.";
    }
  }

  function closeAdminHeartsModal() {
    $("#adminHeartsModal").classList.add("hidden");
  }

  function startAdminNotificationListener() {
    if (!db) return;

    if (adminNotificationUnsubscribe) {
      adminNotificationUnsubscribe();
    }

    adminNotificationUnsubscribe = db
      .collection("adminNotifications")
      .where("seen", "==", false)
      .onSnapshot(snapshot => {
        currentUnreadNotifications = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => {
            const aDate = announcementTimestampDate(a.createdAt)?.getTime() || 0;
            const bDate = announcementTimestampDate(b.createdAt)?.getTime() || 0;
            return bDate - aDate;
          });

        renderAdminNotificationPanel();
      }, err => {
        console.warn("Notification listener failed:", err);
      });
  }

  function renderAdminNotificationPanel() {
    const count = currentUnreadNotifications.length;
    const badge = $("#adminNotificationBadge");

    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
    setAdminStat("#statNewHearts", count);

    $("#adminNotificationList").innerHTML = count
      ? currentUnreadNotifications.map(item => `
          <article class="admin-notification-item">
            <div class="notification-heart">♥</div>
            <div>
              <strong>${escapeHtml(item.fullName || item.studentId || "Student")}</strong>
              <p>hearted “${escapeHtml(item.announcementTitle || "Announcement")}”</p>
              <small>
                ${escapeHtml(item.section || "")}
                • ${escapeHtml(formatAdminDateTime(item.createdAt))}
              </small>
            </div>
          </article>
        `).join("")
      : '<div class="notification-empty">No new heart reactions.</div>';
  }

  function toggleAdminNotificationPanel() {
    $("#adminNotificationPanel").classList.toggle("hidden");
  }

  async function markAllAdminNotificationsRead() {
    if (!currentUnreadNotifications.length) return;

    const rows = currentUnreadNotifications.slice();

    for (let i = 0; i < rows.length; i += 350) {
      const batch = db.batch();

      rows.slice(i, i + 350).forEach(item => {
        batch.update(
          db.collection("adminNotifications").doc(item.id),
          {
            seen: true,
            seenAt: firebase.firestore.FieldValue.serverTimestamp()
          }
        );
      });

      await batch.commit();
    }
  }

  function materialFeedCollection(collectionName) {
    return collectionName === "activities" ? "activityFeeds" : "lessonFeeds";
  }

  function materialFeedVersion(collectionName) {
    // v4 explicitly republishes the full Activity attachments[] array.
    return collectionName === "activities" ? 4 : 2;
  }

  function normalizeActivityAttachmentsForFeed(payload) {
    const rows = Array.isArray(payload?.attachments)
      ? payload.attachments
      : [];

    const normalized = [];
    const seen = new Set();

    rows.forEach(file => {
      const fileId = String(file?.fileId || "").trim();
      if (!fileId || seen.has(fileId) || normalized.length >= 5) return;

      seen.add(fileId);
      normalized.push({
        fileId,
        fileName: String(file?.fileName || "Google Drive attachment").trim(),
        fileType: String(file?.fileType || "").trim(),
        fileSize:
          file?.fileSize === null || file?.fileSize === undefined
            ? null
            : Number(file.fileSize) || null
      });
    });

    // Backward compatibility: if the Activity has only the original legacy
    // file fields, convert that first file into attachments[] automatically.
    if (!normalized.length) {
      const legacyFileId = String(payload?.fileId || "").trim();

      if (legacyFileId) {
        normalized.push({
          fileId: legacyFileId,
          fileName: String(payload?.fileName || "Google Drive attachment").trim(),
          fileType: String(payload?.fileType || "").trim(),
          fileSize:
            payload?.fileSize === null || payload?.fileSize === undefined
              ? null
              : Number(payload.fileSize) || null
        });
      }
    }

    return normalized;
  }

  function materialFeedTargets(allowedSections) {
    const sections = Array.isArray(allowedSections) && allowedSections.length
      ? allowedSections
      : ["*"];

    if (sections.includes("*")) return ["ALL_SECTIONS"];

    return Array.from(new Set(
      sections.map(section => normalizeSectionName(section)).filter(Boolean)
    ));
  }

  async function clearMaterialFeeds(collectionName, documentId, allowedSections) {
    const feedCollection = materialFeedCollection(collectionName);
    const targets = materialFeedTargets(allowedSections);

    const batch = db.batch();
    targets.forEach(sectionKey => {
      const ref = db.collection(feedCollection)
        .doc(sectionKey)
        .collection("items")
        .doc(documentId);
      batch.delete(ref);
    });
    await batch.commit();
  }

  async function syncMaterialFeeds(collectionName, documentId, payload) {
    const feedCollection = materialFeedCollection(collectionName);

    // Remove any old feed copies first. This keeps re-publish/repair safe.
    // We clear all currently known section feeds plus the global feed.
    const cleanupTargets = ["ALL_SECTIONS", ...knownSections];
    const cleanupBatch = db.batch();
    cleanupTargets.forEach(sectionKey => {
      const ref = db.collection(feedCollection)
        .doc(sectionKey)
        .collection("items")
        .doc(documentId);
      cleanupBatch.delete(ref);
    });
    await cleanupBatch.commit();

    if (!payload || payload.published !== true) return;

    const targets = materialFeedTargets(payload.allowedSections);

    let feedPayload = {
      ...payload,
      sourceId: documentId,
      feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (collectionName === "activities") {
      const attachments = normalizeActivityAttachmentsForFeed(payload);
      const firstAttachment = attachments[0] || null;

      // Explicitly write the complete metadata array into every student feed.
      // This prevents the student feed from falling back to fileId only.
      feedPayload = {
        ...feedPayload,
        attachments,
        attachmentCount: attachments.length,
        attachmentSchemaVersion: 3,
        fileId: firstAttachment?.fileId || "",
        fileName: firstAttachment?.fileName || "",
        fileType: firstAttachment?.fileType || "",
        fileSize: firstAttachment?.fileSize ?? null
      };
    }

    const writeBatch = db.batch();
    targets.forEach(sectionKey => {
      const ref = db.collection(feedCollection)
        .doc(sectionKey)
        .collection("items")
        .doc(documentId);
      writeBatch.set(ref, feedPayload);
    });
    await writeBatch.commit();
  }

  async function repairMaterialFeedIfNeeded(collectionName, item) {
    if (!item || !item.id) return;

    const expectedFeedVersion = materialFeedVersion(collectionName);
    if (item.feedVersion === expectedFeedVersion) return;

    await syncMaterialFeeds(collectionName, item.id, item);

    await db.collection(collectionName).doc(item.id).set({
      feedVersion: expectedFeedVersion,
      feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    item.feedVersion = expectedFeedVersion;
  }

  async function saveLesson(e) {
    e.preventDefault();
    setStatus("#lessonStatus", "Saving lesson…");

    try {
      let fileId = G10DataService.extractDriveFileId($("#lessonFileId").value);
      let fileName = "";
      let fileType = "application/pdf";
      let fileSize = null;

      const uploaded = await maybeUploadFile($("#lessonFile"), "lessons");
      if (uploaded) {
        fileId = uploaded.fileId;
        fileName = uploaded.fileName;
        fileType = uploaded.fileType;
        fileSize = uploaded.fileSize;
      }

      const payload = {
        title: $("#lessonTitle").value.trim(),
        description: $("#lessonDescription").value.trim(),
        term: Number($("#lessonTerm").value),
        order: Number($("#lessonOrder").value),
        allowedSections: getSelectedSections("lesson"),
        fileId,
        fileName,
        fileType,
        fileSize,
        published: $("#lessonPublished").checked,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      const ref = await db.collection("lessons").add(payload);
      await syncMaterialFeeds("lessons", ref.id, payload);
      await ref.set({
        feedVersion: 2,
        feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await refreshDashboardLatest("lessons");
      $("#lessonForm").reset();
      $("#lessonTerm").value = "1";
      $("#lessonOrder").value = "1";
      $("#lessonPublished").checked = true;
      setStatus("#lessonStatus", `Lesson saved: ${ref.id}`, true);
      await loadAdminLessons();
    } catch (err) {
      setStatus("#lessonStatus", err.message, false);
    }
  }

  async function saveActivity(e) {
    e.preventDefault();
    setStatus("#activityStatus", "Saving activity…");

    try {
      const attachments = await buildActivityAttachments();
      const firstAttachment = attachments[0] || null;

      const payload = {
        title: $("#activityTitle").value.trim(),
        description: $("#activityDescription").value.trim(),
        term: Number($("#activityTerm").value),
        order: Number($("#activityOrder").value),
        dueDate: $("#activityDueDate").value || "",
        allowedSections: getSelectedSections("activity"),

        // New Activity attachment schema: zero to five file metadata objects.
        attachments,

        // Legacy fields stay populated with the first file so existing code
        // and old records remain compatible.
        fileId: firstAttachment?.fileId || "",
        fileName: firstAttachment?.fileName || "",
        fileType: firstAttachment?.fileType || "",
        fileSize: firstAttachment?.fileSize ?? null,

        published: $("#activityPublished").checked,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      const ref = await db.collection("activities").add(payload);
      await syncMaterialFeeds("activities", ref.id, payload);

      await ref.set({
        feedVersion: materialFeedVersion("activities"),
        attachmentSchemaVersion: 3,
        feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await refreshDashboardLatest("activities");

      $("#activityForm").reset();
      $("#activityTerm").value = "1";
      $("#activityOrder").value = "1";
      $("#activityPublished").checked = true;
      renderActivityAttachmentSelection();

      setStatus(
        "#activityStatus",
        `Activity saved with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ${ref.id}`,
        true
      );

      await loadAdminActivities();
    } catch (err) {
      setStatus("#activityStatus", err.message, false);
    }
  }

  function dashboardMaterialTimestamp(item) {
    const value = item?.updatedAt;

    if (value && typeof value.toMillis === "function") {
      return value.toMillis();
    }

    if (value && typeof value.seconds === "number") {
      return value.seconds * 1000;
    }

    return 0;
  }

  function materialAllowedForSection(item, section) {
    const allowed = Array.isArray(item?.allowedSections)
      ? item.allowedSections
      : [];

    if (!allowed.length) return true;
    if (allowed.includes("*")) return true;
    return allowed.includes(section);
  }

  async function refreshDashboardLatest(collectionName) {
    const isLesson = collectionName === "lessons";
    const mapField = isLesson
      ? "latestLessonBySection"
      : "latestActivityBySection";

    const legacyField = isLesson
      ? "latestLessonTitle"
      : "latestActivityTitle";

    const snap = await db.collection(collectionName)
      .where("published", "==", true)
      .get();

    const published = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => String(item.title || "").trim());

    published.sort((a, b) => {
      const timeDiff =
        dashboardMaterialTimestamp(b) - dashboardMaterialTimestamp(a);

      if (timeDiff !== 0) return timeDiff;

      const termDiff = Number(b.term || 0) - Number(a.term || 0);
      if (termDiff !== 0) return termDiff;

      return Number(b.order || 0) - Number(a.order || 0);
    });

    // Use the same section directory already derived from the student roster.
    // Each student dashboard receives only the newest published item that
    // their own section is actually allowed to see.
    const latestBySection = {};

    knownSections.forEach(section => {
      const latest = published.find(item =>
        materialAllowedForSection(item, section)
      );

      if (latest) {
        latestBySection[section] = String(latest.title || "").trim();
      }
    });

    await db.collection("settings").doc("main").set({
      [mapField]: latestBySection,

      // Remove the old global title so a deleted/unpublished item can never
      // remain as a stale fallback on student dashboards.
      [legacyField]: firebase.firestore.FieldValue.delete(),

      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function loadAdminLessons() {
    const target = $("#adminLessonsList");
    target.innerHTML = "Loading…";

    try {
      const snap = await db.collection("lessons").get();
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => Number(a.term) - Number(b.term) || Number(a.order) - Number(b.order));

      for (const item of rows) {
        await repairMaterialFeedIfNeeded("lessons", item);
      }

      target.innerHTML = rows.length ? rows.map(x => adminItem(x, "lessons")).join("") : "No lessons yet.";
      bindAdminItemButtons();

      // Self-heal dashboard latest titles from currently published lessons.
      await refreshDashboardLatest("lessons");
    } catch (err) {
      target.textContent = err.message;
    }
  }

  async function loadAdminActivities() {
    const target = $("#adminActivitiesList");
    target.innerHTML = "Loading…";

    try {
      const snap = await db.collection("activities").get();
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => Number(a.term) - Number(b.term) || Number(a.order) - Number(b.order));

      for (const item of rows) {
        await repairMaterialFeedIfNeeded("activities", item);
      }

      target.innerHTML = rows.length ? rows.map(x => adminItem(x, "activities")).join("") : "No activities yet.";
      bindAdminItemButtons();

      // Self-heal dashboard latest titles from currently published activities.
      await refreshDashboardLatest("activities");
    } catch (err) {
      target.textContent = err.message;
    }
  }

  function normalizeAdminActivityAttachments(item) {
    const attachments = Array.isArray(item?.attachments)
      ? item.attachments
          .filter(file => file && file.fileId)
          .slice(0, 5)
      : [];

    if (attachments.length) return attachments;

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

  function adminItem(x, collection) {
    const activityAttachments = collection === "activities"
      ? normalizeAdminActivityAttachments(x)
      : [];

    const attachmentMeta = collection === "activities"
      ? ` • ${activityAttachments.length} file${activityAttachments.length === 1 ? "" : "s"}`
      : "";

    return `
      <div class="admin-list-item">
        <div>
          <strong>${escapeHtml(x.title || "Untitled")}</strong>
          <small>Term ${escapeHtml(x.term)} • Order ${escapeHtml(x.order)} • ${x.published ? "Published" : "Hidden"}${attachmentMeta}</small>
        </div>
        <div class="inline-actions">
          <button class="mini-btn admin-toggle" data-collection="${collection}" data-id="${x.id}" data-published="${x.published ? "1" : "0"}">${x.published ? "Unpublish" : "Publish"}</button>
          <button class="mini-btn danger admin-delete" data-collection="${collection}" data-id="${x.id}">Delete</button>
        </div>
      </div>`;
  }

  function bindAdminItemButtons() {
    $$(".admin-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ref = db.collection(btn.dataset.collection).doc(btn.dataset.id);
        const snap = await ref.get();
        if (!snap.exists) return;

        const current = { id: snap.id, ...snap.data() };
        const nextPublished = btn.dataset.published !== "1";
        const updated = {
          ...current,
          published: nextPublished,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await ref.update({
          published: nextPublished,
          feedVersion: 2,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await syncMaterialFeeds(btn.dataset.collection, btn.dataset.id, updated);
        await refreshDashboardLatest(btn.dataset.collection);

        btn.dataset.collection === "lessons"
          ? await loadAdminLessons()
          : await loadAdminActivities();
      });
    });

    $$(".admin-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this Firestore metadata record? The Drive file itself will not be deleted by this button.")) return;

        const ref = db.collection(btn.dataset.collection).doc(btn.dataset.id);
        const snap = await ref.get();

        if (snap.exists) {
          await syncMaterialFeeds(
            btn.dataset.collection,
            btn.dataset.id,
            { ...snap.data(), published: false }
          );
        }

        await ref.delete();

        // If the deleted item was displayed on a student dashboard,
        // replace it with the next valid published item or remove the card.
        await refreshDashboardLatest(btn.dataset.collection);

        btn.dataset.collection === "lessons"
          ? await loadAdminLessons()
          : await loadAdminActivities();
      });
    });
  }

  async function createStudent(e) {
    e.preventDefault();
    setStatus("#studentStatus", "Creating student account…");

    try {
      const studentId = $("#newStudentId").value.trim();
      const password = $("#newStudentPassword").value;
      const section = getNewStudentSection();

      if (!section) {
        throw new Error("Please select or enter a section.");
      }

      if (!String(G10_CONFIG.appsScriptUrl || "").trim()) {
        throw new Error(
          "Secure student creation now uses Apps Script to avoid Firebase's client signup limit. Configure appsScriptUrl first."
        );
      }

      const student = {
        studentId,
        fullName: $("#newStudentName").value.trim(),
        gender: $("#newStudentGender").value,
        section
      };

      const result = await callAppsScriptSecure({
        action: "createStudentAccounts",
        password,
        students: [student]
      });

      const account = result.results && result.results[0];
      if (!account || !account.uid) {
        throw new Error(account?.error || "Firebase Authentication account was not created.");
      }

      const profile = {
        studentId: student.studentId,
        fullName: student.fullName,
        gender: student.gender,
        section: student.section,
        role: "student",
        active: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (account.status === "created") {
        profile.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        profile.mustChangePassword = true;
      }

      await db.collection("students").doc(account.uid).set(profile, { merge: true });

      $("#studentForm").reset();
      $("#newStudentPassword").value = "123456";
      $("#newStudentSectionCustomWrap").classList.add("hidden");
      $("#newStudentSectionCustom").required = false;

      setStatus(
        "#studentStatus",
        account.status === "created"
          ? `Student created. Login ID: ${studentId}`
          : `Existing Firebase account linked/updated. Login ID: ${studentId}`,
        true
      );

      await loadSectionDirectory(true);
      await loadStudents();
    } catch (err) {
      setStatus("#studentStatus", err.message, false);
    }
  }


  async function previewBulkStudents(e) {
    e.preventDefault();
    const input = $("#bulkStudentFile");
    const file = input.files && input.files[0];

    if (!file) {
      setStatus("#bulkStudentStatus", "Choose an Excel or CSV file first.", false);
      return;
    }

    setStatus("#bulkStudentStatus", "Reading roster…");
    $("#bulkImportBtn").disabled = true;
    $("#bulkPreviewWrap").classList.add("hidden");
    bulkStudentRows = [];

    try {
      const rows = await parseRosterFile(file);
      const normalized = normalizeRosterRows(rows);

      bulkStudentRows = normalized;
      renderBulkPreview(normalized);

      const valid = normalized.filter(r => r.valid).length;
      const invalid = normalized.length - valid;

      $("#bulkPreviewWrap").classList.remove("hidden");
      $("#bulkImportBtn").disabled = valid === 0;

      setStatus(
        "#bulkStudentStatus",
        valid
          ? `Preview ready: ${valid} valid student${valid === 1 ? "" : "s"}${invalid ? `, ${invalid} invalid row${invalid === 1 ? "" : "s"}` : ""}.`
          : "No valid student rows found. Check the required columns and values.",
        valid > 0
      );
    } catch (err) {
      setStatus("#bulkStudentStatus", err.message || "Could not read the roster file.", false);
    }
  }

  async function parseRosterFile(file) {
    const name = String(file.name || "").toLowerCase();

    if (name.endsWith(".csv")) {
      const text = await file.text();
      return parseCsvText(text);
    }

    if (!window.XLSX) {
      throw new Error("Excel parser did not load. Check your internet connection or use the CSV template.");
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      throw new Error("The Excel file has no worksheet.");
    }

    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false
    });
  }

  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    const source = String(text || "").replace(/^\uFEFF/, "");

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];

      if (ch === '"') {
        if (quoted && source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && source[i + 1] === "\n") i++;
        row.push(cell);
        if (row.some(v => String(v).trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }

    row.push(cell);
    if (row.some(v => String(v).trim() !== "")) rows.push(row);
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function normalizeRosterRows(rows) {
    if (!Array.isArray(rows) || rows.length < 2) {
      throw new Error("The roster must contain a header row and at least one student row.");
    }

    const headers = rows[0].map(normalizeHeader);

    const findIndex = variants => {
      for (const variant of variants) {
        const idx = headers.indexOf(variant);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const idIndex = findIndex(["student id", "studentid", "id"]);
    const nameIndex = findIndex(["name", "student name", "full name"]);
    const genderIndex = findIndex(["gender", "sex"]);
    const sectionIndex = findIndex(["section", "class section"]);

    const missingHeaders = [];
    if (idIndex < 0) missingHeaders.push("Student ID");
    if (nameIndex < 0) missingHeaders.push("Name");
    if (genderIndex < 0) missingHeaders.push("Gender");
    if (sectionIndex < 0) missingHeaders.push("Section");

    if (missingHeaders.length) {
      throw new Error(`Missing required column${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`);
    }

    const seen = new Set();

    return rows.slice(1)
      .filter(row => Array.isArray(row) && row.some(v => String(v).trim() !== ""))
      .map((row, index) => {
        const studentId = String(row[idIndex] ?? "").trim();
        const fullName = String(row[nameIndex] ?? "").trim();
        const rawGender = String(row[genderIndex] ?? "").trim();
        const section = String(row[sectionIndex] ?? "").trim();

        let gender = rawGender;
        if (/^m(ale)?$/i.test(rawGender)) gender = "Male";
        if (/^f(emale)?$/i.test(rawGender)) gender = "Female";

        const errors = [];
        if (!studentId) errors.push("Missing Student ID");
        if (!fullName) errors.push("Missing Name");
        if (!["Male", "Female"].includes(gender)) errors.push("Gender must be Male or Female");
        if (!section) errors.push("Missing Section");

        const key = studentId.toLowerCase();
        if (studentId && seen.has(key)) errors.push("Duplicate Student ID in file");
        if (studentId) seen.add(key);

        return {
          rowNumber: index + 2,
          studentId,
          fullName,
          gender,
          section,
          valid: errors.length === 0,
          errors
        };
      });
  }

  function renderBulkPreview(rows) {
    const valid = rows.filter(r => r.valid).length;
    const invalid = rows.length - valid;

    $("#bulkValidCount").textContent = String(valid);
    $("#bulkInvalidCount").textContent = String(invalid);
    $("#bulkTotalCount").textContent = String(rows.length);

    const previewRows = rows.slice(0, 100);

    $("#bulkStudentPreview").innerHTML = `
      <table class="preview-table bulk-roster-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Student ID</th>
            <th>Name</th>
            <th>Gender</th>
            <th>Section</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${previewRows.map(r => `
            <tr class="${r.valid ? "" : "invalid-row"}">
              <td>${r.rowNumber}</td>
              <td>${escapeHtml(r.studentId)}</td>
              <td>${escapeHtml(r.fullName)}</td>
              <td>${escapeHtml(r.gender)}</td>
              <td>${escapeHtml(r.section)}</td>
              <td>${r.valid ? '<span class="import-ok">READY</span>' : `<span class="import-bad">${escapeHtml(r.errors.join("; "))}</span>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${rows.length > 100 ? `<div class="preview-limit-note">Showing first 100 of ${rows.length} rows.</div>` : ""}
    `;
  }

  async function importBulkStudents() {
    const validRows = bulkStudentRows.filter(r => r.valid);
    if (!validRows.length) return;

    const password = $("#bulkStudentPassword").value;
    if (!password || password.length < 6) {
      setStatus("#bulkStudentStatus", "Initial password must contain at least 6 characters.", false);
      return;
    }

    if (!String(G10_CONFIG.appsScriptUrl || "").trim()) {
      setStatus(
        "#bulkStudentStatus",
        "Secure bulk account creation requires the Apps Script Web App URL in firebase-config.js.",
        false
      );
      return;
    }

    const btn = $("#bulkImportBtn");
    btn.disabled = true;

    let created = 0;
    let existing = 0;
    let failed = 0;
    const failures = [];

    try {
      const chunkSize = 50;

      for (let start = 0; start < validRows.length; start += chunkSize) {
        const chunk = validRows.slice(start, start + chunkSize);
        const end = Math.min(start + chunk.length, validRows.length);

        btn.textContent = `IMPORTING ${start + 1}-${end}/${validRows.length}…`;
        setStatus(
          "#bulkStudentStatus",
          `Creating/looking up Firebase accounts ${start + 1}-${end} of ${validRows.length}…`
        );

        const result = await callAppsScriptSecure({
          action: "createStudentAccounts",
          password,
          students: chunk.map(row => ({
            studentId: row.studentId,
            fullName: row.fullName,
            gender: row.gender,
            section: row.section
          }))
        });

        const accounts = Array.isArray(result.results) ? result.results : [];
        let batch = db.batch();
        let batchWrites = 0;

        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i];
          const account = accounts[i];

          if (!account || !account.uid) {
            failed++;
            failures.push(
              `${row.studentId}: ${account?.error || "Firebase Authentication account failed"}`
            );
            continue;
          }

          if (account.status === "created") created++;
          else existing++;

          const ref = db.collection("students").doc(account.uid);
          const profile = {
            studentId: row.studentId,
            fullName: row.fullName,
            gender: row.gender,
            section: row.section,
            role: "student",
            active: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          if (account.status === "created") {
            profile.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            profile.mustChangePassword = true;
          }

          batch.set(ref, profile, { merge: true });
          batchWrites++;

          if (batchWrites >= 400) {
            await batch.commit();
            batch = db.batch();
            batchWrites = 0;
          }
        }

        if (batchWrites > 0) {
          await batch.commit();
        }
      }

      $("#bulkStudentFile").value = "";
      bulkStudentRows = [];
      $("#bulkPreviewWrap").classList.add("hidden");

      const parts = [`New: ${created}`];
      if (existing) parts.push(`Existing/updated: ${existing}`);
      if (failed) parts.push(`Failed: ${failed}`);

      setStatus(
        "#bulkStudentStatus",
        parts.join(" • ") +
          (failures.length ? ` — ${failures.slice(0, 3).join(" | ")}` : ""),
        failed === 0
      );

      await loadSectionDirectory(true);
      await loadStudents();
    } catch (err) {
      setStatus("#bulkStudentStatus", err.message || "Bulk import failed.", false);
    } finally {
      btn.textContent = "IMPORT VALID STUDENTS";
      btn.disabled = false;
    }
  }



  // Manual Tinkercad project REVIEW tracker. This never reads Autodesk projects.
  // Private reviews are keyed by taskId and the authenticated student's UID.
  function pmCleanSection(value) {
    return normalizeSectionName(value);
  }

  function pmFillSectionOptions() {
    const sections = [...new Set(cachedStudentProfiles.map(s => pmCleanSection(s.section)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    for (const [id, allValue, allLabel] of [
      ["pmTaskSection", "ALL_SECTIONS", "All Sections"],
      ["pmSectionFilter", "*", "All Sections"]
    ]) {
      const select = $(`#${id}`);
      const old = select.value;
      select.innerHTML = `<option value="${allValue}">${allLabel}</option>` +
        sections.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
      if (sections.includes(old)) select.value = old;
    }
  }

  async function loadProjectMonitoring(force = false) {
    const serial = ++pmLoadSerial;
    const panel = $("#pmStudentList");
    panel.innerHTML = '<p class="pm-muted">Loading activity and student records…</p>';
    try {
      if (force || !cachedStudentProfiles.length) await loadStudents();
      if (serial !== pmLoadSerial) return;
      pmFillSectionOptions();
      if (!pmInitialized) {
        $("#pmTermFilter").value = String($("#settingCurrentTerm")?.value || 1);
        $("#pmTaskTerm").value = $("#pmTermFilter").value;
        pmInitialized = true;
      }
      const snap = await db.collection("tinkercadProjectTasks").get();
      if (serial !== pmLoadSerial) return;
      pmActivities = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(task => task.active !== false)
        .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
      renderProjectTaskOptions();
      setStatus("#pmAdminStatus", "", null);
    } catch (err) {
      if (serial !== pmLoadSerial) return;
      panel.textContent = "Could not load project monitoring. Check Firestore Rules and connection.";
      setStatus("#pmAdminStatus", err.message || "Unable to load project review data.", false);
    }
  }

  function renderProjectTaskOptions(preferredId = "") {
    const term = Number($("#pmTermFilter").value);
    const section = $("#pmSectionFilter").value;
    const select = $("#pmTaskFilter");
    const old = preferredId || select.value;
    const visible = pmActivities.filter(task => Number(task.term) === term &&
      (section === "*" || task.section === "ALL_SECTIONS" || pmCleanSection(task.section) === section));
    select.innerHTML = visible.length
      ? visible.map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title || "Untitled")} · ${escapeHtml(task.section === "ALL_SECTIONS" ? "All Sections" : task.section || "All Sections")}</option>`).join("")
      : '<option value="">No activities in this term/section</option>';
    if (visible.some(task => task.id === old)) select.value = old;
    $("#pmArchiveTask").disabled = !select.value;
    void loadProjectReviewRecords();
  }

  async function createProjectMonitoringActivity(event) {
    event.preventDefault();
    const title = $("#pmTaskTitle").value.trim().replace(/\s+/g, " ");
    const term = Number($("#pmTaskTerm").value);
    const section = $("#pmTaskSection").value;
    if (title.length < 3 || title.length > 100 || ![1, 2, 3].includes(term) || !section) {
      return setStatus("#pmTaskMessage", "Enter a title (3–100 characters), term and valid section.", false);
    }
    if (pmActivities.some(task => Number(task.term) === term && task.section === section &&
      String(task.title || "").trim().toLowerCase() === title.toLowerCase())) {
      return setStatus("#pmTaskMessage", "This activity already exists for the selected term and section.", false);
    }
    const button = $("#pmCreateTaskBtn");
    setBusy(button, true, "CREATING…");
    try {
      const ref = db.collection("tinkercadProjectTasks").doc();
      await ref.set({ title, term, section, active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: admin.uid || "" });
      $("#pmTaskTitle").value = "";
      $("#pmTermFilter").value = String(term);
      $("#pmSectionFilter").value = section === "ALL_SECTIONS" ? "*" : section;
      await loadProjectMonitoring(true);
      renderProjectTaskOptions(ref.id);
      setStatus("#pmTaskMessage", `Created “${title}”. Review students below.`, true);
    } catch (err) {
      setStatus("#pmTaskMessage", err.message || "Could not save activity.", false);
    } finally {
      setBusy(button, false, "CREATE ACTIVITY");
    }
  }

  async function archiveProjectMonitoringActivity() {
    const taskId = $("#pmTaskFilter").value;
    const task = pmActivities.find(item => item.id === taskId);
    if (!task || !confirm(`Archive “${task.title}”? It will disappear from student review lists, but prior teacher review records will remain in Firestore.`)) return;
    const button = $("#pmArchiveTask");
    button.disabled = true;
    try {
      await db.collection("tinkercadProjectTasks").doc(taskId).update({
        active: false, archivedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await loadProjectMonitoring(true);
      setStatus("#pmAdminStatus", "Activity archived. Prior review records are retained.", true);
    } catch (err) {
      setStatus("#pmAdminStatus", err.message || "Archive failed.", false);
      button.disabled = false;
    }
  }

  async function loadProjectReviewRecords() {
    const serial = ++pmLoadSerial;
    const taskId = $("#pmTaskFilter").value;
    const task = pmActivities.find(item => item.id === taskId);
    const target = $("#pmStudentList");
    pmReviewMap = new Map();
    if (!task) {
      pmDisplayStudents = [];
      $("#pmSummary").textContent = "";
      target.innerHTML = '<p class="pm-muted">Create or select an activity to review students.</p>';
      $("#pmArchiveTask").disabled = true;
      return;
    }
    $("#pmArchiveTask").disabled = false;
    target.innerHTML = '<p class="pm-muted">Loading student review statuses…</p>';
    try {
      // One query per activity, not one query per student.
      const snap = await db.collection("tinkercadProjectReviews").doc(taskId).collection("students").get();
      if (serial !== pmLoadSerial) return;
      pmReviewMap = new Map(snap.docs.map(doc => [doc.id, doc.data()]));
      renderProjectReviewStudents();
    } catch (err) {
      if (serial !== pmLoadSerial) return;
      target.textContent = "Cannot read project review records.";
      setStatus("#pmAdminStatus", err.message || "Review read failed.", false);
    }
  }

  function renderProjectReviewStudents() {
    const task = pmActivities.find(item => item.id === $("#pmTaskFilter").value);
    if (!task) return;
    const section = $("#pmSectionFilter").value;
    const search = String($("#pmStudentSearch").value || "").trim().toLowerCase();
    pmDisplayStudents = cachedStudentProfiles.filter(s => {
      const ownSection = pmCleanSection(s.section);
      return (task.section === "ALL_SECTIONS" || ownSection === pmCleanSection(task.section)) &&
        (section === "*" || ownSection === section) &&
        (!search || `${s.fullName || ""} ${s.studentId || ""} ${ownSection}`.toLowerCase().includes(search));
    }).sort((a,b) => String(a.fullName || a.studentId || "").localeCompare(String(b.fullName || b.studentId || "")));
    const counts = { "not-reviewed": 0, "for-checking": 0, "checked": 0, "needs-revision": 0 };
    pmDisplayStudents.forEach(student => {
      const state = pmReviewMap.get(student.uid)?.status;
      counts[PM_STATUSES[state] ? state : "not-reviewed"]++;
    });
    $("#pmSummary").innerHTML = `<span>${pmDisplayStudents.length} students</span>` +
      Object.entries(counts).map(([status, count]) => `<span class="pm-chip pm-${status}">${escapeHtml(PM_STATUSES[status])}: ${count}</span>`).join("");
    $("#pmStudentList").innerHTML = pmDisplayStudents.length ? pmDisplayStudents.map((student, index) => {
      const review = pmReviewMap.get(student.uid) || {};
      const status = PM_STATUSES[review.status] ? review.status : "not-reviewed";
      const options = Object.entries(PM_STATUSES).map(([key, label]) =>
        `<option value="${key}" ${key === status ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
      return `<article class="pm-review-row" data-pm-uid="${escapeHtml(student.uid)}">
        <div class="pm-review-person"><span class="pm-number">${index + 1}</span><div><strong>${escapeHtml(student.fullName || student.studentId || "Student")}</strong><small>${escapeHtml(student.studentId || "No Student ID")} · ${escapeHtml(student.section || "Unknown section")}</small></div></div>
        <div class="pm-review-editor"><label><span>Status</span><select data-pm-status aria-label="Review status for ${escapeHtml(student.fullName || student.studentId || "student")}">${options}</select></label>
          <label><span>Teacher feedback (optional)</span><textarea data-pm-note rows="2" maxlength="500" placeholder="e.g. Check resistor wiring">${escapeHtml(review.note || "")}</textarea></label>
          <button class="mini-btn pm-save-review" type="button" data-pm-save="${escapeHtml(student.uid)}">SAVE & NEXT →</button></div>
      </article>`;
    }).join("") : '<p class="pm-muted">No students match these filters.</p>';
  }

  async function saveProjectReviewFromList(event) {
    const button = event.target.closest("[data-pm-save]");
    if (!button) return;
    const taskId = $("#pmTaskFilter").value;
    const task = pmActivities.find(item => item.id === taskId);
    const uid = button.dataset.pmSave;
    const student = pmDisplayStudents.find(item => item.uid === uid);
    const row = button.closest("[data-pm-uid]");
    if (!task || !student || !row) return;
    const status = row.querySelector("[data-pm-status]").value;
    const note = row.querySelector("[data-pm-note]").value.trim();
    if (!PM_STATUSES[status] || note.length > 500) return;
    const nextRow = row.nextElementSibling;
    setBusy(button, true, "SAVING…");
    try {
      await db.collection("tinkercadProjectReviews").doc(taskId).collection("students").doc(uid).set({
        taskId, studentUid: uid, status, note,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        reviewedBy: admin.uid || ""
      });
      // The administrator might have changed activities while the write ran.
      // Never redraw a different activity's counts or status after that.
      if (taskId !== $("#pmTaskFilter").value) return;
      pmReviewMap.set(uid, { status, note });
      setStatus("#pmAdminStatus", `Saved: ${student.fullName || student.studentId} — ${PM_STATUSES[status]}.`, true);
      // Recompute counts but don't recreate the rows: preserve the teacher's
      // unsaved feedback and status selections elsewhere in this activity.
      const counts = { "not-reviewed": 0, "for-checking": 0, "checked": 0, "needs-revision": 0 };
      pmDisplayStudents.forEach(s => {
        const state = pmReviewMap.get(s.uid)?.status;
        counts[PM_STATUSES[state] ? state : "not-reviewed"]++;
      });
      $("#pmSummary").innerHTML = `<span>${pmDisplayStudents.length} students</span>` +
        Object.entries(counts).map(([key, count]) => `<span class="pm-chip pm-${key}">${escapeHtml(PM_STATUSES[key])}: ${count}</span>`).join("");
      button.textContent = "SAVED ✓";
      button.disabled = false;
      if (nextRow?.matches("[data-pm-uid]")) {
        nextRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
        nextRow.querySelector("[data-pm-status]")?.focus({ preventScroll: true });
      }
    } catch (err) {
      setStatus("#pmAdminStatus", err.message || "Could not save the student's review.", false);
      button.disabled = false;
      button.textContent = "RETRY SAVE";
    }
  }

  // Tinkercad seats are created in the official Tinkercad teacher account.
  // The portal stores ONE classroom link; student nicknames are the existing
  // Student IDs (unchanged, including hyphens). This never provisions seats.
  function parseTinkercadClassLink(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" ||
          !["www.tinkercad.com", "tinkercad.com"].includes(url.hostname) ||
          url.port || url.username || url.password || url.search || url.hash) throw new Error();
      const match = url.pathname.match(/^\/joinclass\/([A-Za-z0-9]{5,20})\/?$/);
      if (!match) throw new Error();
      return { classCode: match[1], classLink: `https://www.tinkercad.com/joinclass/${match[1]}` };
    } catch (_) {
      throw new Error("Enter a valid Tinkercad Class Invitation Link, for example https://www.tinkercad.com/joinclass/R6NEARGUX");
    }
  }

  function previewTinkercadClassCode() {
    const preview = $("#tcAdminClassPreview");
    try {
      const { classCode } = parseTinkercadClassLink($("#tcAdminClassLink").value);
      preview.textContent = `Class Code: ${classCode}`;
      preview.classList.remove("tc-preview-invalid");
    } catch (_) {
      preview.textContent = "Enter a valid Tinkercad /joinclass/ link to extract the Class Code.";
      preview.classList.add("tc-preview-invalid");
    }
  }

  async function loadTinkercadManager(force = false) {
    const serial = ++tinkercadLoadingSerial;
    const roster = $("#tcAdminRoster");
    roster.textContent = "Loading student records…";
    try {
      // refresh roster when required; class config always read from Firestore
      if (force || !cachedStudentProfiles.length) await loadStudents();
      const snapshot = await db.collection("settings").doc("tinkercadClassroom").get();
      if (serial !== tinkercadLoadingSerial) return;
      tinkercadClassConfig = snapshot.exists ? snapshot.data() || {} : null;
      if (tinkercadClassConfig?.classLink) {
        $("#tcAdminClassLink").value = tinkercadClassConfig.classLink;
        $("#tcAdminEnabled").checked = tinkercadClassConfig.enabled === true;
      }
      previewTinkercadClassCode();
      fillTinkercadSectionFilter();
      renderTinkercadRoster();
    } catch (err) {
      if (serial !== tinkercadLoadingSerial) return;
      roster.textContent = err.message || "Could not load classroom details.";
      setStatus("#tinkercadAdminStatus", err.message || "Check Firestore access and try again.", false);
    }
  }

  function fillTinkercadSectionFilter() {
    const select = $("#tcAdminSection");
    const previous = select.value;
    const sections = [...new Set(cachedStudentProfiles.map(s => normalizeSectionName(s.section)).filter(Boolean))].sort();
    select.innerHTML = '<option value="*">All Sections</option>' +
      sections.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    if (sections.includes(previous)) select.value = previous;
  }

  function selectTinkercadStudent(uid) {
    const student = cachedStudentProfiles.find(s => s.uid === uid);
    if (!student) return;
    $("#tcAdminSearch").value = String(student.studentId || student.fullName || "");
    $("#tcAdminSection").value = "*";
    renderTinkercadRoster();
    $("#tcAdminRoster").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function saveTinkercadClassroom(event) {
    event.preventDefault();
    const btn = $("#tcAdminSaveBtn");
    let info;
    try {
      info = parseTinkercadClassLink($("#tcAdminClassLink").value);
    } catch (err) {
      return setStatus("#tinkercadAdminStatus", err.message, false);
    }
    const enabled = $("#tcAdminEnabled").checked;
    setBusy(btn, true, "SAVING…");
    try {
      await db.collection("settings").doc("tinkercadClassroom").set({
        ...info, enabled,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: admin.uid || ""
      });
      tinkercadClassConfig = { ...info, enabled };
      $("#tcAdminClassLink").value = info.classLink;
      previewTinkercadClassCode();
      renderTinkercadRoster();
      setStatus("#tinkercadAdminStatus", enabled
        ? "Classroom saved for all students in Arduino Hub. Verify the matching Tinkercad Class Seats before student login."
        : "Classroom settings saved. Student display is currently disabled.", true);
    } catch (err) {
      setStatus("#tinkercadAdminStatus", err.message || "Could not save classroom setting.", false);
    } finally {
      setBusy(btn, false, "SAVE CLASSROOM FOR ALL STUDENTS");
    }
  }

  function renderTinkercadRoster() {
    const search = $("#tcAdminSearch").value.trim().toLowerCase();
    const section = $("#tcAdminSection").value;
    const rows = cachedStudentProfiles.filter(s =>
      (section === "*" || normalizeSectionName(s.section) === section) &&
      (!search || [s.fullName, s.studentId, s.section].join(" ").toLowerCase().includes(search))
    );
    const presentIds = new Map();
    for (const s of cachedStudentProfiles) {
      const key = String(s.studentId || "").trim().toLowerCase();
      if (key) presentIds.set(key, (presentIds.get(key) || 0) + 1);
    }
    const invalid = cachedStudentProfiles.filter(s => !String(s.studentId || "").trim() ||
      presentIds.get(String(s.studentId || "").trim().toLowerCase()) > 1).length;
    const status = tinkercadClassConfig?.enabled === true ? "Classroom active" : "Classroom not active";
    $("#tcAdminStats").textContent = `${status} · ${cachedStudentProfiles.length} students · ${invalid} missing/duplicate Student IDs · Tinkercad seat matching not verified`;
    $("#tcAdminRoster").innerHTML = rows.length ? rows.map(s => {
      const id = String(s.studentId || "").trim();
      const duplicate = id && presentIds.get(id.toLowerCase()) > 1;
      const needsReview = !id || duplicate;
      return `<div class="tc-roster-row" data-tc-student-uid="${escapeHtml(s.uid)}">
        <span><strong>${escapeHtml(s.fullName || s.studentId || "Student")}</strong><small>${escapeHtml(s.section || "Grade 10")} · ${escapeHtml(id || "Missing Student ID")}</small></span>
        <span class="tc-roster-login"><small>Student Login</small><strong>${escapeHtml(id || "—")}</strong><em class="tc-roster-state ${needsReview ? "tc-state-warning" : ""}">${needsReview ? "Review ID" : "From record"}</em></span>
      </div>`;
    }).join("") : '<div class="tc-student-placeholder">No students match this filter.</div>';
  }

  async function loadStudents() {
    const target = $("#adminStudentsList");
    target.textContent = "Loading…";

    try {
      const snap = await db.collection("students").orderBy("fullName").get();
      cachedStudentProfiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

      const freshSections = Array.from(new Set(
        cachedStudentProfiles
          .map(student => normalizeSectionName(student.section))
          .filter(Boolean)
      )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      if (JSON.stringify(freshSections) !== JSON.stringify(knownSections)) {
        knownSections = freshSections;
        renderSectionControls();
      }

      renderStudentProfiles();
    } catch (err) {
      target.textContent = err.message;
    }
  }

  // Single source of truth for list order and the View Scores navigation.
  function filteredStudentProfiles() {
    const selectedSection = $("#studentSectionFilter")?.value || "*";
    const searchQuery = String($("#studentSearchInput")?.value || "")
      .trim()
      .toLowerCase();

    let rows = selectedSection === "*"
      ? cachedStudentProfiles.slice()
      : cachedStudentProfiles.filter(
          student =>
            normalizeSectionName(student.section) === selectedSection
        );

    if (searchQuery) {
      rows = rows.filter(student => {
        const searchable = [
          student.fullName,
          student.studentId,
          student.section
        ]
          .map(value => String(value || "").toLowerCase())
          .join(" ");

        return searchable.includes(searchQuery);
      });
    }

    return rows;
  }

  function renderStudentProfiles() {
    const target = $("#adminStudentsList");
    if (!target) return;
    const rows = filteredStudentProfiles();

    target.innerHTML = rows.length ? rows.map(s => `
      <div class="admin-list-item student-profile-list-item">
        <div class="student-profile-list-copy">
          <button class="student-profile-name-btn" type="button" data-student-profile-uid="${s.uid}">
            ${escapeHtml(s.fullName || s.studentId)}
          </button>

          <div class="student-profile-meta">
            <span class="student-profile-id">${escapeHtml(s.studentId || "")}</span>
            <span class="student-profile-meta-dot" aria-hidden="true">•</span>
            <span class="student-profile-section">${escapeHtml(s.section || "")}</span>
          </div>

          <div class="student-profile-submeta">
            <span>${escapeHtml(s.gender || "—")}</span>
            <span aria-hidden="true">•</span>
            <span class="${s.active === false ? "student-state-inactive" : "student-state-active"}">
              ${s.active === false ? "Inactive" : "Active"}
            </span>
          </div>
        </div>

        <div class="inline-actions student-profile-actions">
          <button class="mini-btn student-view-compliance" type="button" data-student-profile-uid="${s.uid}">View Scores</button>
          <button class="mini-btn" type="button" data-assign-tinkercad-uid="${s.uid}">Tinkercad</button>
          <button
            class="mini-btn student-reset-password"
            type="button"
            data-student-reset-uid="${s.uid}">
            Reset Pass
          </button>
          <button class="mini-btn student-toggle" data-uid="${s.uid}" data-active="${s.active === false ? "0" : "1"}">${s.active === false ? "Activate" : "Deactivate"}</button>
          <button
            class="mini-btn student-delete"
            type="button"
            data-student-delete-uid="${s.uid}">
            Delete
          </button>
        </div>
      </div>`).join("") : "No students found for this section.";

    $$("[data-student-profile-uid]").forEach(btn => {
      btn.addEventListener("click", () => {
        openStudentComplianceProfile(btn.dataset.studentProfileUid, null, "students");
      });
    });

    $$(`[data-assign-tinkercad-uid]`).forEach(btn => {
      btn.addEventListener("click", async () => {
        await openAdminPage("tinkercad");
        selectTinkercadStudent(btn.dataset.assignTinkercadUid);
      });
    });

    $$("[data-student-reset-uid]").forEach(btn => {
      btn.addEventListener("click", () => {
        resetStudentPasswordFromProfile(btn.dataset.studentResetUid, btn);
      });
    });

    $$("[data-student-delete-uid]").forEach(btn => {
      btn.addEventListener("click", () => {
        deleteStudentFromProfile(btn.dataset.studentDeleteUid, btn);
      });
    });

    $$(".student-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        await db.collection("students").doc(btn.dataset.uid).update({
          active: btn.dataset.active !== "1",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadStudents();
      });
    });
  }




  function getCachedStudentByUid(uid) {
    return cachedStudentProfiles.find(student => student.uid === uid) || null;
  }

  async function resetStudentPasswordFromProfile(uid, button) {
    const student = getCachedStudentByUid(uid);
    if (!student) {
      alert("Student profile is no longer available. Refresh the list and try again.");
      return;
    }

    const confirmed = confirm(
      `Reset the password of ${student.fullName || student.studentId}?\n\n` +
      `A new temporary password will be generated. The student must change it after the next login.`
    );

    if (!confirmed) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Resetting…";

    try {
      const result = await callAppsScriptSecure({
        action: "resetStudentPassword",
        uid: student.uid,
        studentId: student.studentId
      });

      if (!result?.temporaryPassword) {
        throw new Error("The temporary password was not returned.");
      }

      await db.collection("students").doc(student.uid).set({
        mustChangePassword: true,
        passwordResetAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      $("#studentPasswordResetMeta").textContent = [
        student.fullName || student.studentId,
        student.studentId
      ].filter(Boolean).join(" • ");

      $("#studentTemporaryPassword").textContent = result.temporaryPassword;
      $("#copyStudentTemporaryPassword").textContent = "Copy";

      $("#studentPasswordResetModal").classList.remove("hidden");
      document.body.classList.add("modal-open");
    } catch (err) {
      alert(err.message || "Password reset failed.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function closeStudentPasswordResetModal() {
    $("#studentPasswordResetModal").classList.add("hidden");
    $("#studentTemporaryPassword").textContent = "—";

    if (
      $("#studentComplianceModal").classList.contains("hidden") &&
      $("#missingComplianceModal").classList.contains("hidden")
    ) {
      document.body.classList.remove("modal-open");
    }
  }

  async function copyStudentTemporaryPassword() {
    const value = $("#studentTemporaryPassword").textContent.trim();
    if (!value || value === "—") return;

    const button = $("#copyStudentTemporaryPassword");

    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand("copy");
        button.textContent = "Copied";
      } finally {
        textarea.remove();
      }
    }

    setTimeout(() => {
      if (button) button.textContent = "Copy";
    }, 1500);
  }

  async function deleteStudentFromProfile(uid, button) {
    const student = getCachedStudentByUid(uid);
    if (!student) {
      alert("Student profile is no longer available. Refresh the list and try again.");
      return;
    }

    const studentName = student.fullName || student.studentId;
    const studentId = String(student.studentId || "").trim();

    const confirmed = confirm(
      `DELETE STUDENT?\n\n` +
      `${studentName}\n${studentId}\n\n` +
      `This removes the student's Firebase login and current Student Profile.\n\n` +
      `Compliance/score history is intentionally KEPT using Student ID ${studentId}. ` +
      `If you add the same Student ID again, the next Compliance Sync can match the same Sheet record.\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    const secondConfirmed = confirm(
      `Final confirmation: permanently delete the login/profile for ${studentName}?`
    );

    if (!secondConfirmed) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Deleting…";

    try {
      await callAppsScriptSecure({
        action: "deleteStudentAccount",
        uid: student.uid,
        studentId
      });

      // Delete only the current roster/profile document.
      // DO NOT delete studentCompliance/adminCompliance because those are
      // keyed by Student ID and are needed for safe re-add/re-sync continuity.
      await db.collection("students").doc(student.uid).delete();

      cachedStudentProfiles = cachedStudentProfiles.filter(
        item => item.uid !== student.uid
      );

      renderStudentProfiles();
      await loadSectionDirectory(true);

      alert(
        `${studentName} was deleted.\n\n` +
        `Academic/Compliance history for Student ID ${studentId} was preserved.`
      );
    } catch (err) {
      alert(
        (err.message || "Student deletion failed.") +
        "\n\nNo Compliance/score history was deleted."
      );

      // Refresh because Firebase Auth may have completed even if a later
      // profile cleanup step failed.
      await loadStudents().catch(() => {});
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }



  // Admin-only analytics reads the SAME student-facing published documents that
  // drive students' running grades. Never re-calculates grades from raw tasks.
  async function loadPerformanceDashboard(force = false) {
    const serial = ++performanceLoadSerial;
    const term = Number($("#perfTerm").value || currentAdminTerm());
    const message = $("#perfLoading");
    message.classList.remove("hidden");
    message.textContent = "Loading student roster and published Term " + term + " records…";
    $("#perfRefresh").disabled = true;
    if (force) $("#perfContent").classList.add("hidden");
    try {
      const rosterSnap = await db.collection("students").get();
      if (serial !== performanceLoadSerial) return;
      cachedStudentProfiles = rosterSnap.docs.map(d => ({ uid: d.id, ...d.data() }))
        .sort((a,b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));
      const students = cachedStudentProfiles.filter(s => s.active !== false);
      const duplicateIdCounts = new Map();
      for (const student of students) {
        const id = G10DataService.normalizeStudentId(student.studentId);
        if (id) duplicateIdCounts.set(id, (duplicateIdCounts.get(id) || 0) + 1);
      }
      const snapshots = new Map();
      for (let i = 0; i < students.length; i += 18) {
        if (serial !== performanceLoadSerial) return;
        const group = students.slice(i, i + 18);
        const results = await Promise.all(group.map(async student => {
          const id = G10DataService.normalizeStudentId(student.studentId);
          if (!id || duplicateIdCounts.get(id) !== 1) return { uid: student.uid, current: null, previous: null, comparison: null };
          const ref = db.collection("studentCompliance").doc(id).collection("terms");
          const adminRef = db.collection("adminCompliance").doc(id).collection("terms");
          const [currentSnap, previousSnap, currentAdminSnap] = await Promise.all([
            ref.doc(`term${term}`).get(),
            term === 1 ? Promise.resolve(null) : ref.doc(`term${term - 1}`).get(),
            term === 1 ? Promise.resolve(null) : adminRef.doc(`term${term}`).get()
          ]);
          // Protect against stale/foreign records if a Student ID was reused.
          const validData = snap => {
            if (!snap?.exists) return null;
            const data = snap.data() || {};
            const storedUid = String(data.studentUid || "").trim();
            return (!storedUid || storedUid === student.uid) ? data : null;
          };
          const adminData = validData(currentAdminSnap);
          return { uid: student.uid, current: validData(currentSnap),
            previous: validData(previousSnap),
            comparison: adminData?.gradeComparison || null };
        }));
        if (serial !== performanceLoadSerial) return;
        results.forEach(item => snapshots.set(item.uid, item));
        message.textContent = `Reading published grades… ${Math.min(i + 18, students.length)} of ${students.length} students`;
      }
      if (serial !== performanceLoadSerial) return;
      performanceModel = G10PerformanceAnalytics.build(students, snapshots, term);
      const timestamp = new Date();
      $("#perfLastUpdated").textContent = `Refreshed ${timestamp.toLocaleString()}`;
      message.classList.add("hidden");
      $("#perfContent").classList.remove("hidden");
      if (performanceSelectedSection !== "*" &&
          !performanceModel.sections.some(s => s.name === performanceSelectedSection)) performanceSelectedSection = "*";
      renderPerformanceDashboard();
    } catch (error) {
      if (serial !== performanceLoadSerial) return;
      // Do not show partial/misleading statistics on permission/network errors.
      performanceModel = null;
      $("#perfContent").classList.add("hidden");
      message.textContent = `Unable to load complete published data: ${error?.message || "Unknown error"}. Refresh to retry. No counts were calculated from partial data.`;
    } finally {
      if (serial === performanceLoadSerial) $("#perfRefresh").disabled = false;
    }
  }

  function performanceGradeText(value) {
    return value === null || value === undefined ? "—" : String(Math.round(value * 100) / 100);
  }

  function performanceStatusPill(label, type = "neutral") {
    return `<span class="perf-pill perf-pill-${escapeHtml(type)}">${escapeHtml(label)}</span>`;
  }

  function performanceStatCard(title, value, subtitle) {
    return `<article class="perf-stat-card"><small>${escapeHtml(title)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(subtitle)}</span></article>`;
  }

  function selectPerformanceSection(section) {
    performanceSelectedSection = section;
    $("#perfBand").value = "*";
    $("#perfTrend").value = "*";
    $("#perfRequirements").value = "*";
    $("#perfSearch").value = "";
    renderPerformanceDashboard();
  }

  function renderPerformanceDashboard() {
    if (!performanceModel) return;
    const model = performanceModel;
    const all = model.stats;
    $("#perfTopStats").innerHTML = [
      performanceStatCard("TOTAL STUDENTS", all.total, `${model.sections.length} sections`),
      performanceStatCard("PUBLISHED RECORDS", all.published, `${all.total ? (100 * all.published / all.total).toFixed(1) : "0"}% coverage • ${all.notPublished} not published`),
      performanceStatCard("WITH LACKINGS", all.missing, "Published records only"),
      performanceStatCard(model.term === 1 ? "GRADE MOVEMENT" : `IMPROVED VS TERM ${model.term - 1}`, model.term === 1 ? "N/A" : all.improved, model.term === 1 ? "Select Term 2 or 3" : `${all.comparable} comparable • ${all.declined} declined • ${all.unchanged} unchanged`)
    ].join("");
    $("#perfSections").innerHTML = model.sections.map(item => `
      <button type="button" class="perf-section-card ${item.name === performanceSelectedSection ? "is-active" : ""}"
        data-perf-section="${escapeHtml(item.name)}">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.stats.total} students • ${item.stats.published} published</span>
        <small>${item.stats.missing} with lackings • ${item.stats.notPublished} not published</small>
      </button>`).join("");
    $("#perfSectionTitle").textContent = performanceSelectedSection === "*" ? "All Sections" : performanceSelectedSection;
    const selected = performanceSelectedSection === "*" ? { rows: model.rows, stats: all } :
      model.sections.find(item => item.name === performanceSelectedSection) || { rows: [], stats: G10PerformanceAnalytics.summary([]) };
    const stats = selected.stats;
    $("#perfSectionStats").innerHTML = [
      performanceStatCard("AVERAGE RUNNING GRADE", performanceGradeText(stats.average), `${stats.graded} numeric grades`),
      performanceStatCard("NO LACKINGS", stats.complete, "Published with known completion"),
      performanceStatCard("WITH LACKINGS", stats.missing, "Published with missing tasks"),
      performanceStatCard("NOT YET PUBLISHED", stats.notPublished, `${stats.noGrade} published without numeric grade`)
    ].join("");
    const highest = Math.max(1, ...Object.values(stats.distribution));
    $("#perfGradeChart").innerHTML = G10PerformanceAnalytics.BANDS.map(item => {
      const count = stats.distribution[item.key];
      return `<button type="button" class="perf-grade-row" data-perf-band="${item.key}"
        aria-label="Filter ${escapeHtml(item.label)} grade band, ${count} students">
        <span class="perf-grade-label"><i class="perf-swatch perf-swatch-${item.key}"></i>${escapeHtml(item.label)}</span>
        <span class="perf-grade-bar"><i class="perf-grade-fill perf-fill-${item.key}" style="width:${(100*count/highest).toFixed(1)}%"></i></span>
        <strong>${count}</strong></button>`;
    }).join("");
    $("#perfGradeNote").textContent = `${stats.graded} numeric grades included • ${stats.noGrade} published without numeric grade`;
    $("#perfMovementHeading").textContent = model.term === 1 ? "Grade Movement" : `Grade Movement: Term ${model.term - 1} → Term ${model.term}`;
    $("#perfTrends").innerHTML = model.term === 1
      ? '<p class="perf-muted">Term 1 is the baseline. Select Term 2 or Term 3 to see grade movement.</p>'
      : `<div class="perf-trend-grid">${[
        ["Improved", stats.improved, "improved"],
        ["Declined", stats.declined, "declined"],
        ["Unchanged", stats.unchanged, "unchanged"]
      ].map(([label, count, type]) => `<div class="perf-trend-${type}"><strong>${count}</strong><small>${label}</small></div>`).join("")}</div>`;
    $("#perfTrendNote").textContent = model.term === 1 ? "No comparisons for the first term." :
      `${stats.comparable} compared • ${stats.graded - stats.comparable >= 0 ? stats.graded - stats.comparable : 0} current grades lack valid previous grades. ` +
      (stats.comparable === 0 && stats.graded ? "If previous-term sheets have grades, redeploy Apps Script, then Sync & Publish the current term." :
      `Comparison uses the previous term's sheet where available, otherwise the published previous-term record.`);
    const priority = selected.rows.filter(r => r.priority).sort((a,b) =>
      Number(b.trend === "declined") - Number(a.trend === "declined") || (b.missing || 0) - (a.missing || 0) || (a.grade ?? 101) - (b.grade ?? 101));
    $("#perfPriority").innerHTML = priority.length ? priority.map(r => `
      <button class="perf-priority-item" type="button" data-perf-scores="${escapeHtml(r.uid)}">
        <span><strong>${escapeHtml(r.fullName)}</strong><small>${escapeHtml(r.section)} • ${escapeHtml(r.studentId)}</small></span>
        <span>${r.trend === "declined" ? performanceStatusPill("Declined", "declined") : ""}
          ${r.missing >= 2 ? performanceStatusPill(`${r.missing} lacking`, "missing") : ""}
          ${r.grade !== null && r.grade < 75 ? performanceStatusPill("Below 75", "missing") : ""}</span>
      </button>`).join("") : '<p class="perf-muted">No priority students based on the published records in this selection.</p>';
    renderPerformanceStudentTable();
  }

  function performanceFiltered() {
    if (!performanceModel) return [];
    const band = $("#perfBand").value;
    const trend = $("#perfTrend").value;
    const requirement = $("#perfRequirements").value;
    const query = $("#perfSearch").value.toLowerCase().trim();
    return performanceModel.rows.filter(r =>
      (performanceSelectedSection === "*" || r.section === performanceSelectedSection) &&
      (band === "*" || r.band === band) && (trend === "*" || r.trend === trend) &&
      (requirement === "*" || (requirement === "missing" && r.published && r.missing > 0) ||
        (requirement === "complete" && r.published && r.missing === 0) ||
        (requirement === "unpublished" && !r.published) ||
        (requirement === "nograde" && r.published && r.grade === null)) &&
      (!query || `${r.fullName} ${r.studentId} ${r.section}`.toLowerCase().includes(query))
    );
  }

  function renderPerformanceStudentTable() {
    if (!performanceModel) return;
    performanceDisplayedRows = performanceFiltered();
    const sectionTotal = performanceSelectedSection === "*" ? performanceModel.rows.length :
      performanceModel.rows.filter(r => r.section === performanceSelectedSection).length;
    $("#perfVisibleCount").textContent = `${performanceDisplayedRows.length} of ${sectionTotal} students`;
    const table = $("#perfStudents");
    table.innerHTML = performanceDisplayedRows.length ? performanceDisplayedRows.map(r => {
      const gradeText = !r.published ? 'Not published' : r.gradeIncomplete ? 'INC' :
        r.grade === null ? 'Not available' : performanceGradeText(r.grade);
      const gradeLabel = r.grade === null ? escapeHtml(gradeText) :
        `${performanceStatusPill(gradeText, `band-${r.band}`)}`;
      const trendText = r.trend === "unavailable"
        ? (r.trendReason || "Not comparable")
        : `${r.trend === 'improved' ? '↑' : r.trend === 'declined' ? '↓' : '→'} ${r.delta > 0 ? '+' : ''}${performanceGradeText(r.delta)} (${r.trend}) • T${performanceModel.term - 1}: ${performanceGradeText(r.previous)}`;
      const missingText = !r.published ? 'Not published' : r.missing === null ? 'Status unavailable' :
        r.missing === 0 ? 'Complete' : `${r.missing} lacking`;
      return `<tr><td><strong>${escapeHtml(r.fullName)}</strong><small>${escapeHtml(r.studentId)} • ${escapeHtml(r.section)}</small></td>
        <td>${gradeLabel}</td><td>${escapeHtml(trendText)}</td><td>${escapeHtml(missingText)}</td>
        <td><div class="perf-row-actions"><button class="mini-btn" data-perf-scores="${escapeHtml(r.uid)}" type="button">View Scores</button>
        <button class="mini-btn" data-perf-projects="${escapeHtml(r.uid)}" type="button">Projects</button></div></td></tr>`;
    }).join("") : '<tr><td colspan="5" class="perf-empty">No students match the selected filters.</td></tr>';
  }

  async function openPerformanceProjectReviews(record) {
    const term = $("#perfTerm").value;
    await openAdminPage("project-monitor");
    $("#pmTermFilter").value = term;
    const options = Array.from($("#pmSectionFilter").options).map(o => o.value);
    $("#pmSectionFilter").value = options.includes(record.section) ? record.section : "*";
    $("#pmStudentSearch").value = record.studentId || record.fullName;
    renderProjectTaskOptions();
  }

  function currentAdminTerm() {
    return Number($("#settingCurrentTerm")?.value || 1);
  }

  function adminTaskCategoryLabel(task) {
    const category = String(task?.category || "").toLowerCase();
    if (category === "ww") return "Written Works";
    if (category === "pt") return "Performance Tasks";
    if (category === "ta") return "Term Assessment";
    return task?.categoryLabel || "Task";
  }

  function adminTaskCode(task) {
    const category = String(task?.category || "").toUpperCase();
    const number = Number(task?.taskNumber || 0);
    return `${category || "TASK"}${number || ""}`;
  }

  function adminScoreText(task) {
    const rawMax = task?.maxScore;
    const rawScore = task?.score;

    const hasMax =
      rawMax !== null &&
      rawMax !== undefined &&
      rawMax !== "" &&
      Number.isFinite(Number(rawMax)) &&
      Number(rawMax) > 0;

    const hasScore =
      rawScore !== null &&
      rawScore !== undefined &&
      rawScore !== "" &&
      Number.isFinite(Number(rawScore));

    if (task?.missing === true) {
      return hasMax
        ? `Missing / ${formatAdminScore(rawMax)}`
        : "Missing";
    }

    if (!hasMax || !hasScore) {
      return "Raw score unavailable";
    }

    return `${formatAdminScore(rawScore)} / ${formatAdminScore(rawMax)}`;
  }

  function formatAdminScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return Number.isInteger(number)
      ? String(number)
      : String(Math.round(number * 100) / 100);
  }

  function adminPercentText(task) {
    const percent = Number(task?.scorePercent);
    return Number.isFinite(percent) ? `${percent}%` : "—";
  }

  function adminComplianceBandFromPercent(percent) {
    const value = Number(percent);

    if (!Number.isFinite(value)) return "neutral";
    if (value <= 30) return "red";
    if (value <= 69) return "orange";
    if (value <= 84) return "yellow";
    if (value <= 90) return "lime";
    return "green";
  }

  function adminSnapshotHasCompleteRawScores(snapshot) {
    const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];

    if (!tasks.length) return false;

    return tasks.every(task => {
      const rawMax = task?.maxScore;

      const hasMax =
        rawMax !== null &&
        rawMax !== undefined &&
        rawMax !== "" &&
        Number.isFinite(Number(rawMax)) &&
        Number(rawMax) > 0;

      if (!hasMax) return false;

      if (task?.missing === true) {
        return true;
      }

      const rawScore = task?.score;

      return (
        rawScore !== null &&
        rawScore !== undefined &&
        rawScore !== "" &&
        Number.isFinite(Number(rawScore))
      );
    });
  }

  async function getStudentComplianceSnapshot(student, term, preferAdmin = true) {
    const studentId = G10DataService.normalizeStudentId(student?.studentId);
    if (!studentId) {
      return {
        data: null,
        fullScores: false,
        adminSnapshotMissing: preferAdmin
      };
    }

    if (preferAdmin) {
      const adminSnap = await db.collection("adminCompliance")
        .doc(studentId)
        .collection("terms")
        .doc(`term${Number(term)}`)
        .get();

      if (!adminSnap.exists) {
        // Important: DO NOT fall back to studentCompliance for View Scores.
        // That snapshot intentionally hides WW/PT raw scores.
        return {
          data: null,
          fullScores: false,
          adminSnapshotMissing: true
        };
      }

      const data = { id: adminSnap.id, ...adminSnap.data() };

      return {
        data,
        fullScores: adminSnapshotHasCompleteRawScores(data),
        adminSnapshotMissing: false
      };
    }

    // Missing-compliance overview only needs missing task names/status,
    // so the privacy-safe student snapshot is sufficient here.
    const studentSnap = await db.collection("studentCompliance")
      .doc(studentId)
      .collection("terms")
      .doc(`term${Number(term)}`)
      .get();

    if (!studentSnap.exists) {
      return {
        data: null,
        fullScores: false,
        adminSnapshotMissing: false
      };
    }

    return {
      data: { id: studentSnap.id, ...studentSnap.data() },
      fullScores: false,
      adminSnapshotMissing: false
    };
  }

  function studentComplianceQueue(source, selectedUid) {
    const list = source === "missing"
      ? missingComplianceNavigationRows
      : source === "performance"
        ? performanceDisplayedRows
        : filteredStudentProfiles();
    const ids = list.map(student => student.uid).filter(Boolean);
    // A modal opened outside the Students tab may not be included in that tab's
    // filters. In that case show this student without silently switching lists.
    return ids.includes(selectedUid) ? ids : [selectedUid];
  }

  function updateStudentComplianceNavigation() {
    const index = studentComplianceNavigationUids.indexOf(activeStudentComplianceProfile?.uid);
    const total = studentComplianceNavigationUids.length;
    const previous = $("#studentCompliancePreviousBtn");
    const next = $("#studentComplianceNextBtn");
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index >= total - 1;
    $("#studentCompliancePosition").textContent = index < 0
      ? "Student"
      : `Student ${index + 1} of ${total}`;
    $("#studentComplianceNavigationContext").textContent =
      studentComplianceNavigationSource === "missing"
        ? "Missing requirements list"
        : studentComplianceNavigationSource === "performance"
          ? "Section Performance • filtered students"
        : ($("#studentSectionFilter")?.value || "*") === "*"
          ? "Filtered students / All sections"
          : ($("#studentSectionFilter")?.selectedOptions?.[0]?.textContent || "Section");
  }

  function stepStudentCompliance(direction) {
    if ($("#studentComplianceModal").classList.contains("hidden")) return;
    const current = studentComplianceNavigationUids.indexOf(activeStudentComplianceProfile?.uid);
    const nextIndex = current + direction;
    if (current < 0 || nextIndex < 0 || nextIndex >= studentComplianceNavigationUids.length) return;
    const uid = studentComplianceNavigationUids[nextIndex];
    // Keep the exact selected term, even across different sections.
    const term = Number($("#studentComplianceTerm").value || currentAdminTerm());
    void openStudentComplianceProfile(uid, term, "preserve");
  }

  async function openStudentComplianceProfile(uid, requestedTerm = null, source = "students") {
    const openSerial = ++studentComplianceOpenSerial;
    // Source = preserve is used for Previous / Next: the frozen filtered order
    // remains stable until the modal is reopened from the list.
    if (source !== "preserve") {
      studentComplianceNavigationSource = source;
      studentComplianceNavigationUids = studentComplianceQueue(source, uid);
    }

    let student = cachedStudentProfiles.find(item => item.uid === uid);
    if (!student) {
      const snap = await db.collection("students").doc(uid).get();
      if (openSerial !== studentComplianceOpenSerial) return;
      if (!snap.exists) return;
      student = { uid: snap.id, ...snap.data() };
    }
    if (openSerial !== studentComplianceOpenSerial) return;

    activeStudentComplianceProfile = student;
    const term = Number(requestedTerm || currentAdminTerm());
    $("#studentComplianceTerm").value = String(term);
    $("#studentComplianceModalTitle").textContent =
      student.fullName || student.studentId || "Student";

    $("#studentComplianceModalMeta").textContent = [
      student.studentId || "",
      student.section || ""
    ].filter(Boolean).join(" • ");

    $("#studentComplianceModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    updateStudentComplianceNavigation();
    $("#studentComplianceModalBody").scrollTop = 0;
    await loadActiveStudentComplianceProfile();
  }

  async function loadActiveStudentComplianceProfile() {
    const student = activeStudentComplianceProfile;
    if (!student) return;

    const term = Number($("#studentComplianceTerm").value || currentAdminTerm());
    const serial = ++studentComplianceLoadSerial;
    const body = $("#studentComplianceModalBody");
    body.scrollTop = 0;
    body.innerHTML = '<div class="admin-modal-loading" role="status">Loading student scores…</div>';

    try {
      const result = await getStudentComplianceSnapshot(student, term, true);
      if (serial !== studentComplianceLoadSerial ||
          student.uid !== activeStudentComplianceProfile?.uid ||
          Number($("#studentComplianceTerm").value) !== term ||
          $("#studentComplianceModal").classList.contains("hidden")) return;
      renderStudentComplianceProfile(
        student,
        term,
        result.data,
        result.fullScores,
        result.adminSnapshotMissing === true
      );
    } catch (err) {
      if (serial !== studentComplianceLoadSerial ||
          student.uid !== activeStudentComplianceProfile?.uid) return;
      body.innerHTML = `
        <div class="admin-compliance-empty">
          <strong>Could not load this student's Compliance.</strong>
          <small>${escapeHtml(err.message || "Unknown error")}</small>
        </div>
      `;
    }
  }

  function renderStudentComplianceProfile(
    student,
    term,
    snapshot,
    fullScores,
    adminSnapshotMissing = false
  ) {
    const body = $("#studentComplianceModalBody");

    if (!snapshot) {
      body.innerHTML = `
        <div class="admin-compliance-empty">
          <strong>${
            adminSnapshotMissing
              ? "Full raw-score snapshot is not available yet."
              : `No Compliance snapshot for Term ${term}.`
          }</strong>
          <small>
            Run <strong>Compliance Sync → SYNC CHECKED SECTIONS &amp; PUBLISH</strong>
            once after deploying the updated Apps Script. This creates the
            Admin-only WW/PT/TA raw score snapshot.
          </small>
        </div>
      `;
      return;
    }

    const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
    const missingTasks = tasks.filter(task => task?.missing === true);

    const scoreNotice = fullScores
      ? ""
      : `
        <div class="admin-score-sync-notice">
          <strong>RAW SCORE SNAPSHOT NEEDS RE-SYNC.</strong>
          Some WW/PT scores or HPS values are missing from this older Admin snapshot.
          Run <strong>SYNC CHECKED SECTIONS &amp; PUBLISH</strong> again.
        </div>
      `;

    const groups = [
      ["ww", "Written Works"],
      ["pt", "Performance Tasks"],
      ["ta", "Term Assessment"]
    ];

    const taskGroupsHtml = groups.map(([key, label]) => {
      const groupTasks = tasks.filter(task =>
        String(task?.category || "").toLowerCase() === key
      );

      if (!groupTasks.length) return "";

      return `
        <section class="admin-score-group">
          <div class="admin-score-group-head">
            <strong>${label}</strong>
            <small>${groupTasks.length} task${groupTasks.length === 1 ? "" : "s"}</small>
          </div>

          <div class="admin-score-task-list">
            ${groupTasks.map(task => {
              const missing = task?.missing === true;
              const scorePercent = Number(task?.scorePercent);
              const band = missing
                ? "black"
                : (
                    Number.isFinite(scorePercent)
                      ? adminComplianceBandFromPercent(scorePercent)
                      : String(task?.percentageBand || "neutral").toLowerCase()
                  );

              return `
                <article class="admin-score-task band-${escapeHtml(band)} ${missing ? "is-missing" : ""}">
                  <div class="admin-score-task-main">
                    <small>${escapeHtml(adminTaskCode(task))}</small>
                    <strong>${escapeHtml(task.displayName || task.taskName || "Task")}</strong>
                  </div>

                  <div class="admin-score-task-data">
                    <strong>${escapeHtml(adminScoreText(task))}</strong>
                    <small>${
                      missing
                        ? "Missing"
                        : fullScores
                          ? `${escapeHtml(adminPercentText(task))} • Completed`
                          : "Re-sync required"
                    }</small>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }).join("");

    body.innerHTML = `
      <div class="admin-term-grade-strip">
        <div class="admin-term-grade-copy">
          <span>RUNNING GRADE</span>
          <small>${escapeHtml(adminRunningGradeNote(snapshot))}</small>
          <small class="admin-running-grade-disclaimer">Not the final term grade. This running grade may increase or decrease before the term ends.</small>
        </div>
        <strong>${escapeHtml(adminRunningGradeValue(snapshot))}</strong>
      </div>
      <div class="admin-student-compliance-summary">
        <div>
          <span>Total Tasks</span>
          <strong>${escapeHtml(String(snapshot.summary?.total ?? tasks.length))}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>${escapeHtml(String(snapshot.summary?.complete ?? Math.max(0, tasks.length - missingTasks.length)))}</strong>
        </div>
        <div class="missing">
          <span>Missing</span>
          <strong>${escapeHtml(String(snapshot.summary?.missing ?? missingTasks.length))}</strong>
        </div>
        <div>
          <span>Term</span>
          <strong>${escapeHtml(String(term))}</strong>
        </div>
      </div>

      ${scoreNotice}

      <section class="admin-student-missing-block ${missingTasks.length ? "" : "complete"}">
        <div class="admin-student-missing-head">
          <div>
            <span class="section-kicker">MISSING TASKS</span>
            <strong>${missingTasks.length ? `${missingTasks.length} task${missingTasks.length === 1 ? "" : "s"} missing` : "No missing tasks"}</strong>
          </div>
        </div>

        ${missingTasks.length
          ? `<div class="admin-missing-task-chips">
              ${missingTasks.map(task => `
                <span>
                  <b>${escapeHtml(adminTaskCode(task))}</b>
                  ${escapeHtml(task.displayName || task.taskName || "Task")}
                </span>
              `).join("")}
            </div>`
          : '<p class="admin-complete-message">All active tasks have recorded scores.</p>'
        }
      </section>

      ${taskGroupsHtml || '<div class="admin-compliance-empty">No active tasks in this term.</div>'}
    `;
  }

  function closeStudentComplianceProfile() {
    $("#studentComplianceModal").classList.add("hidden");
    ++studentComplianceLoadSerial;
    ++studentComplianceOpenSerial;
    activeStudentComplianceProfile = null;
    studentComplianceNavigationUids = [];

    if ($("#missingComplianceModal").classList.contains("hidden")) {
      document.body.classList.remove("modal-open");
    }
  }

  async function openMissingComplianceOverview() {
    const term = currentAdminTerm();
    $("#missingOverviewTerm").value = String(term);
    populateMissingOverviewSections();

    $("#missingComplianceModal").classList.remove("hidden");
    document.body.classList.add("modal-open");

    await loadMissingComplianceOverview();
  }

  function populateMissingOverviewSections() {
    const select = $("#missingOverviewSection");
    const current = select.value || "*";

    select.innerHTML = [
      '<option value="*">All Sections</option>',
      ...knownSections.map(section =>
        `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`
      )
    ].join("");

    if (current === "*" || knownSections.includes(current)) {
      select.value = current;
    }
  }

  async function loadMissingComplianceOverview() {
    const list = $("#missingComplianceOverviewList");
    const term = Number($("#missingOverviewTerm").value || currentAdminTerm());

    list.innerHTML = '<div class="admin-modal-loading">Loading missing compliance…</div>';
    $("#missingComplianceModalMeta").textContent = `Term ${term}`;

    try {
      if (!cachedStudentProfiles.length) {
        const snap = await db.collection("students").get();
        cachedStudentProfiles = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      }

      const activeStudents = cachedStudentProfiles
        .filter(student => student.active !== false);

      const rows = [];

      for (let i = 0; i < activeStudents.length; i += 25) {
        const chunk = activeStudents.slice(i, i + 25);

        const results = await Promise.all(
          chunk.map(async student => {
            try {
              const result = await getStudentComplianceSnapshot(student, term, false);
              const snapshot = result.data;
              if (!snapshot) return null;

              const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
              const missingTasks = tasks.filter(task => task?.missing === true);

              if (!missingTasks.length) return null;

              return {
                uid: student.uid,
                studentId: student.studentId || snapshot.studentId || "",
                fullName: student.fullName || snapshot.fullName || student.studentId || "Student",
                section: normalizeSectionName(student.section || snapshot.section),
                missingTasks,
                missingCount: missingTasks.length
              };
            } catch (err) {
              console.warn("Could not inspect Compliance for:", student.studentId, err);
              return null;
            }
          })
        );

        rows.push(...results.filter(Boolean));
      }

      missingComplianceOverviewRows = rows;
      populateMissingOverviewSections();
      renderMissingComplianceOverview();
    } catch (err) {
      list.innerHTML = `
        <div class="admin-compliance-empty">
          <strong>Could not load the missing Compliance overview.</strong>
          <small>${escapeHtml(err.message || "Unknown error")}</small>
        </div>
      `;
    }
  }

  function renderMissingComplianceOverview() {
    const list = $("#missingComplianceOverviewList");
    const summary = $("#missingComplianceOverviewSummary");
    if (!list || !summary) return;

    const section = $("#missingOverviewSection").value || "*";
    const sort = $("#missingOverviewSort").value || "section";

    let rows = missingComplianceOverviewRows.slice();

    if (section !== "*") {
      rows = rows.filter(row => row.section === section);
    }

    rows.sort((a, b) => {
      if (sort === "name") {
        return String(a.fullName).localeCompare(String(b.fullName), undefined, { sensitivity: "base" });
      }

      if (sort === "missing") {
        const diff = Number(b.missingCount) - Number(a.missingCount);
        if (diff !== 0) return diff;
        return String(a.fullName).localeCompare(String(b.fullName), undefined, { sensitivity: "base" });
      }

      const sectionDiff = String(a.section).localeCompare(String(b.section), undefined, { sensitivity: "base" });
      if (sectionDiff !== 0) return sectionDiff;

      return String(a.fullName).localeCompare(String(b.fullName), undefined, { sensitivity: "base" });
    });

    // Preserve exactly the visible sorting for Previous / Next navigation.
    missingComplianceNavigationRows = rows;
    const totalMissingTasks = rows.reduce((sum, row) => sum + row.missingCount, 0);

    summary.innerHTML = `
      <div><span>Students</span><strong>${rows.length}</strong></div>
      <div><span>Missing Tasks</span><strong>${totalMissingTasks}</strong></div>
      <div><span>Section</span><strong>${escapeHtml(section === "*" ? "ALL" : section)}</strong></div>
    `;

    list.innerHTML = rows.length
      ? rows.map(row => `
          <article class="missing-overview-student">
            <div class="missing-overview-student-head">
              <div>
                <button class="missing-student-name-btn" type="button" data-missing-student-uid="${row.uid}">
                  ${escapeHtml(row.fullName)}
                </button>
                <small>${escapeHtml(row.studentId)} • ${escapeHtml(row.section)}</small>
              </div>
              <span class="missing-overview-count">${row.missingCount} missing</span>
            </div>

            <div class="missing-overview-task-list">
              ${row.missingTasks.map(task => `
                <span class="missing-overview-task-chip">
                  <b>${escapeHtml(adminTaskCode(task))}</b>
                  ${escapeHtml(task.displayName || task.taskName || "Task")}
                </span>
              `).join("")}
            </div>
          </article>
        `).join("")
      : `
        <div class="admin-compliance-empty success">
          <strong>No missing tasks found.</strong>
          <small>No student in this filter currently has a missing task for this term.</small>
        </div>
      `;

    $$("[data-missing-student-uid]").forEach(btn => {
      btn.addEventListener("click", () => {
        openStudentComplianceProfile(
          btn.dataset.missingStudentUid,
          Number($("#missingOverviewTerm").value || currentAdminTerm()),
          "missing"
        );
      });
    });
  }

  function closeMissingComplianceOverview() {
    $("#missingComplianceModal").classList.add("hidden");
    missingComplianceOverviewRows = [];
    missingComplianceNavigationRows = [];

    if ($("#studentComplianceModal").classList.contains("hidden")) {
      document.body.classList.remove("modal-open");
    }
  }


  const COMPLIANCE_TASK_GROUPS = [
    {
      key: "ww",
      title: "Written Works",
      short: "WW",
      count: 10,
      defaultName: number => `Written Work ${number}`
    },
    {
      key: "pt",
      title: "Performance Tasks",
      short: "PT",
      count: 10,
      defaultName: number => `Performance Task ${number}`
    },
    {
      key: "ta",
      title: "Term Assessment",
      short: "TA",
      count: 10,
      defaultName: number => `Term Assessment ${number}`
    }
  ];

  function defaultComplianceSettings() {
    return {
      term: 1,
      selectedSections: knownSections.slice(),
      sections: knownSections.map(section => ({
        section,
        spreadsheetRef: ""
      })),
      taskNamesByTerm: {
        term1: {},
        term2: {},
        term3: {}
      }
    };
  }

  function normalizeComplianceSettings(raw = {}) {
    const defaults = defaultComplianceSettings();
    const savedSections = Array.isArray(raw.sections) ? raw.sections : [];
    const savedByName = new Map();

    savedSections.forEach(item => {
      const section = normalizeSectionName(item?.section);
      if (!section) return;
      savedByName.set(section.toLowerCase(), {
        section,
        spreadsheetRef: String(item?.spreadsheetRef || item?.sheetUrl || "").trim()
      });
    });

    const sections = knownSections.map(section => {
      const saved = savedByName.get(section.toLowerCase());
      return {
        section,
        spreadsheetRef: saved?.spreadsheetRef || ""
      };
    });

    const savedSelected = Array.isArray(raw.selectedSections)
      ? raw.selectedSections.map(normalizeSectionName).filter(Boolean)
      : [];

    const validSectionSet = new Set(knownSections);
    let selectedSections = savedSelected.filter(section => validSectionSet.has(section));

    if (!selectedSections.length && knownSections.length) {
      selectedSections = sections
        .filter(item => item.spreadsheetRef)
        .map(item => item.section);

      if (!selectedSections.length) {
        selectedSections = knownSections.slice();
      }
    }

    const sourceTaskNames = raw.taskNamesByTerm && typeof raw.taskNamesByTerm === "object"
      ? raw.taskNamesByTerm
      : {};

    const normalizeTaskMap = source => {
      const result = {};
      if (!source || typeof source !== "object") return result;

      Object.entries(source).forEach(([key, value]) => {
        const normalizedKey = String(key || "").trim().toLowerCase();
        const label = String(value || "").trim();
        if (normalizedKey && label) result[normalizedKey] = label;
      });
      return result;
    };

    const term = [1, 2, 3].includes(Number(raw.term)) ? Number(raw.term) : defaults.term;

    return {
      term,
      selectedSections,
      sections,
      taskNamesByTerm: {
        term1: normalizeTaskMap(sourceTaskNames.term1),
        term2: normalizeTaskMap(sourceTaskNames.term2),
        term3: normalizeTaskMap(sourceTaskNames.term3)
      }
    };
  }

  function complianceSettingsDocRef() {
    return db.collection("complianceSettings").doc("main");
  }

  function complianceSheetTabForTerm(term) {
    const value = Number(term);
    const safeTerm = [1, 2, 3].includes(value) ? value : 1;
    return `TERM_${safeTerm}`;
  }

  function updateComplianceSheetTabIndicator() {
    const term = Number($("#syncTerm")?.value || 1);
    const sheetName = complianceSheetTabForTerm(term);
    const label = $("#syncSheetTabLabel");
    if (label) label.textContent = sheetName;
    return sheetName;
  }

  function currentComplianceTermKey() {
    const term = Number($("#syncTerm")?.value || complianceSettingsCache?.term || 1);
    return `term${[1, 2, 3].includes(term) ? term : 1}`;
  }

  function currentComplianceTaskNames() {
    const settings = complianceSettingsCache || defaultComplianceSettings();
    return {
      ...(settings.taskNamesByTerm?.[currentComplianceTermKey()] || {})
    };
  }

  async function loadComplianceSetup() {
    previewPayload = null;
    $("#syncPreviewNote").textContent = "No preview loaded yet.";
    $("#syncPreviewTable").innerHTML = "";
    $("#syncActiveTasks").innerHTML = "";

    try {
      const snap = await complianceSettingsDocRef().get();
      const raw = snap.exists ? snap.data() : {};
      complianceSettingsCache = normalizeComplianceSettings(raw);

      $("#syncTerm").value = String(complianceSettingsCache.term || 1);
      updateComplianceSheetTabIndicator();
      renderComplianceSectionSettings();
      renderComplianceTaskGroup();

      setStatus(
        "#complianceSetupStatus",
        snap.exists
          ? "Compliance settings loaded from Firebase."
          : "No saved Compliance settings yet. Paste the four section links, set task names, then Save Settings.",
        snap.exists ? true : null
      );
    } catch (err) {
      complianceSettingsCache = normalizeComplianceSettings({});
      renderComplianceSectionSettings();
      renderComplianceTaskGroup();
      setStatus("#complianceSetupStatus", err.message, false);
    }
  }

  function renderComplianceSectionSettings() {
    const target = $("#complianceSectionSettingsList");
    if (!target) return;

    const settings = complianceSettingsCache || normalizeComplianceSettings({});
    const selected = new Set(settings.selectedSections || []);

    $("#complianceDetectedBadge").textContent =
      `${knownSections.length} section${knownSections.length === 1 ? "" : "s"} detected`;

    target.innerHTML = settings.sections.length
      ? settings.sections.map((item, index) => {
          const ready = !!String(item.spreadsheetRef || "").trim();
          return `
            <div class="compliance-v2-section-row ${ready ? "configured" : ""}">
              <label class="compliance-v2-section-check" title="Include this section when syncing">
                <input
                  type="checkbox"
                  data-compliance-section-check="${index}"
                  ${selected.has(item.section) ? "checked" : ""}>
              </label>

              <div class="compliance-v2-section-name">
                <strong>${escapeHtml(item.section)}</strong>
                <small>${ready ? "Google Sheet saved" : "Google Sheet link needed"}</small>
              </div>

              <input
                class="compliance-v2-sheet-input"
                type="text"
                data-compliance-section-url="${index}"
                value="${escapeHtml(item.spreadsheetRef || "")}"
                placeholder="Paste Google Sheet URL or Spreadsheet ID">

              <span class="compliance-v2-link-status ${ready ? "ready" : "missing"}">
                ${ready ? "READY" : "NO LINK"}
              </span>
            </div>
          `;
        }).join("")
      : `
        <div class="section-empty">
          No sections detected. Import the student roster first.
        </div>
      `;

    target.querySelectorAll("[data-compliance-section-url]").forEach(input => {
      input.addEventListener("input", () => {
        const row = input.closest(".compliance-v2-section-row");
        const status = row?.querySelector(".compliance-v2-link-status");
        const hasValue = !!String(input.value || "").trim();

        row?.classList.toggle("configured", hasValue);

        if (status) {
          status.classList.toggle("ready", hasValue);
          status.classList.toggle("missing", !hasValue);
          status.textContent = hasValue ? "READY" : "NO LINK";
        }

        const small = row?.querySelector(".compliance-v2-section-name small");
        if (small) small.textContent = hasValue ? "Google Sheet ready" : "Google Sheet link needed";
      });
    });
  }

  function collectComplianceSettingsFromControls() {
    const settings = normalizeComplianceSettings(complianceSettingsCache || {});
    captureVisibleComplianceTaskNames();

    settings.term = Number($("#syncTerm")?.value || settings.term || 1);

    settings.sections = settings.sections.map((item, index) => {
      const input = $(`[data-compliance-section-url="${index}"]`);
      return {
        section: item.section,
        spreadsheetRef: String(input?.value || item.spreadsheetRef || "").trim()
      };
    });

    settings.selectedSections = $$("[data-compliance-section-check]")
      .filter(input => input.checked)
      .map(input => {
        const index = Number(input.dataset.complianceSectionCheck);
        return settings.sections[index]?.section || "";
      })
      .filter(Boolean);

    complianceSettingsCache = settings;
    return settings;
  }

  async function saveComplianceSettingsToFirebase(options = {}) {
    const button = $("#saveComplianceSettingsBtn");
    if (!options.silent) setBusy(button, true, "SAVING…");

    try {
      const settings = collectComplianceSettingsFromControls();

      await complianceSettingsDocRef().set({
        term: settings.term,
        selectedSections: settings.selectedSections,
        sections: settings.sections,
        taskNamesByTerm: settings.taskNamesByTerm,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: admin.uid
      }, { merge: true });

      complianceSettingsCache = settings;

      if (!options.silent) {
        setStatus(
          "#complianceSetupStatus",
          "Saved to Firebase. Your four section links and shared task names will load again on this or another device.",
          true
        );
      }

      return settings;
    } catch (err) {
      if (!options.silent) setStatus("#complianceSetupStatus", err.message, false);
      throw err;
    } finally {
      if (!options.silent) setBusy(button, false, "SAVE SETTINGS TO FIREBASE");
    }
  }

  function setAllComplianceSectionsChecked(checked) {
    $$("[data-compliance-section-check]").forEach(input => {
      input.checked = !!checked;
    });

    if (complianceSettingsCache) {
      complianceSettingsCache.selectedSections = checked
        ? complianceSettingsCache.sections.map(item => item.section)
        : [];
    }
  }

  function handleComplianceTermChange() {
    captureVisibleComplianceTaskNames();

    const term = Number($("#syncTerm").value || 1);
    if (complianceSettingsCache) complianceSettingsCache.term = term;

    updateComplianceSheetTabIndicator();

    activeComplianceTaskGroup = "ww";
    renderComplianceTaskGroup();

    previewPayload = null;
    $("#syncPreviewNote").textContent = "No preview loaded yet.";
    $("#syncPreviewTable").innerHTML = "";
    $("#syncActiveTasks").innerHTML = "";
  }

  function getComplianceTaskGroup(prefix = activeComplianceTaskGroup) {
    return COMPLIANCE_TASK_GROUPS.find(group => group.key === prefix)
      || COMPLIANCE_TASK_GROUPS[0];
  }

  function renderComplianceTaskGroup() {
    const target = $("#complianceTaskNameGrid");
    if (!target) return;

    const term = Number($("#syncTerm")?.value || 1);
    const termKey = `term${term}`;
    const group = getComplianceTaskGroup();
    const names = complianceSettingsCache?.taskNamesByTerm?.[termKey] || {};

    $("#taskMapLabel").textContent = `TERM ${term} • ALL SECTIONS`;

    $$("[data-compliance-task-group]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.complianceTaskGroup === group.key);
    });

    target.innerHTML = Array.from({ length: group.count }, (_, index) => {
      const number = index + 1;
      const key = `${group.key}${number}`;
      return `
        <label class="compliance-v2-task-row">
          <span class="compliance-v2-task-key">${escapeHtml(group.short)} ${number}</span>
          <input
            class="compliance-task-name"
            data-task-key="${escapeHtml(key)}"
            type="text"
            value="${escapeHtml(names[key] || "")}"
            placeholder="${escapeHtml(group.defaultName(number))}">
        </label>
      `;
    }).join("");
  }

  function captureVisibleComplianceTaskNames() {
    if (!complianceSettingsCache) return;

    const termKey = currentComplianceTermKey();
    const names = {
      ...(complianceSettingsCache.taskNamesByTerm?.[termKey] || {})
    };

    $$(".compliance-task-name").forEach(input => {
      const key = String(input.dataset.taskKey || "").trim().toLowerCase();
      const value = String(input.value || "").trim();

      if (!key) return;
      if (value) names[key] = value;
      else delete names[key];
    });

    complianceSettingsCache.taskNamesByTerm[termKey] = names;
  }

  function collectAllTaskNamesForCurrentTerm() {
    captureVisibleComplianceTaskNames();
    return currentComplianceTaskNames();
  }

  function resetCurrentComplianceTaskGroup() {
    if (!complianceSettingsCache) return;

    const termKey = currentComplianceTermKey();
    const group = getComplianceTaskGroup();
    const names = {
      ...(complianceSettingsCache.taskNamesByTerm?.[termKey] || {})
    };

    for (let number = 1; number <= group.count; number++) {
      delete names[`${group.key}${number}`];
    }

    complianceSettingsCache.taskNamesByTerm[termKey] = names;
    renderComplianceTaskGroup();
  }

  function defaultComplianceTaskName(key) {
    const match = /^([a-z]+)(\d+)$/.exec(String(key || "").toLowerCase());
    if (!match) return "Task";

    const group = COMPLIANCE_TASK_GROUPS.find(item => item.key === match[1]);
    const number = Number(match[2]);

    return group ? group.defaultName(number) : `Task ${number}`;
  }

  function selectedComplianceSections(settings) {
    const selectedSet = new Set(settings.selectedSections || []);

    const selected = settings.sections.filter(item => selectedSet.has(item.section));

    if (!selected.length) {
      throw new Error("Check at least one section to sync.");
    }

    const missing = selected.filter(item => !String(item.spreadsheetRef || "").trim());

    if (missing.length) {
      throw new Error(
        "Paste and save the Google Sheet link first for: " +
        missing.map(item => item.section).join(", ")
      );
    }

    return selected;
  }

  async function readSelectedComplianceSections(options = {}) {
    const settings = await saveComplianceSettingsToFirebase({ silent: true });
    const selected = selectedComplianceSections(settings);
    const taskNames = collectAllTaskNamesForCurrentTerm();
    const term = Number(settings.term || 1);
    const sheetName = complianceSheetTabForTerm(term);

    const results = [];
    const errors = [];

    for (let index = 0; index < selected.length; index++) {
      const item = selected[index];

      if (options.onProgress) {
        options.onProgress({
          section: item.section,
          current: index + 1,
          total: selected.length
        });
      }

      try {
        const result = await callAppsScriptSecure({
          action: "previewCompliance",
          section: item.section,
          spreadsheetRef: item.spreadsheetRef,
          term,
          sheetName,
          taskNames
        });

        results.push({
          ...result,
          section: item.section,
          spreadsheetRef: item.spreadsheetRef
        });
      } catch (err) {
        errors.push({
          section: item.section,
          error: err.message || "Could not read this section."
        });
      }
    }

    return {
      term,
      sheetName,
      taskNames,
      // Exact local time this preview finished reading the selected Sheets.
      previewedAt: new Date().toISOString(),
      sections: results,
      errors,
      readyToPublish: results.some(result => result.readyToPublish)
    };
  }

  async function previewSync() {
    const button = $("#previewComplianceBtn");
    setBusy(button, true, "READING SHEETS…");
    setStatus("#syncStatus", "Reading checked section(s) from Google Sheets…");
    previewPayload = null;

    try {
      const payload = await readSelectedComplianceSections({
        onProgress: progress => {
          setStatus(
            "#syncStatus",
            `Reading ${progress.section}… ${progress.current}/${progress.total}`
          );
        }
      });

      previewPayload = payload;
      renderSyncPreview(payload);

      const studentCount = payload.sections.reduce(
        (total, section) => total + (section.students?.length || 0),
        0
      );

      const issueText = payload.errors.length
        ? ` • ${payload.errors.length} section issue(s)`
        : "";

      setStatus(
        "#syncStatus",
        `Preview ready: ${studentCount} student rows across ${payload.sections.length} section(s)${issueText}.`,
        payload.sections.length > 0
      );
    } catch (err) {
      setStatus("#syncStatus", err.message, false);
      $("#syncPreviewTable").innerHTML = "";
      $("#syncActiveTasks").innerHTML = "";
    } finally {
      setBusy(button, false, "PREVIEW CHECKED SECTIONS");
    }
  }

  function adminRunningGradeValue(snapshot) {
    if (String(snapshot?.gradeStatus || "").toUpperCase() === "INC") return "INC";
    const value = snapshot?.termGrade;
    if (value === null || value === undefined || value === "") return "Not available";
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : "Not available";
  }

  function adminRunningGradeAsOf(timestamp) {
    if (!timestamp) return "As of latest update (date unavailable)";
    let date;
    if (typeof timestamp.toDate === "function") date = timestamp.toDate();
    else if (typeof timestamp.seconds === "number") date = new Date(timestamp.seconds * 1000);
    else date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return "As of latest update (date unavailable)";
    return `As of ${date.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true
    })} (PH time)`;
  }

  function adminRunningGradeNote(snapshot, asOfTime = null) {
    const asOf = adminRunningGradeAsOf(asOfTime || snapshot?.publishedAt || snapshot?.lastUpdated);
    if (String(snapshot?.gradeStatus || "").toUpperCase() === "INC" || snapshot?.gradeType === "incomplete") {
      return `Incomplete standing • ${asOf}`;
    }
    if (snapshot?.termGrade === null || snapshot?.termGrade === undefined || snapshot?.termGrade === "") {
      return "No running grade available yet";
    }
    return `${asOf}${snapshot?.gradeType === "provisional" ? " • Pending confirmation" : ""}`;
  }

  function renderSyncPreview(payload) {
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];

    const totalStudents = sections.reduce(
      (total, section) => total + (section.students?.length || 0),
      0
    );

    $("#syncPreviewNote").textContent =
      sections.length
        ? `${sections.length} section(s) • ${totalStudents} student row(s) • ${payload.sheetName || `TERM_${payload.term}`} • ${adminRunningGradeAsOf(payload.previewedAt)}`
        : "No section preview is available.";

    const priorTermIssues = sections.filter(section => Number(payload.term) > 1 && !section.previousTermAvailable);
    if (priorTermIssues.length) {
      $("#syncPreviewNote").textContent += ` • WARNING: ${priorTermIssues.length} section(s) have no readable previous-term comparison. See Google Sheet TERM_${Number(payload.term) - 1}.`;
    } else if (Number(payload.term) > 1 && sections.length) {
      const movement = { improved: 0, declined: 0, unchanged: 0, unavailable: 0 };
      for (const section of sections) {
        for (const row of section.students || []) {
          const now = row.termGrade;
          const before = row.previousTermGrade;
          const comparable = now !== null && now !== undefined && now !== "" &&
            before !== null && before !== undefined && before !== "" &&
            Number.isFinite(Number(now)) && Number.isFinite(Number(before)) &&
            String(row.gradeStatus || "").toUpperCase() !== "INC" &&
            String(row.previousTermGradeStatus || "").toUpperCase() !== "INC";
          if (!comparable) { movement.unavailable++; continue; }
          const delta = Number(now) - Number(before);
          movement[delta > 0 ? "improved" : delta < 0 ? "declined" : "unchanged"]++;
        }
      }
      $("#syncPreviewNote").textContent +=
        ` • Term ${Number(payload.term) - 1} → Term ${payload.term}: ` +
        `${movement.improved} improved, ${movement.declined} declined, ` +
        `${movement.unchanged} unchanged, ${movement.unavailable} not comparable.`;
    }

    const previewWWMissingBand = sections.reduce((total, section) => total +
      (section.students || []).reduce((count, student) => count +
        (student.tasks || []).filter(t => {
          const isWW = String(t?.category || "").toLowerCase() === "ww";
          return isWW && !t?.missing && studentFacingComplianceTask(t).percentageBand === "neutral";
        }).length, 0), 0);
    if (previewWWMissingBand > 0) {
      setStatus("#wwRepairStatus",
        `WARNING: ${previewWWMissingBand} completed Written Work(s) have no usable score/HPS or color. ` +
        `Publishing will stop rather than silently show gray.`, false);
    } else {
      setStatus("#wwRepairStatus", "WW color validation: all completed Written Works have a valid color band.", true);
    }

    $("#syncActiveTasks").innerHTML = sections.length
      ? `
        <div class="compliance-v2-preview-summary">
          ${sections.map(section => `
            <div class="compliance-v2-preview-section">
              <strong>${escapeHtml(section.section)}</strong>
              <span>${section.students?.length || 0} students</span>
              <span>${section.activeTasks?.length || 0} active requirements</span>
            </div>
          `).join("")}
          ${errors.map(item => `
            <div class="compliance-v2-preview-section error">
              <strong>${escapeHtml(item.section)}</strong>
              <span>${escapeHtml(item.error)}</span>
            </div>
          `).join("")}
        </div>
      `
      : "";

    const rows = sections.flatMap(section =>
      (section.students || []).map(student => ({
        section: section.section,
        ...student
      }))
    );

    if (!rows.length) {
      $("#syncPreviewTable").innerHTML = `<div class="empty-state">No student rows returned.</div>`;
      return;
    }

    $("#syncPreviewTable").innerHTML = `
      <table class="preview-table">
        <thead>
          <tr>
            <th>Section</th>
            <th>Student ID</th>
            <th>Name</th>
            <th>Running Grade</th>
            <th>Requirements</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(student => `
            <tr>
              <td>${escapeHtml(student.section || "")}</td>
              <td>${escapeHtml(student.studentId || "")}</td>
              <td>${escapeHtml(student.fullName || "")}</td>
              <td>
                <strong>${escapeHtml(adminRunningGradeValue(student))}</strong>
                <small class="admin-grade-preview-note">${escapeHtml(adminRunningGradeNote(student, payload.previewedAt))}</small>
              </td>
              <td>${escapeHtml(String((student.tasks || []).length))}</td>
              <td>${escapeHtml(String(student.missingCount || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  /**
   * Student Written Works disclose only completion status and a broad
   * color category. Raw score, HPS, exact percentage, and all other
   * private admin fields remain in adminCompliance only.
   *
   * The color band is calculated from the admin's authoritative Sheet
   * preview BEFORE the allowlisted student snapshot is written.
   */
  function studentFacingComplianceTask(task) {
    const category = String(task?.category || "").toLowerCase();
    const taskId = String(task?.taskId || "").toLowerCase();
    const isWrittenWork = category === "ww" || /^ww\d+$/.test(taskId);

    if (!isWrittenWork) return { ...task }; // PT / TA: actual scores allowed

    const missing = task?.missing === true;
    const allowedBands = ["red", "orange", "yellow", "lime", "green"];
    const rawPercent = task?.scorePercent;
    const hasPercent = rawPercent !== null && rawPercent !== undefined &&
      rawPercent !== "" && Number.isFinite(Number(rawPercent));
    const sourceBand = String(task?.percentageBand || "").toLowerCase();
    const rawScore = task?.score;
    const rawHps = task?.maxScore;
    const hasRawRatio = rawScore !== null && rawScore !== undefined && rawScore !== "" &&
      rawHps !== null && rawHps !== undefined && rawHps !== "" &&
      Number.isFinite(Number(rawScore)) && Number.isFinite(Number(rawHps)) &&
      Number(rawHps) > 0;
    const colorBand = missing
      ? "black"
      : hasPercent
        ? adminComplianceBandFromPercent(Number(rawPercent))
        : hasRawRatio
          ? adminComplianceBandFromPercent(Math.round((Number(rawScore) / Number(rawHps)) * 100))
          : (allowedBands.includes(sourceBand) ? sourceBand : "neutral");

    return {
      schemaVersion: 5,
      taskId: task.taskId || "",
      displayName: task.displayName || "Written Work",
      category: "ww",
      categoryLabel: task.categoryLabel || "Written Work",
      taskNumber: Number(task.taskNumber) || 0,
      status: missing ? "Missing" : "Completed",
      missing: missing,
      completed: !missing,
      percentageBand: colorBand // Broad range only; never publish WW numbers
    };
  }

  /**
   * Repair gray Written Works from previously published admin-only snapshots.
   * NEVER reads WW scores in the student app, and NEVER copies raw admin tasks
   * into studentCompliance. This is a deliberate admin-only recovery route.
   */
  async function repairWrittenWorkColors() {
    const button = $("#repairWWColorsBtn");
    setBusy(button, true, "CHECKING WW COLORS…");
    setStatus("#wwRepairStatus", "Checking published records for selected sections…");
    try {
      // Use the visible selection; repair never needs a Google Sheets link.
      const checked = $$('[data-compliance-section-check]')
        .filter(box => box.checked)
        .map(box => normalizeSectionName(
          (complianceSettingsCache?.sections || [])[Number(box.dataset.complianceSectionCheck)]?.section
        ));
      if (!checked.length) throw new Error("Select at least one section to repair.");
      const selected = new Set(checked);
      const term = Number($("#syncTerm").value || 1);
      if (![1,2,3].includes(term)) throw new Error("Select a valid term first.");

      await loadSectionDirectory(true);
      const profiles = cachedStudentProfiles.filter(s => selected.has(normalizeSectionName(s.section)));
      if (!profiles.length) throw new Error("No student profiles found for the checked section(s).");

      const stats = {checked: 0, patched: 0, wwFixed: 0, wwAlreadyColored: 0,
        missing: 0, unresolved: 0, missingAdmin: 0, missingStudent: 0, errors: []};
      for (const profile of profiles) {
        const studentId = G10DataService.normalizeStudentId(profile.studentId);
        if (!studentId) continue;
        stats.checked++;
        const docPath = db.collection("studentCompliance").doc(studentId).collection("terms").doc(`term${term}`);
        const adminPath = db.collection("adminCompliance").doc(studentId).collection("terms").doc(`term${term}`);
        try {
          const [studentDoc, teacherDoc] = await Promise.all([docPath.get({source:"server"}), adminPath.get({source:"server"})]);
          if (!studentDoc.exists) { stats.missingStudent++; continue; }
          if (!teacherDoc.exists) { stats.missingAdmin++; continue; }
          const student = studentDoc.data() || {};
          const teacher = teacherDoc.data() || {};
          const published = Array.isArray(student.tasks) ? student.tasks : [];
          const teacherTasks = Array.isArray(teacher.tasks) ? teacher.tasks : [];
          const authoritativeWW = new Map(teacherTasks
            .filter(t => String(t?.category || "").toLowerCase() === "ww" || /^ww\d+$/i.test(String(t?.taskId || "")))
            .map(t => [String(t.taskId || "").toLowerCase(), t]));
          if (!published.length || !authoritativeWW.size) { stats.unresolved++; continue; }

          let changed = false;
          let unresolvedHere = 0;
          const newTasks = published.map(t => {
            const id = String(t?.taskId || "").toLowerCase();
            const isWW = String(t?.category || "").toLowerCase() === "ww" || /^ww\d+$/i.test(id);
            if (!isWW) return t;  // Keep PT/TA records unchanged.
            const source = authoritativeWW.get(id);
            if (!source) {
              unresolvedHere++;
              const sanitized = studentFacingComplianceTask(t);
              if (JSON.stringify(t) !== JSON.stringify(sanitized)) changed = true;
              return sanitized;
            }
            const clean = studentFacingComplianceTask(source); // WW strict allowlist
            const oldBand = String(t?.percentageBand || "").toLowerCase();
            if (!clean.missing && clean.percentageBand === "neutral") {
              unresolvedHere++;
              // No score/HPS: do not invent any color.
              const sanitized = studentFacingComplianceTask(t);
              if (JSON.stringify(t) !== JSON.stringify(sanitized)) changed = true;
              return sanitized;
            }
            if (oldBand !== clean.percentageBand) {
              stats.wwFixed++;
              changed = true;
            } else {
              stats.wwAlreadyColored++;
            }
            // Rebuild ALL WW fields to remove accidentally published raw data.
            if (JSON.stringify(t) !== JSON.stringify(clean)) changed = true;
            return clean;
          });
          stats.unresolved += unresolvedHere;
          if (changed) {
            await docPath.update({
              tasks: newTasks,
              complianceSchemaVersion: 7,
              wwColorsVerifiedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            stats.patched++;
          }
        } catch (err) {
          stats.errors.push(`${studentId}: ${String(err?.message || err)}`);
        }
      }
      const parts = [
        `Term ${term}: ${stats.checked} student records checked`,
        `${stats.patched} updated`,
        `${stats.wwFixed} WW color bands repaired`,
        `${stats.wwAlreadyColored} already colored`
      ];
      if (stats.unresolved) parts.push(`${stats.unresolved} WW unresolved (missing score/HPS or source)`);
      if (stats.missingAdmin) parts.push(`${stats.missingAdmin} missing admin raw snapshots`);
      if (stats.missingStudent) parts.push(`${stats.missingStudent} missing student snapshots`);
      if (stats.errors.length) parts.push(`${stats.errors.length} read/write errors`);
      const guidance = (stats.unresolved || stats.missingAdmin || stats.missingStudent)
        ? " Some records require SYNC CHECKED SECTIONS & PUBLISH from Google Sheets."
        : " Students should open Compliance and press Refresh.";
      setStatus("#wwRepairStatus", parts.join(" • ") + "." + guidance +
        (stats.errors.length ? ` First error: ${stats.errors[0]}` : ""),
        stats.errors.length === 0 && stats.unresolved === 0 && stats.missingAdmin === 0);
    } catch (err) {
      setStatus("#wwRepairStatus", String(err?.message || err), false);
    } finally {
      setBusy(button, false, "CHECK / REPAIR WW COLORS");
    }
  }

  async function publishSync() {
    const button = $("#publishSyncBtn");
    setBusy(button, true, "SYNCING & PUBLISHING…");
    setStatus("#syncStatus", "Reading the latest Google Sheet data before publishing…");

    try {
      const payload = await readSelectedComplianceSections({
        onProgress: progress => {
          setStatus(
            "#syncStatus",
            `Reading ${progress.section}… ${progress.current}/${progress.total}`
          );
        }
      });

      previewPayload = payload;
      renderSyncPreview(payload);

      if (!payload.readyToPublish) {
        throw new Error("No student records are ready to publish from the checked sections.");
      }

      // PRE-FLIGHT: validate every eligible WW before beginning ANY Firestore writes.
      // Prevents a partly published term with new and old WW colors mixed.
      const colorFailures = [];
      for (const sectionPayload of payload.sections) {
        if (!sectionPayload.readyToPublish) continue;
        for (const row of (sectionPayload.students || [])) {
          if (!G10DataService.normalizeStudentId(row.studentId)) continue;
          const invalidWW = (row.tasks || []).map(studentFacingComplianceTask).filter(task =>
            task.category === "ww" && !task.missing && task.percentageBand === "neutral"
          );
          if (invalidWW.length) colorFailures.push(
            `${sectionPayload.section} / ${row.studentId}: ${invalidWW.length} uncolored WW`
          );
        }
      }
      if (colorFailures.length) {
        throw new Error(
          `Sync stopped BEFORE publishing: ${colorFailures.length} student record(s) have ` +
          `completed Written Works without a usable score/HPS or color band. ` +
          `Examples: ${colorFailures.slice(0, 3).join("; ")}. ` +
          `Check the Sheet values and HPS. Nothing was written.`
        );
      }

      const batchLimit = 380;
      let batch = db.batch();
      let pendingWrites = 0;
      let published = 0;
      let skippedInvalidIds = 0;

      for (const sectionPayload of payload.sections) {
        if (!sectionPayload.readyToPublish) continue;

        const normalizedSection = normalizeSectionName(sectionPayload.section);

        for (const row of sectionPayload.students || []) {
          const rawStudentId = String(row.studentId || "").trim();
          const normalizedStudentId = G10DataService.normalizeStudentId(rawStudentId);

          if (!normalizedStudentId) {
            skippedInvalidIds++;
            continue;
          }

          // Student ID remains the stable document key.
          const studentAuthEmail = G10DataService.studentIdToEmail(normalizedStudentId);

          // Also bind the snapshot to the student's Firebase UID.
          // This makes the read rule independent of synthetic-email formatting.
          const matchingStudent = cachedStudentProfiles.find(student =>
            G10DataService.normalizeStudentId(student.studentId)
              === normalizedStudentId
          );

          const studentUid = String(matchingStudent?.uid || "").trim();

          const rawTasks = Array.isArray(row.tasks) ? row.tasks : [];
          const missingCount = rawTasks.filter(task => task && task.missing === true).length;
          const completeCount = Math.max(0, rawTasks.length - missingCount);

          // Student-facing snapshot: Written Works have status plus a broad
          // color band, but NEVER raw score, HPS, or exact percentage.
          // PT and Term Assessments retain their numeric score + HPS.
          const studentTasks = rawTasks.map(studentFacingComplianceTask);
          const unresolvedWW = studentTasks.filter(task =>
            task.category === "ww" && task.missing === false && task.percentageBand === "neutral"
          );
          if (unresolvedWW.length) {
            throw new Error(
              `Cannot publish WW colors for ${normalizedStudentId}: ` +
              `${unresolvedWW.length} completed Written Work(s) have no numeric score/HPS or valid color band. ` +
              `Check the Google Sheet cells and HPS, then sync again.`
            );
          }

          const studentRef = db.collection("studentCompliance")
            .doc(normalizedStudentId)
            .collection("terms")
            .doc(`term${Number(payload.term)}`);

          const adminRef = db.collection("adminCompliance")
            .doc(normalizedStudentId)
            .collection("terms")
            .doc(`term${Number(payload.term)}`);

          const commonSnapshot = {
            studentId: normalizedStudentId,
            studentIdOriginal: rawStudentId,
            studentAuthEmail,
            studentUid,
            fullName: String(row.fullName || "").trim(),
            term: Number(payload.term),
            section: normalizedSection,
            // Grade is obtained directly from AW (or AV when provisional).
            // No client-side recomputation is performed.
            termGrade: row.termGrade ?? null,
            gradeStatus: String(row.gradeStatus || "not-available"),
            gradeType: String(row.gradeType || "unavailable"),
            gradeSource: String(row.gradeSource || ""),
            lastUpdated: new Date().toISOString(),
            summary: {
              complete: completeCount,
              missing: missingCount,
              total: rawTasks.length
            },
            colorScale: "hps-0-30-31-69-70-84-85-90-91-100",
            publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
            publishedBy: admin.email || admin.uid || "teacher"
          };

          // Students see only an up/down/unchanged indicator for their own grade.
          // The previous numeric grade remains in adminCompliance only.
          const gradeMovement = G10GradeTrend.fromSheetRow(
            row, Number(payload.term), Boolean(sectionPayload.previousTermAvailable)
          );

          batch.set(studentRef, {
            ...commonSnapshot,
            gradeMovement,
            tasks: studentTasks,
            source: "e-class-record",
            complianceSchemaVersion: 7
          }, { merge: true });

          // Admin-only previous-term baseline read from the same Google Sheet.
          // No extra student-facing score data or history is exposed.
          const gradeComparison = Number(payload.term) > 1 && sectionPayload.previousTermAvailable
            ? {
                previousTerm: Number(payload.term) - 1,
                termGrade: row.previousTermGrade ?? null,
                gradeStatus: String(row.previousTermGradeStatus || "not-available"),
                gradeType: String(row.previousTermGradeType || "unavailable"),
                matchedStudentId: Boolean(row.previousTermGradeFound),
                source: "previous-term-sheet"
              }
            : null;

          batch.set(adminRef, {
            ...commonSnapshot,
            tasks: rawTasks,
            gradeComparison,
            adminComplianceSchemaVersion: 4
          }, { merge: true });

          pendingWrites += 2;
          published++;

          if (pendingWrites >= batchLimit) {
            await batch.commit();
            batch = db.batch();
            pendingWrites = 0;
          }
        }
      }

      if (pendingWrites > 0) {
        await batch.commit();
      }

      const issueParts = [];

      if (payload.errors.length) {
        issueParts.push(`${payload.errors.length} sheet issue(s)`);
      }

      if (skippedInvalidIds) {
        issueParts.push(`${skippedInvalidIds} invalid Student ID(s) skipped`);
      }

      setStatus(
        "#syncStatus",
        `Published ${published} student compliance snapshot(s) for TERM ${payload.term}` +
          (issueParts.length ? ` • ${issueParts.join(" • ")}` : "") +
          ". Students can open Compliance and press Refresh.",
        published > 0
      );
    } catch (err) {
      setStatus("#syncStatus", err.message, false);
    } finally {
      setBusy(button, false, "SYNC CHECKED SECTIONS & PUBLISH");
    }
  }



  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.split(",").pop() || "");
      };
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsDataURL(file);
    });
  }

  function setStatus(selector, message, good = null) {
    const el = $(selector);
    el.textContent = message || "";
    el.classList.remove("good", "bad");
    if (good === true) el.classList.add("good");
    if (good === false) el.classList.add("bad");
  }

  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.textContent = label;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
  }
})();
