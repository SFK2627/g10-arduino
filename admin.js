(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let admin = null;
  let db = null;
  let previewPayload = null;
  let bulkStudentRows = [];
  let knownSections = [];
  let cachedStudentProfiles = [];

  let complianceSettingsCache = null;
  let activeComplianceTaskGroup = "ww";

  let editingAnnouncementId = null;
  let adminNotificationUnsubscribe = null;
  let currentUnreadNotifications = [];

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
    $("#lessonForm").addEventListener("submit", saveLesson);
    $("#activityForm").addEventListener("submit", saveActivity);
    $("#announcementForm").addEventListener("submit", saveAnnouncement);
    $("#cancelAnnouncementEditBtn").addEventListener("click", resetAnnouncementForm);
    $("#refreshAnnouncementsAdmin").addEventListener("click", loadAdminAnnouncements);
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
  }

  async function adminLogout() {
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

    if (page === "announcements") await loadAdminAnnouncements();
    if (page === "lessons") await loadAdminLessons();
    if (page === "activities") await loadAdminActivities();
    if (page === "students") await loadStudents();
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
    $("#settingSchoolYear").value = data.schoolYear || G10_CONFIG.app.schoolYear || "2026-2027";
    $("#settingCurrentTerm").value = String(data.currentTerm || 1);
  }

  async function saveSettings(e) {
    e.preventDefault();
    setStatus("#settingsStatus", "Saving…");

    try {
      const data = {
        schoolYear: $("#settingSchoolYear").value.trim(),
        currentTerm: Number($("#settingCurrentTerm").value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("settings").doc("main").set(data, { merge: true });
      setStatus("#settingsStatus", "Settings saved.", true);
    } catch (err) {
      setStatus("#settingsStatus", err.message, false);
    }
  }

  function parseSections(text) {
    const items = String(text || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    return items.length ? items : ["*"];
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

  async function maybeUploadFile(input, category) {
    const file = input.files && input.files[0];
    if (!file) return null;

    if (!String(G10_CONFIG.appsScriptUrl || "").trim()) {
      throw new Error("A file was selected, but appsScriptUrl is still blank. Either configure Apps Script or paste a Drive File ID/URL instead.");
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error("For this simple browser-to-Apps-Script uploader, keep uploads at 8 MB or less. Larger files can be uploaded directly to Drive and then referenced by File ID.");
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

    const form = $("#announcementForm");
    if (form) form.reset();

    $("#announcementPublished").checked = true;
    $("#announcementPublishAt").value = toLocalDateTimeInput(new Date());
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

  async function saveAnnouncement(e) {
    e.preventDefault();

    const btn = $("#saveAnnouncementBtn");
    setBusy(btn, true, editingAnnouncementId ? "UPDATING…" : "SAVING…");
    setStatus("#announcementStatus", "Saving announcement…");

    try {
      const dateInput = $("#announcementPublishAt").value;
      const publishDate = dateInput ? new Date(dateInput) : new Date();

      if (Number.isNaN(publishDate.getTime())) {
        throw new Error("Please enter a valid publish date and time.");
      }

      const payload = {
        title: $("#announcementTitle").value.trim(),
        message: $("#announcementMessage").value.trim(),
        allowedSections: getSelectedSections("announcement"),
        published: $("#announcementPublished").checked,
        publishAt: firebase.firestore.Timestamp.fromDate(publishDate),
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
        feedVersion: 1,
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
      await loadAdminAnnouncements();
    } catch (err) {
      setStatus("#announcementStatus", err.message || "Could not save announcement.", false);
    } finally {
      setBusy(btn, false, editingAnnouncementId ? "UPDATE ANNOUNCEMENT" : "SAVE ANNOUNCEMENT");
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
        if (item.feedVersion !== 1) {
          await syncAnnouncementFeeds(item.id, item);
          await db.collection("announcements").doc(item.id).set({
            feedVersion: 1,
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
          feedVersion: 1,
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
    const feedPayload = {
      ...payload,
      sourceId: documentId,
      feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

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
    if (item.feedVersion === 2) return;

    await syncMaterialFeeds(collectionName, item.id, item);

    await db.collection(collectionName).doc(item.id).set({
      feedVersion: 2,
      feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    item.feedVersion = 1;
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
      let fileId = G10DataService.extractDriveFileId($("#activityFileId").value);
      let fileName = "";
      let fileType = "application/pdf";
      let fileSize = null;

      const uploaded = await maybeUploadFile($("#activityFile"), "activities");
      if (uploaded) {
        fileId = uploaded.fileId;
        fileName = uploaded.fileName;
        fileType = uploaded.fileType;
        fileSize = uploaded.fileSize;
      }

      const payload = {
        title: $("#activityTitle").value.trim(),
        description: $("#activityDescription").value.trim(),
        term: Number($("#activityTerm").value),
        order: Number($("#activityOrder").value),
        dueDate: $("#activityDueDate").value || "",
        allowedSections: getSelectedSections("activity"),
        fileId,
        fileName,
        fileType,
        fileSize,
        published: $("#activityPublished").checked,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      const ref = await db.collection("activities").add(payload);
      await syncMaterialFeeds("activities", ref.id, payload);
      await ref.set({
        feedVersion: 2,
        feedUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await refreshDashboardLatest("activities");
      $("#activityForm").reset();
      $("#activityTerm").value = "1";
      $("#activityOrder").value = "1";
      $("#activityPublished").checked = true;
      setStatus("#activityStatus", `Activity saved: ${ref.id}`, true);
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

  function adminItem(x, collection) {
    return `
      <div class="admin-list-item">
        <div>
          <strong>${escapeHtml(x.title || "Untitled")}</strong>
          <small>Term ${escapeHtml(x.term)} • Order ${escapeHtml(x.order)} • ${x.published ? "Published" : "Hidden"}</small>
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

  function renderStudentProfiles() {
    const target = $("#adminStudentsList");
    if (!target) return;

    const selectedSection = $("#studentSectionFilter")?.value || "*";
    const rows = selectedSection === "*"
      ? cachedStudentProfiles
      : cachedStudentProfiles.filter(student => normalizeSectionName(student.section) === selectedSection);

    target.innerHTML = rows.length ? rows.map(s => `
      <div class="admin-list-item">
        <div>
          <strong>${escapeHtml(s.fullName || s.studentId)}</strong>
          <small>${escapeHtml(s.studentId || "")} • ${escapeHtml(s.gender || "—")} • ${escapeHtml(s.section || "")} • ${s.active === false ? "Inactive" : "Active"}</small>
        </div>
        <div class="inline-actions">
          <button class="mini-btn student-toggle" data-uid="${s.uid}" data-active="${s.active === false ? "0" : "1"}">${s.active === false ? "Activate" : "Deactivate"}</button>
        </div>
      </div>`).join("") : "No students found for this section.";

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
      count: 2,
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

  function renderSyncPreview(payload) {
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];

    const totalStudents = sections.reduce(
      (total, section) => total + (section.students?.length || 0),
      0
    );

    $("#syncPreviewNote").textContent =
      sections.length
        ? `${sections.length} section(s) • ${totalStudents} student row(s) • ${payload.sheetName || `TERM_${payload.term}`}`
        : "No section preview is available.";

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
              <td>${escapeHtml(String((student.tasks || []).length))}</td>
              <td>${escapeHtml(String(student.missingCount || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
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

      const batchLimit = 400;
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

          // Same reliable pattern used by the working Code Editor Compliance:
          // the published document key comes from Student ID itself.
          const studentAuthEmail = G10DataService.studentIdToEmail(normalizedStudentId);

          const tasks = Array.isArray(row.tasks) ? row.tasks : [];
          const missingCount = tasks.filter(task => task && task.missing === true).length;
          const completeCount = Math.max(0, tasks.length - missingCount);

          const ref = db.collection("studentCompliance")
            .doc(normalizedStudentId)
            .collection("terms")
            .doc(`term${Number(payload.term)}`);

          batch.set(ref, {
            studentId: normalizedStudentId,
            studentIdOriginal: rawStudentId,
            studentAuthEmail,
            fullName: String(row.fullName || "").trim(),
            term: Number(payload.term),
            section: normalizedSection,
            lastUpdated: new Date().toISOString(),
            summary: {
              complete: completeCount,
              missing: missingCount,
              total: tasks.length
            },
            tasks,
            source: "e-class-record",
            complianceSchemaVersion: 2,
            colorScale: "hps-0-40-41-74-75-85-86-90-91-100",
            publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
            publishedBy: admin.email || admin.uid || "teacher"
          }, { merge: true });

          pendingWrites++;
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
