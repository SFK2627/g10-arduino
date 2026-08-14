(function () {
  "use strict";

  const cfg = window.G10_CONFIG || {};
  const cache = {
    settings: null,
    profile: null,
    lessons: {},
    activities: {},
    announcements: {},
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


  function configuredAdminEmails() {
    return Array.isArray(cfg.app?.adminEmails)
      ? cfg.app.adminEmails
          .map(value => String(value || "").trim().toLowerCase())
          .filter(Boolean)
      : [];
  }

  async function resolveSignedInAccount(user) {
    if (!user) return null;

    await user.getIdToken(true);

    const signedInEmail = String(user.email || "").trim().toLowerCase();
    const isConfiguredAdmin = configuredAdminEmails().includes(signedInEmail);

    // The explicitly configured teacher account can be recognized immediately.
    if (isConfiguredAdmin) {
      let adminData = {};

      try {
        const adminSnap = await db.collection("admins").doc(user.uid).get();
        if (adminSnap.exists) adminData = adminSnap.data() || {};
      } catch (_) {}

      return {
        role: "admin",
        admin: {
          uid: user.uid,
          email: user.email,
          name: adminData.name || "Teacher Admin",
          role: "admin",
          ...adminData
        }
      };
    }

    // Normal student path: one profile read.
    try {
      const studentSnap = await db.collection("students").doc(user.uid).get();

      if (studentSnap.exists) {
        const student = {
          uid: user.uid,
          ...studentSnap.data()
        };

        if (student.active === false) {
          throw new Error("This student account is currently inactive.");
        }

        cache.profile = student;

        return {
          role: "student",
          profile: student
        };
      }
    } catch (err) {
      if (
        err &&
        err.message === "This student account is currently inactive."
      ) {
        throw err;
      }
    }

    // Additional admin documents still work even when the email is not in
    // the small configured allowlist.
    try {
      const adminSnap = await db.collection("admins").doc(user.uid).get();

      if (adminSnap.exists) {
        return {
          role: "admin",
          admin: {
            uid: user.uid,
            email: user.email,
            ...adminSnap.data()
          }
        };
      }
    } catch (_) {}

    return null;
  }

  async function signInAccount(identifier, password) {
    await init();

    if (demoMode) {
      const student = await signInStudent(identifier, password);
      return {
        role: "student",
        profile: student
      };
    }

    const rawIdentifier = String(identifier || "").trim();

    if (!rawIdentifier) {
      throw new Error("Enter your Student ID or Admin Email.");
    }

    const email = rawIdentifier.includes("@")
      ? rawIdentifier.toLowerCase()
      : studentIdToEmail(rawIdentifier);

    const credential = await auth.signInWithEmailAndPassword(email, password);
    const account = await resolveSignedInAccount(credential.user);

    if (!account) {
      await auth.signOut();
      throw new Error("This account is not assigned as a student or administrator.");
    }

    return account;
  }

  async function restoreAccountSession() {
    await init();

    if (demoMode || !auth) return null;

    const currentUser = await new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      });
    });

    if (!currentUser) return null;

    return await resolveSignedInAccount(currentUser);
  }

  async function signInStudent(studentId, password) {
    await init();

    if (demoMode) {
      cache.profile = Object.assign({}, window.G10_DEMO.profile, {
        studentId: studentId || window.G10_DEMO.profile.studentId
      });
      return cache.profile;
    }

    const account = await signInAccount(studentId, password);

    if (account.role !== "student" || !account.profile) {
      await auth.signOut();
      throw new Error("This is an administrator account. Use the main login page.");
    }

    return account.profile;
  }


  async function restoreStudentSession() {
    const account = await restoreAccountSession();
    return account && account.role === "student"
      ? account.profile
      : null;
  }

  async function restoreAdminSession() {
    const account = await restoreAccountSession();
    return account && account.role === "admin"
      ? account.admin
      : null;
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


  async function loadPublishedForSection(collectionName, term, section) {
    const feedCollection = collectionName === "activities"
      ? "activityFeeds"
      : "lessonFeeds";

    const cleanSection = String(section || "").trim();

    const globalPromise = db.collection(feedCollection)
      .doc("ALL_SECTIONS")
      .collection("items")
      .get();

    const sectionPromise = cleanSection
      ? db.collection(feedCollection)
          .doc(cleanSection)
          .collection("items")
          .get()
      : Promise.resolve(null);

    const results = await Promise.allSettled([globalPromise, sectionPromise]);
    const docsById = new Map();
    let successfulQueries = 0;
    let firstError = null;

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (!result.value) continue;
        successfulQueries++;

        result.value.docs.forEach(doc => {
          const item = { id: doc.id, ...doc.data() };

          // Feeds contain only relevant-section metadata. Filter the selected
          // term locally so the query needs no composite index and no
          // field-based Security Rules.
          if (Number(item.term) !== Number(term)) return;
          if (item.published !== true) return;

          docsById.set(doc.id, item);
        });
      } else if (!firstError) {
        firstError = result.reason;
      }
    }

    if (successfulQueries > 0) {
      return Array.from(docsById.values());
    }

    throw firstError || new Error("Could not load published materials.");
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
      rows = await loadPublishedForSection("lessons", term, section);
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
      rows = await loadPublishedForSection("activities", term, section);
    }

    rows.sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999));
    cache.activities[key] = rows;
    return rows;
  }


  function firestoreTimestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  async function loadAnnouncementFeed(section) {
    const cleanSection = String(section || "").trim();
    const now = firebase.firestore.Timestamp.now();

    const queryFor = sectionKey => db
      .collection("announcementFeeds")
      .doc(sectionKey)
      .collection("items")
      .where("publishAt", "<=", now)
      .get();

    const globalPromise = queryFor("ALL_SECTIONS");
    const sectionPromise = cleanSection
      ? queryFor(cleanSection)
      : Promise.resolve(null);

    const results = await Promise.allSettled([globalPromise, sectionPromise]);
    const docsById = new Map();
    let successfulQueries = 0;
    let firstError = null;

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (!result.value) continue;
        successfulQueries++;

        result.value.docs.forEach(doc => {
          const item = { id: doc.id, ...doc.data() };
          docsById.set(doc.id, item);
        });
      } else if (!firstError) {
        firstError = result.reason;
      }
    }

    if (!successfulQueries) {
      throw firstError || new Error("Could not load announcements.");
    }

    return Array.from(docsById.values())
      .sort((a, b) => {
        const pinDiff = Number(b.pinned === true) - Number(a.pinned === true);
        if (pinDiff !== 0) return pinDiff;

        return firestoreTimestampMillis(b.publishAt) -
          firestoreTimestampMillis(a.publishAt);
      });
  }

  async function getAnnouncements(section, force = false) {
    await init();
    const key = String(section || "").trim() || "ALL";

    if (!force && cache.announcements[key]) {
      return cache.announcements[key];
    }

    if (demoMode) {
      cache.announcements[key] = [];
      return [];
    }

    const rows = await loadAnnouncementFeed(section);
    cache.announcements[key] = rows;
    return rows;
  }

  async function getAnnouncementReadIds() {
    await init();

    if (demoMode || !auth?.currentUser) return [];

    const snap = await db
      .collection("announcementReads")
      .doc(auth.currentUser.uid)
      .collection("items")
      .get();

    return snap.docs.map(doc => doc.id);
  }

  async function markAnnouncementsRead(announcements) {
    await init();

    if (demoMode || !auth?.currentUser) return;

    const rows = Array.isArray(announcements) ? announcements : [];
    if (!rows.length) return;

    const uid = auth.currentUser.uid;

    for (let i = 0; i < rows.length; i += 350) {
      const batch = db.batch();

      rows.slice(i, i + 350).forEach(post => {
        const announcementId = String(post?.id || "").trim();
        if (!announcementId) return;

        batch.set(
          db.collection("announcementReads")
            .doc(uid)
            .collection("items")
            .doc(announcementId),
          {
            announcementId,
            readAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });

      await batch.commit();
    }
  }

  async function getAnnouncementHeartStates(announcementIds) {
    await init();

    const ids = Array.from(new Set(
      (Array.isArray(announcementIds) ? announcementIds : [])
        .map(value => String(value || "").trim())
        .filter(Boolean)
    ));

    if (!ids.length) return {};

    if (demoMode || !auth?.currentUser) {
      return Object.fromEntries(ids.map(id => [id, false]));
    }

    const uid = auth.currentUser.uid;
    const results = await Promise.all(ids.map(async announcementId => {
      try {
        const snap = await db
          .collection("announcementHearts")
          .doc(announcementId)
          .collection("hearts")
          .doc(uid)
          .get();

        return [announcementId, snap.exists];
      } catch (_) {
        return [announcementId, false];
      }
    }));

    return Object.fromEntries(results);
  }

  async function toggleAnnouncementHeart(announcement) {
    await init();

    if (demoMode) {
      throw new Error("Heart reactions require the live Firebase portal.");
    }

    if (!auth?.currentUser || !cache.profile) {
      throw new Error("Your student session expired. Please sign in again.");
    }

    const announcementId = String(announcement?.id || "").trim();
    if (!announcementId) {
      throw new Error("Announcement ID is missing.");
    }

    const uid = auth.currentUser.uid;
    const heartRef = db
      .collection("announcementHearts")
      .doc(announcementId)
      .collection("hearts")
      .doc(uid);

    const existing = await heartRef.get();

    if (existing.exists) {
      await heartRef.delete();
      return false;
    }

    const profileData = cache.profile || {};
    const notificationId = `${announcementId}__${uid}`;
    const notificationRef = db
      .collection("adminNotifications")
      .doc(notificationId);

    const batch = db.batch();

    batch.set(heartRef, {
      announcementId,
      studentUid: uid,
      studentId: String(profileData.studentId || ""),
      fullName: String(profileData.fullName || profileData.studentId || "Student"),
      section: String(profileData.section || ""),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    batch.set(notificationRef, {
      type: "announcement-heart",
      announcementId,
      announcementTitle: String(announcement?.title || "Announcement"),
      studentUid: uid,
      studentId: String(profileData.studentId || ""),
      fullName: String(profileData.fullName || profileData.studentId || "Student"),
      section: String(profileData.section || ""),
      seen: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();
    return true;
  }

  async function getCompliance(studentId, term, force = false) {
    await init();

    const normalizedId = normalizeStudentId(studentId);
    if (!normalizedId) {
      return {
        term: Number(term),
        lastUpdated: null,
        tasks: [],
        summary: { complete: 0, missing: 0, total: 0 }
      };
    }

    const key = `${normalizedId}|${term}`;
    if (!force && cache.compliance[key]) return cache.compliance[key];

    if (demoMode) {
      const result = { ...window.G10_DEMO.compliance, term: Number(term) };
      cache.compliance[key] = result;
      return result;
    }

    const ref = db
      .collection("studentCompliance")
      .doc(normalizedId)
      .collection("terms")
      .doc(`term${Number(term)}`);

    let snap;

    // Compliance is a published teacher snapshot, so prefer a fresh server
    // read. If the network is unavailable, Firestore may still use its
    // regular local cache as a fallback.
    try {
      snap = await ref.get({ source: "server" });
    } catch (serverError) {
      snap = await ref.get();
    }

    const result = snap.exists
      ? snap.data()
      : {
          term: Number(term),
          lastUpdated: null,
          tasks: [],
          summary: { complete: 0, missing: 0, total: 0 }
        };

    cache.compliance[key] = result;
    return result;
  }


  function clearPageCache(type) {
    if (type === "lessons") cache.lessons = {};
    if (type === "activities") cache.activities = {};
    if (type === "announcements") cache.announcements = {};
    if (type === "compliance") cache.compliance = {};
    if (type === "settings") cache.settings = null;
  }

  function clearAllCache() {
    cache.settings = null;
    cache.profile = null;
    cache.lessons = {};
    cache.activities = {};
    cache.announcements = {};
    cache.compliance = {};
  }


  async function changeStudentPassword(newPassword) {
    await init();

    if (demoMode) {
      cache.profile = { ...(cache.profile || {}), mustChangePassword: false };
      return cache.profile;
    }

    if (!auth || !auth.currentUser) {
      throw new Error("Your login session expired. Please sign in again.");
    }

    const password = String(newPassword || "");
    if (password.length < 6) {
      throw new Error("New password must contain at least 6 characters.");
    }

    await auth.currentUser.updatePassword(password);

    await db.collection("students").doc(auth.currentUser.uid).update({
      mustChangePassword: false,
      passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    cache.profile = {
      ...(cache.profile || {}),
      uid: auth.currentUser.uid,
      mustChangePassword: false
    };

    return cache.profile;
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
    const account = await signInAccount(email, password);

    if (account.role !== "admin" || !account.admin) {
      if (!demoMode && auth) await auth.signOut();
      throw new Error("This Firebase account is not authorized as an administrator.");
    }

    return account.admin;
  }


  function getFirebaseHandles() {
    return { firebaseApp, auth, db, demoMode };
  }

  window.G10DataService = {
    init,
    isDemo: () => demoMode,
    signInAccount,
    signInStudent,
    restoreAccountSession,
    restoreStudentSession,
    restoreAdminSession,
    getSettings,
    getLessons,
    getActivities,
    getAnnouncements,
    getAnnouncementReadIds,
    markAnnouncementsRead,
    getAnnouncementHeartStates,
    toggleAnnouncementHeart,
    getCompliance,
    clearPageCache,
    clearAllCache,
    changeStudentPassword,
    logout,
    drivePreviewUrl,
    driveImageUrl,
    extractDriveFileId,
    normalizeStudentId,
    studentIdToEmail,
    signInAdmin,
    getFirebaseHandles
  };
})();
