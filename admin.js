(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  let admin = null;
  let db = null;
  let previewPayload = null;

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
        allowedSections: parseSections($("#lessonSections").value),
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
        allowedSections: parseSections($("#activitySections").value),
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
        section: $("#newStudentSection").value.trim(),
        role: "student",
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      $("#studentForm").reset();
      $("#newStudentPassword").value = "123456";
      setStatus("#studentStatus", `Student created. Login ID: ${studentId}`, true);
      await loadStudents();
    } catch (err) {
      setStatus("#studentStatus", err.message, false);
    }
  }

  async function loadStudents() {
    const target = $("#adminStudentsList");
    target.textContent = "Loading…";

    try {
      const snap = await db.collection("students").orderBy("fullName").get();
      const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

      target.innerHTML = rows.length ? rows.map(s => `
        <div class="admin-list-item">
          <div>
            <strong>${escapeHtml(s.fullName || s.studentId)}</strong>
            <small>${escapeHtml(s.studentId || "")} • ${escapeHtml(s.section || "")} • ${s.active === false ? "Inactive" : "Active"}</small>
          </div>
          <div class="inline-actions">
            <button class="mini-btn student-toggle" data-uid="${s.uid}" data-active="${s.active === false ? "0" : "1"}">${s.active === false ? "Activate" : "Deactivate"}</button>
          </div>
        </div>`).join("") : "No student profiles yet.";

      $$(".student-toggle").forEach(btn => {
        btn.addEventListener("click", async () => {
          await db.collection("students").doc(btn.dataset.uid).update({
            active: btn.dataset.active !== "1",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await loadStudents();
        });
      });
    } catch (err) {
      target.textContent = err.message;
    }
  }

  async function previewSync(e) {
    e.preventDefault();
    const url = String(G10_CONFIG.appsScriptUrl || "").trim();
    if (!url) {
      setStatus("#syncStatus", "Set appsScriptUrl in firebase-config.js first.", false);
      return;
    }

    setStatus("#syncStatus", "Reading and processing the selected sheet through Apps Script…");
    $("#publishSyncBtn").disabled = true;
    previewPayload = null;

    try {
      const result = await callAppsScriptSecure({
        action: "previewCompliance",
        sheetName: $("#syncSheetName").value.trim(),
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
