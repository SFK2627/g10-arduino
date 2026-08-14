/**
 * GRADE 10 ARDUINO HUB — SECURED GOOGLE APPS SCRIPT BRIDGE (v3)
 *
 * Student pages NEVER call this bridge.
 *
 * Admin-only jobs:
 * - Google Drive upload
 * - Google Sheet compliance preview
 *
 * SECURITY:
 * Every POST request must contain a fresh Firebase ID token.
 * The bridge validates the token through Firebase Authentication and then
 * verifies that /admins/{uid} exists through Firestore REST using the same
 * Firebase ID token. Firestore Security Rules therefore remain the authority.
 *
 * No service account and no paid backend are required for this bridge.
 */

const FIREBASE_WEB_API_KEY = "AIzaSyC06MIZ-KwgHo3Qq5g7HP3WViBG92xRSYA";
const FIREBASE_PROJECT_ID = "g10proj";

const COMPLIANCE_SCHEMA = {
  /*
    REQUIRED BEFORE REAL COMPLIANCE PUBLISHING

    Example only — replace these with YOUR real sheet/header rules:

    studentIdHeader: "Student ID",
    fullNameHeader: "Name",

    tasks: [
      {
        header: "Mini PETA 3",
        taskId: "mini-peta-3",
        displayName: "Mini PETA 3 - Emergency Lights",
        practicalExam: false,
        maxScore: 20
      }
    ],

    bands: [
      // Define your OWN official thresholds here.
      // Example shape:
      // { minPercent: 90, status: "excellent", percentageBand: "green" }
    ]
  */

  studentIdHeader: "",
  fullNameHeader: "",
  tasks: [],
  bands: []
};

function doGet() {
  return jsonOutput_({
    ok: true,
    service: "Grade 10 Arduino Hub Google Services Bridge",
    version: "v3-secured",
    message: "Bridge is online. Admin POST actions require Firebase authentication."
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // Every privileged action must pass this check first.
    const admin = authenticateAdmin_(payload);
    const action = String(payload.action || "");

    if (action === "uploadFile") {
      const result = uploadFile_(payload);
      result.adminUid = admin.uid;
      return jsonOutput_(result);
    }

    if (action === "previewCompliance") {
      const result = previewCompliance_(payload);
      result.adminUid = admin.uid;
      return jsonOutput_(result);
    }

    return jsonOutput_({ ok: false, error: "Unknown action." });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const unauthorized = /^UNAUTHORIZED:/.test(message);

    return jsonOutput_({
      ok: false,
      code: unauthorized ? "UNAUTHORIZED" : "ERROR",
      error: unauthorized ? message.replace(/^UNAUTHORIZED:\s*/, "") : message
    });
  }
}

/**
 * 1) Validate the Firebase ID token against Firebase Authentication.
 * 2) Use that same ID token to read /admins/{uid} through Firestore REST.
 *    The Firestore rules decide whether this user may read the admin doc.
 */
function authenticateAdmin_(payload) {
  const idToken = String(payload.idToken || "").trim();

  if (!idToken) {
    throw new Error("UNAUTHORIZED: Missing Firebase ID token.");
  }

  const lookupUrl =
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" +
    encodeURIComponent(FIREBASE_WEB_API_KEY);

  const lookupResponse = UrlFetchApp.fetch(lookupUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });

  if (lookupResponse.getResponseCode() !== 200) {
    throw new Error("UNAUTHORIZED: Firebase login token is invalid or expired.");
  }

  let lookup;
  try {
    lookup = JSON.parse(lookupResponse.getContentText());
  } catch (_) {
    throw new Error("UNAUTHORIZED: Firebase token validation returned invalid data.");
  }

  const user = lookup.users && lookup.users[0];
  const uid = user && user.localId;

  if (!uid || user.disabled === true) {
    throw new Error("UNAUTHORIZED: Firebase account is unavailable.");
  }

  const adminDocUrl =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(FIREBASE_PROJECT_ID) +
    "/databases/(default)/documents/admins/" +
    encodeURIComponent(uid);

  const adminResponse = UrlFetchApp.fetch(adminDocUrl, {
    method: "get",
    headers: {
      Authorization: "Bearer " + idToken
    },
    muteHttpExceptions: true
  });

  if (adminResponse.getResponseCode() !== 200) {
    throw new Error("UNAUTHORIZED: This Firebase account is not registered as an admin.");
  }

  return {
    uid: uid,
    email: user.email || ""
  };
}

function uploadFile_(payload) {
  const category = payload.category === "activities" ? "activities" : "lessons";
  const root = getOrCreateRootFolder_();
  const folder = getOrCreateChildFolder_(root, category);

  if (!payload.base64 || !payload.fileName) {
    throw new Error("Missing file data.");
  }

  const bytes = Utilities.base64Decode(payload.base64);
  const blob = Utilities.newBlob(
    bytes,
    payload.mimeType || "application/octet-stream",
    payload.fileName
  );

  const file = folder.createFile(blob);

  // Learning materials only. Compliance/student data must never be stored here.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    ok: true,
    file: {
      fileId: file.getId(),
      fileName: file.getName(),
      fileType: file.getMimeType(),
      fileSize: file.getSize()
    }
  };
}

function previewCompliance_(payload) {
  const sheetName = String(payload.sheetName || "").trim();
  const term = Number(payload.term || 1);

  if (!sheetName) {
    throw new Error("Sheet name is required.");
  }

  const spreadsheet = getConfiguredSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet not found: "' + sheetName + '".');
  }

  // One batch read. Never one-cell-at-a-time.
  const values = sheet.getDataRange().getValues();

  if (!values.length) {
    return {
      ok: true,
      term: term,
      readyToPublish: false,
      students: [],
      note: "The selected sheet is empty."
    };
  }

  const schemaReady =
    COMPLIANCE_SCHEMA.studentIdHeader &&
    COMPLIANCE_SCHEMA.tasks.length > 0 &&
    COMPLIANCE_SCHEMA.bands.length > 0;

  if (!schemaReady) {
    // Safe structural preview only. No made-up grades/statuses.
    const headers = values[0].map(String);
    const maybeIdIndex = headers.findIndex(h =>
      /student\s*id/i.test(h) || /^id$/i.test(h)
    );
    const maybeNameIndex = headers.findIndex(h =>
      /name/i.test(h)
    );

    const students = values.slice(1)
      .filter(row => row.some(v => String(v).trim() !== ""))
      .map(row => ({
        studentId: maybeIdIndex >= 0 ? String(row[maybeIdIndex] || "").trim() : "",
        fullName: maybeNameIndex >= 0 ? String(row[maybeNameIndex] || "").trim() : "",
        tasks: [],
        ready: false
      }));

    return {
      ok: true,
      term: term,
      readyToPublish: false,
      students: students,
      note:
        "Sheet was read successfully in one batch, but Code.gs still needs your exact compliance headers, task mapping, and official percentage-band thresholds. Publishing is intentionally disabled so the app does not invent grades/statuses."
    };
  }

  const headers = values[0].map(v => String(v).trim());
  const idIndex = headers.indexOf(COMPLIANCE_SCHEMA.studentIdHeader);
  const nameIndex = COMPLIANCE_SCHEMA.fullNameHeader
    ? headers.indexOf(COMPLIANCE_SCHEMA.fullNameHeader)
    : -1;

  if (idIndex < 0) {
    throw new Error("Configured Student ID header was not found.");
  }

  const taskIndexes = COMPLIANCE_SCHEMA.tasks.map(task => {
    const index = headers.indexOf(task.header);
    if (index < 0) {
      throw new Error('Configured task header not found: "' + task.header + '".');
    }
    return { task: task, index: index };
  });

  const students = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const studentId = String(row[idIndex] || "").trim();
    if (!studentId) continue;

    const tasks = taskIndexes.map(item => {
      const task = item.task;
      const rawScore = Number(row[item.index]);
      const maxScore = Number(task.maxScore);

      if (!Number.isFinite(rawScore) || !Number.isFinite(maxScore) || maxScore <= 0) {
        return {
          taskId: task.taskId,
          displayName: task.displayName,
          status: "missing",
          percentageBand: "red",
          practicalExam: !!task.practicalExam,
          missing: true,
          missingReason: "No valid score/submission was found in the sheet."
        };
      }

      const percent = (rawScore / maxScore) * 100;
      const band = findBand_(percent);

      const result = {
        taskId: task.taskId,
        displayName: task.displayName,
        status: band.status,
        percentageBand: band.percentageBand,
        practicalExam: !!task.practicalExam,
        missing: !!band.missing,
        missingReason: band.missingReason || ""
      };

      // Raw score is student-visible only for Practical Exam.
      if (task.practicalExam) {
        result.score = rawScore;
        result.maxScore = maxScore;
      }

      return result;
    });

    students.push({
      studentId: studentId,
      fullName: nameIndex >= 0 ? String(row[nameIndex] || "").trim() : "",
      tasks: tasks,
      ready: true
    });
  }

  return {
    ok: true,
    term: term,
    readyToPublish: true,
    students: students,
    note: students.length + " student row(s) processed."
  };
}

function findBand_(percent) {
  const sorted = COMPLIANCE_SCHEMA.bands
    .slice()
    .sort((a, b) => Number(b.minPercent) - Number(a.minPercent));

  for (let i = 0; i < sorted.length; i++) {
    if (percent >= Number(sorted[i].minPercent)) {
      return {
        status: sorted[i].status,
        percentageBand: sorted[i].percentageBand,
        missing: !!sorted[i].missing,
        missingReason: sorted[i].missingReason || ""
      };
    }
  }

  return {
    status: "missing",
    percentageBand: "red",
    missing: true,
    missingReason: "Requirement is below the configured completion threshold."
  };
}

function getConfiguredSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty("COMPLIANCE_SPREADSHEET_ID");

  if (!spreadsheetId) {
    throw new Error(
      'Set Script Property "COMPLIANCE_SPREADSHEET_ID" first.'
    );
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getOrCreateRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("ROOT_FOLDER_ID");

  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (err) {}
  }

  const folder = DriveApp.createFolder("G10-ARDUINO-HUB");
  props.setProperty("ROOT_FOLDER_ID", folder.getId());
  return folder;
}

function getOrCreateChildFolder_(parent, name) {
  const props = PropertiesService.getScriptProperties();
  const key = String(name).toUpperCase() + "_FOLDER_ID";
  const savedId = props.getProperty(key);

  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (err) {}
  }

  const folders = parent.getFoldersByName(name);
  const folder = folders.hasNext() ? folders.next() : parent.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function jsonOutput_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
