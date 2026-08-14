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

    if (handles.auth && handles.auth.currentUser) {
      try {
        const snap = await db.collection("admins").doc(handles.auth.currentUser.uid).get();
        if (snap.exists) {
          admin = { uid: handles.auth.currentUser.uid, email: handles.auth.currentUser.email, ...snap.data() };
          await enterAdmin();
        }
      } catch (_) {}
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
    $("#studentForm").addEventListener("submit", createStudent);
    $("#bulkStudentForm").addEventListener("submit", previewBulkStudents);
    $("#bulkImportBtn").addEventListener("click", importBulkStudents);
    $("#newStudentSection").addEventListener("change", handleNewStudentSectionChange);
    $("#syncSheetName").addEventListener("change", handleSyncSheetChange);
    $("#studentSectionFilter").addEventListener("change", renderStudentProfiles);
    $("#syncPreviewForm").addEventListener("submit", previewSync);
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
  }

  async function adminLogout() {
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

    if (page === "lessons") await loadAdminLessons();
    if (page === "activities") await loadAdminActivities();
    if (page === "students") await loadStudents();
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

    // Compliance Sync: section names become suggested sheet names.
    const syncSelect = $("#syncSheetName");
    if (syncSelect) {
      const previous = syncSelect.value;
      syncSelect.innerHTML =
        optionHtml("", "Select section") +
        knownSections.map(section => optionHtml(section, section, previous === section)).join("") +
        optionHtml("__custom__", "Other sheet name…", previous === "__custom__");
    }

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

  function handleSyncSheetChange() {
    const custom = $("#syncSheetName").value === "__custom__";
    $("#syncSheetCustomWrap").classList.toggle("hidden", !custom);
    $("#syncSheetCustom").required = custom;
    if (!custom) $("#syncSheetCustom").value = "";
  }

  function getSyncSheetName() {
    const selected = $("#syncSheetName").value;
    return selected === "__custom__"
      ? String($("#syncSheetCustom").value || "").trim()
      : String(selected || "").trim();
  }

  async function loadSettings() {
    const snap = await db.collection("settings").doc("main").get();
    const data = snap.exists ? snap.data() : {};
    $("#settingSchoolYear").value = data.schoolYear || G10_CONFIG.app.schoolYear || "2026-2027";
    $("#settingCurrentTerm").value = String(data.currentTerm || 1);
    $("#settingAnnouncement").value = data.announcement || "";
  }

  async function saveSettings(e) {
    e.preventDefault();
    setStatus("#settingsStatus", "Saving…");

    try {
      const data = {
        schoolYear: $("#settingSchoolYear").value.trim(),
        currentTerm: Number($("#settingCurrentTerm").value),
        announcement: $("#settingAnnouncement").value.trim(),
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
      await updateLatestTitle("latestLessonTitle", payload.title);
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
      await updateLatestTitle("latestActivityTitle", payload.title);
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

  async function updateLatestTitle(field, title) {
    await db.collection("settings").doc("main").set({
      [field]: title,
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

      target.innerHTML = rows.length ? rows.map(x => adminItem(x, "lessons")).join("") : "No lessons yet.";
      bindAdminItemButtons();
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

      target.innerHTML = rows.length ? rows.map(x => adminItem(x, "activities")).join("") : "No activities yet.";
      bindAdminItemButtons();
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
        await db.collection(btn.dataset.collection).doc(btn.dataset.id).update({
          published: btn.dataset.published !== "1",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        btn.dataset.collection === "lessons" ? await loadAdminLessons() : await loadAdminActivities();
      });
    });

    $$(".admin-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this Firestore metadata record? The Drive file itself will not be deleted by this button.")) return;
        await db.collection(btn.dataset.collection).doc(btn.dataset.id).delete();
        btn.dataset.collection === "lessons" ? await loadAdminLessons() : await loadAdminActivities();
      });
    });
  }

  async function createStudent(e) {
    e.preventDefault();
    setStatus("#studentStatus", "Creating Firebase Auth account…");

    try {
      const studentId = $("#newStudentId").value.trim();
      const password = $("#newStudentPassword").value;
      const section = getNewStudentSection();

      if (!section) {
        throw new Error("Please select or enter a section.");
      }

      const email = G10DataService.studentIdToEmail(studentId);

      const apiKey = G10_CONFIG.firebase.apiKey;
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });

      const authResult = await response.json();
      if (!response.ok) {
        const message = authResult?.error?.message || "Could not create Firebase Authentication user.";
        throw new Error(message);
      }

      const uid = authResult.localId;
      await db.collection("students").doc(uid).set({
        studentId,
        fullName: $("#newStudentName").value.trim(),
        gender: $("#newStudentGender").value,
        section,
        role: "student",
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      $("#studentForm").reset();
      $("#newStudentPassword").value = "123456";
      $("#newStudentSectionCustomWrap").classList.add("hidden");
      $("#newStudentSectionCustom").required = false;
      setStatus("#studentStatus", `Student created. Login ID: ${studentId}`, true);
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

    const btn = $("#bulkImportBtn");
    btn.disabled = true;

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      btn.textContent = `IMPORTING ${i + 1}/${validRows.length}…`;
      setStatus(
        "#bulkStudentStatus",
        `Creating ${i + 1} of ${validRows.length}: ${row.fullName}…`
      );

      try {
        const result = await createStudentFromRoster(row, password);
        if (result === "created") created++;
        if (result === "skipped") skipped++;
      } catch (err) {
        failed++;
        failures.push(`${row.studentId}: ${err.message || "Failed"}`);
      }

      // Small yield so the browser UI stays responsive during large rosters.
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    btn.textContent = "IMPORT VALID STUDENTS";
    $("#bulkStudentFile").value = "";
    bulkStudentRows = [];
    $("#bulkPreviewWrap").classList.add("hidden");

    const parts = [`Created: ${created}`];
    if (skipped) parts.push(`Skipped existing: ${skipped}`);
    if (failed) parts.push(`Failed: ${failed}`);

    setStatus(
      "#bulkStudentStatus",
      parts.join(" • ") + (failures.length ? ` — ${failures.slice(0, 3).join(" | ")}` : ""),
      failed === 0
    );

    await loadSectionDirectory(true);
    await loadStudents();
  }

  async function createStudentFromRoster(row, password) {
    const email = G10DataService.studentIdToEmail(row.studentId);
    const apiKey = G10_CONFIG.firebase.apiKey;

    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    });

    const authResult = await response.json();

    if (!response.ok) {
      const message = authResult?.error?.message || "Could not create Authentication account.";
      if (message === "EMAIL_EXISTS") return "skipped";
      throw new Error(message);
    }

    const uid = authResult.localId;

    await db.collection("students").doc(uid).set({
      studentId: row.studentId,
      fullName: row.fullName,
      gender: row.gender,
      section: row.section,
      role: "student",
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    return "created";
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

  async function previewSync(e) {
    e.preventDefault();
    const url = String(G10_CONFIG.appsScriptUrl || "").trim();
    if (!url) {
      setStatus("#syncStatus", "Set appsScriptUrl in firebase-config.js first.", false);
      return;
    }

    const resolvedSheetName = getSyncSheetName();
    if (!resolvedSheetName) {
      setStatus("#syncStatus", "Select a section or enter the exact Google Sheet tab name.", false);
      return;
    }

    setStatus("#syncStatus", "Reading and processing the selected sheet through Apps Script…");
    $("#publishSyncBtn").disabled = true;
    previewPayload = null;

    try {
      const result = await callAppsScriptSecure({
        action: "previewCompliance",
        sheetName: resolvedSheetName,
        term: Number($("#syncTerm").value)
      });

      previewPayload = result;
      renderSyncPreview(result);

      /*
        Publishing is only enabled if Apps Script declares the preview ready.
        The supplied architecture did not define the teacher's exact Sheet
        columns or compliance band thresholds, so Code.gs intentionally
        refuses to invent those rules.
      */
      $("#publishSyncBtn").disabled = !result.readyToPublish;
      setStatus(
        "#syncStatus",
        result.readyToPublish
          ? "Preview ready. Review it before publishing."
          : "Preview loaded, but publishing is disabled until the sheet mapping/band rules are configured in Code.gs.",
        !!result.readyToPublish
      );
    } catch (err) {
      setStatus("#syncStatus", err.message, false);
      $("#syncPreviewTable").innerHTML = "";
    }
  }

  function renderSyncPreview(result) {
    $("#syncPreviewNote").textContent = result.note || `${result.students?.length || 0} student rows processed.`;

    const students = Array.isArray(result.students) ? result.students : [];
    if (!students.length) {
      $("#syncPreviewTable").innerHTML = `<div class="empty-state">No preview rows returned.</div>`;
      return;
    }

    $("#syncPreviewTable").innerHTML = `
      <table class="preview-table">
        <thead><tr><th>Student ID</th><th>Name</th><th>Tasks</th><th>Publish Ready</th></tr></thead>
        <tbody>
          ${students.map(s => `
            <tr>
              <td>${escapeHtml(s.studentId || "")}</td>
              <td>${escapeHtml(s.fullName || "")}</td>
              <td>${escapeHtml(String((s.tasks || []).length))}</td>
              <td>${s.ready ? "Yes" : "No"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  async function publishSync() {
    if (!previewPayload || !previewPayload.readyToPublish) return;
    const btn = $("#publishSyncBtn");
    setBusy(btn, true, "PUBLISHING…");
    setStatus("#syncStatus", "Publishing a new snapshot. Existing student snapshots remain available until each new document is written.");

    try {
      const studentsById = new Map();
      const studentSnap = await db.collection("students").get();
      studentSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.studentId) studentsById.set(String(data.studentId).trim(), doc.id);
      });

      const batchLimit = 400;
      let batch = db.batch();
      let count = 0;
      let written = 0;

      for (const row of previewPayload.students || []) {
        const uid = studentsById.get(String(row.studentId || "").trim());
        if (!uid) continue;

        const ref = db.collection("studentCompliance")
          .doc(uid)
          .collection("terms")
          .doc(`term${Number(previewPayload.term)}`);

        batch.set(ref, {
          term: Number(previewPayload.term),
          lastUpdated: new Date().toISOString(),
          tasks: row.tasks || [],
          source: "apps-script-preview",
          publishedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        count++;
        written++;

        if (count >= batchLimit) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) await batch.commit();
      setStatus("#syncStatus", `Published ${written} student compliance snapshot(s).`, true);
    } catch (err) {
      setStatus("#syncStatus", err.message, false);
    } finally {
      setBusy(btn, false, "PUBLISH PREVIEW TO FIRESTORE");
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
