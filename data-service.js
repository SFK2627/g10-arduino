(function () {
  "use strict";

  const cfg = window.G10_CONFIG || {};
  const cache = {
    settings: null,
    profile: null,
    lessons: {},
    activities: {},
    compliance: {}
  };

  let firebaseApp = null;
  let auth = null;
  let db = null;
  let initialized = false;
  let demoMode = location.protocol === "file:" || localStorage.getItem("g10ForceDemo") === "1";

  function normalizeStudentId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
  }

  function studentIdToEmail(studentId) {
    const clean = normalizeStudentId(studentId);
    if (!clean) throw new Error("Please enter a valid Student ID.");
    return `${clean}@g10proj.student`;
  }

  function canUseFirebase() {
    return !!(window.firebase && cfg.firebase && cfg.firebase.projectId);
  }

  async function init() {
    if (initialized) return { demoMode, auth, db };
    initialized = true;

    if (demoMode || !canUseFirebase()) {
      demoMode = true;
      return { demoMode, auth: null, db: null };
    }

    try {
      firebaseApp = window.firebase.apps && window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(cfg.firebase);

      auth = window.firebase.auth();
      db = window.firebase.firestore();

      // Safe browser-side caching. Failure here must never block the app.
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch (err) {
        console.info("Firestore persistence not enabled:", err && err.code ? err.code : err);
      }

      return { demoMode, auth, db };
    } catch (err) {
      console.error("Firebase initialization failed; switching to demo mode.", err);
      demoMode = true;
      return { demoMode, auth: null, db: null };
    }
  }

  async function signInStudent(studentId, password) {
    await init();

    if (demoMode) {
      cache.profile = Object.assign({}, window.G10_DEMO.profile, {
        studentId: studentId || window.G10_DEMO.profile.studentId
      });
      return cache.profile;
    }

    const email = studentId.includes("@") ? studentId.trim() : studentIdToEmail(studentId);
    const credential = await auth.signInWithEmailAndPassword(email, password);
    const snap = await db.collection("students").doc(credential.user.uid).get();

    if (!snap.exists) {
      await auth.signOut();
      throw new Error("This account exists, but no student profile is assigned yet.");
    }

    const profile = { uid: credential.user.uid, ...snap.data() };
    if (profile.active === false) {
      await auth.signOut();
      throw new Error("This student account is currently inactive.");
    }

    cache.profile = profile;
    return profile;
  }

  async function restoreStudentSession() {
    await init();
    if (demoMode || !auth) return null;

    const currentUser = await new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      });
    });

    if (!currentUser) return null;

    const snap = await db.collection("students").doc(currentUser.uid).get();
    if (!snap.exists) return null;

    cache.profile = { uid: currentUser.uid, ...snap.data() };
    return cache.profile;
  }

  async function getSettings(force = false) {
    await init();
    if (!force && cache.settings) return cache.settings;

    if (demoMode) {
      cache.settings = { ...window.G10_DEMO.settings };
      return cache.settings;
    }

    const snap = await db.collection("settings").doc("main").get();
    cache.settings = snap.exists
      ? snap.data()
      : {
          schoolYear: cfg.app?.schoolYear || "2026-2027",
          currentTerm: cfg.app?.defaultTerm || 1
        };
    return cache.settings;
  }

  function allowedForSection(item, section) {
    const allowed = item.allowedSections;
    if (!Array.isArray(allowed) || allowed.length === 0) return true;
    if (allowed.includes("*")) return true;
    return allowed.includes(section);
  }

  async function getLessons(term, section, force = false) {
    await init();
    const key = `${term}|${section || ""}`;
    if (!force && cache.lessons[key]) return cache.lessons[key];

    let rows;

    if (demoMode) {
      rows = window.G10_DEMO.lessons
        .filter(x => Number(x.term) === Number(term) && x.published)
        .filter(x => allowedForSection(x, section));
    } else {
      // Only the selected term + published metadata is loaded.
      // The actual Drive file is NOT loaded here.
      const snap = await db.collection("lessons")
        .where("term", "==", Number(term))
        .where("published", "==", true)
        .where("allowedSections", "array-contains-any", [section, "*"])
        .limit(50)
        .get();

      rows = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }));
    }

    rows.sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999));
    cache.lessons[key] = rows;
    return rows;
  }

  async function getActivities(term, section, force = false) {
    await init();
    const key = `${term}|${section || ""}`;
    if (!force && cache.activities[key]) return cache.activities[key];

    let rows;

    if (demoMode) {
      rows = window.G10_DEMO.activities
        .filter(x => Number(x.term) === Number(term) && x.published)
        .filter(x => allowedForSection(x, section));
    } else {
      const snap = await db.collection("activities")
        .where("term", "==", Number(term))
        .where("published", "==", true)
        .where("allowedSections", "array-contains-any", [section, "*"])
        .limit(50)
        .get();

      rows = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }));
    }

    rows.sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999));
    cache.activities[key] = rows;
    return rows;
  }

  async function getCompliance(uid, term, force = false) {
    await init();
    const key = `${uid}|${term}`;
    if (!force && cache.compliance[key]) return cache.compliance[key];

    if (demoMode) {
      const result = { ...window.G10_DEMO.compliance, term: Number(term) };
      cache.compliance[key] = result;
      return result;
    }

    const snap = await db
      .collection("studentCompliance")
      .doc(uid)
      .collection("terms")
      .doc(`term${Number(term)}`)
      .get();

    const result = snap.exists
      ? snap.data()
      : { term: Number(term), lastUpdated: null, tasks: [] };

    cache.compliance[key] = result;
    return result;
  }

  function clearPageCache(type) {
    if (type === "lessons") cache.lessons = {};
    if (type === "activities") cache.activities = {};
    if (type === "compliance") cache.compliance = {};
    if (type === "settings") cache.settings = null;
  }

  function clearAllCache() {
    cache.settings = null;
    cache.profile = null;
    cache.lessons = {};
    cache.activities = {};
    cache.compliance = {};
  }

  async function logout() {
    clearAllCache();
    if (!demoMode && auth) await auth.signOut();
  }

  function drivePreviewUrl(fileId) {
    if (!fileId) return "";
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
  }

  function driveImageUrl(fileId) {
    if (!fileId) return "";
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`;
  }

  function extractDriveFileId(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (!text.includes("/")) return text;

    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return text;
  }

  async function signInAdmin(email, password) {
    await init();
    if (demoMode) throw new Error("Admin live mode requires the hosted app, not file:// demo mode.");

    const credential = await auth.signInWithEmailAndPassword(email.trim(), password);
    const adminSnap = await db.collection("admins").doc(credential.user.uid).get();

    if (!adminSnap.exists) {
      await auth.signOut();
      throw new Error("Signed in, but this Firebase user is not listed in the admins collection.");
    }

    return { uid: credential.user.uid, email: credential.user.email, ...adminSnap.data() };
  }

  function getFirebaseHandles() {
    return { firebaseApp, auth, db, demoMode };
  }

  window.G10DataService = {
    init,
    isDemo: () => demoMode,
    signInStudent,
    restoreStudentSession,
    getSettings,
    getLessons,
    getActivities,
    getCompliance,
    clearPageCache,
    clearAllCache,
    logout,
    drivePreviewUrl,
    driveImageUrl,
    extractDriveFileId,
    studentIdToEmail,
    signInAdmin,
    getFirebaseHandles
  };
})();
