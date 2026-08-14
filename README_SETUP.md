# Grade 10 Arduino Hub — Free / No-NPM Setup

This starter is intentionally plain HTML + CSS + JavaScript.

- No npm
- No Node.js setup
- No build command
- No Firebase Storage
- Google Drive stores lesson/activity files
- Firestore stores small fast application metadata
- Apps Script is used only for teacher-side Google Sheets / Drive operations
- Local `file://` opening automatically uses Demo Mode

---

## 1. Test the UI locally first

1. Extract the ZIP.
2. Open the folder.
3. Double-click `index.html`.
4. Because the page is running through `file://`, it automatically enters **LOCAL DEMO MODE**.
5. Click **OPEN LOCAL DEMO**.
6. Test Dashboard, Lessons, Activities, Compliance, responsive/mobile resizing, and the viewer.

The demo intentionally has no real Drive file IDs, so clicking a lesson/activity shows the viewer shell without downloading anything.

---

## 2. Firebase project already configured in the files

`firebase-config.js` contains the current Firebase Web configuration for project:

`g10proj`

The web config itself is not a secret. Security must come from Firebase Authentication and Firestore Security Rules.

---

## 3. Enable Firebase Authentication

Firebase Console:

1. Open project `g10proj`.
2. Go to **Authentication**.
3. Open **Sign-in method**.
4. Enable **Email/Password**.
5. Save.

The app lets students type only their Student ID. Internally:

`2026-10001` → `2026-10001@g10proj.student`

The default starter password used by the Admin create-student form is `123456` because Firebase password accounts require at least 6 characters by default. You may change this policy later.

---

## 4. Create Firestore

Firebase Console:

1. Open **Firestore Database**.
2. Click **Create database**.
3. Choose a region appropriate for your users.
4. Create the database.
5. Open the **Rules** tab.
6. Copy the entire contents of `firestore.rules`.
7. Publish the rules.

Do **not** use broad test-mode rules for the finished app.

---

## 5. Create the two Firestore query indexes

The live student app queries only:

- the selected term
- `published == true`
- the student's own section (or `*` for all sections)

That keeps unrelated section metadata out of the student's query.

In Firebase Console → Firestore → **Indexes**, create these two composite/manual indexes:

### Lessons index

```text
Collection ID: lessons
Query scope: Collection
term: Ascending
published: Ascending
allowedSections: Array contains
```

### Activities index

```text
Collection ID: activities
Query scope: Collection
term: Ascending
published: Ascending
allowedSections: Array contains
```

The same definitions are also included in `firestore.indexes.json`.

If Firebase shows an index-required error while testing, it normally includes a direct link to create the missing index.

---

## 6. Create your first Admin account

The first admin is a one-time manual bootstrap.

### A. Create the Firebase Auth user

1. Firebase Console → Authentication → Users.
2. Click **Add user**.
3. Use your real/admin email.
4. Create a password.
5. Copy the generated **UID**.

### B. Mark the UID as an admin

1. Firestore Database → Data.
2. Start collection:
   - Collection ID: `admins`
3. Document ID:
   - paste the Firebase Auth UID
4. Add fields:
   - `name` → string → your name
   - `role` → string → `admin`

Example:

```text
admins/
  YOUR_ADMIN_UID
    name: "Teacher Admin"
    role: "admin"
```

The security rules use the existence of this document to decide whether the signed-in Firebase user is an admin.

---

## 7. Put the project on GitHub Pages

The student UI can be previewed by double-clicking `index.html`, but **live Firebase Admin mode should be opened from HTTPS**.

1. Create a new GitHub repository.
2. Upload all files/folders from this starter.
3. Commit.
4. Repository → **Settings** → **Pages**.
5. Source: **Deploy from a branch**.
6. Branch: `main`, folder `/root`.
7. Save.
8. Open the GitHub Pages URL.

There is no npm/build/deploy script.

---

## 8. Test Admin

Open:

`YOUR-GITHUB-PAGES-URL/admin.html`

1. Sign in using the Firebase admin email/password.
2. Open **Students**.
3. Create a test student:
   - Student ID
   - Full name
   - Section
   - initial password, default `123456`
4. Return to the student portal.
5. Log in using Student ID + password.

### Important about student-account creation

The Admin page creates the Firebase Authentication user through Firebase's official Auth REST API, then writes the profile to Firestore.

A random person may technically create an Auth-only account if Email/Password signup is enabled, but Firestore rules still prevent that Auth-only account from seeing student data because there is no matching `students/{uid}` profile and no admin document.

---

## 9. Add Lessons and Activities

### Simplest method first: upload to Drive manually

1. Upload PDF/image/file to Google Drive.
2. Share it:
   - **Anyone with the link**
   - **Viewer**
3. Copy the Drive share URL.
4. Admin → Lessons or Activities.
5. Paste the Drive URL into:
   - `Google Drive File ID or URL`
6. Add title, description, term, order, allowed sections.
7. Save.

Only the Drive File ID is stored in Firestore.

The student list page loads only metadata. The actual Drive file is loaded only after **VIEW LESSON** / **VIEW ACTIVITY** is clicked.

---

## 10. Configure Google Apps Script Bridge

This is optional for the first Firebase test, but needed for:

- upload-to-Drive directly from Admin
- Google Sheets compliance preview/sync

### A. Create Apps Script

1. Go to Google Apps Script.
2. New project.
3. Replace `Code.gs` with:
   - `apps-script/Code.gs`
4. In Project Settings, enable showing the manifest file if you want to use the supplied:
   - `apps-script/appsscript.json`

### B. Script Properties

Apps Script → Project Settings → Script Properties.

Add:

```text
COMPLIANCE_SPREADSHEET_ID = YOUR_GOOGLE_SHEET_FILE_ID
```

`ROOT_FOLDER_ID`, `LESSONS_FOLDER_ID`, and `ACTIVITIES_FOLDER_ID` are created/stored automatically when needed.

### C. Deploy as Web App

1. Deploy → New deployment.
2. Type → Web app.
3. Execute as → Me.
4. Who has access → Anyone.
5. Deploy.
6. Copy the Web App URL.
7. Open `firebase-config.js`.
8. Paste it here:

```js
appsScriptUrl: "PASTE_WEB_APP_URL_HERE"
```

Then commit/upload the changed `firebase-config.js` to GitHub.

---

## 11. Compliance sync is intentionally not inventing your grading rules

The supplied performance architecture says:

- Apps Script reads Google Sheets once in a batch.
- Match Student IDs.
- Calculate percentages/status.
- Create normalized student-safe results.
- Publish to Firestore.

However, the supplied architecture did **not** define:

- the exact Google Sheet headers
- which columns are the tasks
- each maximum score
- your official compliance percentage thresholds/colors

Therefore `apps-script/Code.gs` intentionally has an unconfigured:

```js
const COMPLIANCE_SCHEMA = { ... }
```

Until you fill that with your actual sheet/rubric rules:

- **PREVIEW SYNC** can still prove the Sheet was read in one batch.
- **PUBLISH** stays disabled.
- No fake grade/status is invented.

This is safer than guessing.

---

## 12. Firestore data model used by this starter

```text
admins/{adminUid}

students/{studentUid}

settings/main

lessons/{lessonId}

activities/{activityId}

studentCompliance/{studentUid}/terms/term1
studentCompliance/{studentUid}/terms/term2
studentCompliance/{studentUid}/terms/term3
```

A student's Term 1 Compliance page therefore needs approximately one main compliance document read.

---

## 13. Performance behavior already implemented

### Login

```text
Firebase Auth
→ students/{uid}
→ settings/main
→ Dashboard
```

It does not load all lessons, activities, compliance, sections, or students.

### Lessons

```text
Open Lessons
→ Firestore lesson metadata only
→ cards appear

Click View Lesson
→ selected Google Drive file opens
```

### Activities

Same pattern as Lessons.

### Compliance

```text
Open Compliance
→ studentCompliance/{ownUid}/terms/termN
→ display published snapshot
```

No Google Sheet and no Apps Script request occurs on the student Compliance page.

### Cache

The current browser session reuses previously loaded Lesson / Activity / Compliance data unless:

- the user clicks Refresh
- the user logs out
- the term changes

---

## 14. Important limits / intentional choices

### Local double-click mode

`file://` always uses Demo Mode. This is deliberate so the app can be visually tested by simply opening `index.html`.

Use GitHub Pages/HTTPS when testing real Firebase Authentication and Admin.

### Drive files

Learning materials can be **Anyone with the link — Viewer** for simple, free direct file delivery.

Do not put private compliance data, student data, or Google Sheet links in Drive files intended for public-link viewing.

### Admin password reset

This starter does not fake an admin-controlled password reset. Firebase client-side web code cannot securely change another user's password as an administrator without a privileged backend/admin mechanism.

For now, handle forgotten student passwords through Firebase Console Authentication. A proper admin-reset workflow can be added later without breaking the student-side architecture.

### Apps Script → Firestore publishing detail

To keep setup free and simple without storing a Firebase service-account credential in Apps Script, this starter uses:

```text
Apps Script
→ reads/processes Sheet
→ returns PREVIEW to authenticated Admin browser
→ Admin browser writes normalized snapshots to Firestore
```

This slightly changes only the final teacher-side publish hop.

The student-facing architecture remains exactly the important part:

```text
Student → Firestore directly
```

If a strict `Apps Script → Firestore` server-side publish is required later, it can be added separately after the Sheet mapping is known.

---

## 15. Files you will normally edit

```text
firebase-config.js
apps-script/Code.gs
firestore.rules
```

Most UI changes are:

```text
index.html
styles.css
app.js
admin.html
admin.js
```

There is no package manager anywhere in this project.


---

## Compliance: Missing Requirements list

The student Compliance page now has two parts:

1. **MGA KULANG / MISSING REQUIREMENTS**
   - shows only requirements that still need attention
   - shows a missing count
   - shows an optional reason such as `No submission recorded yet`
   - if there are none, it clearly says `Complete — No missing requirements`

2. **ALL REQUIREMENTS**
   - still shows the full published compliance status list

For the cleanest real sync result, each normalized task may include:

```js
{
  taskId: "mini-peta-2",
  displayName: "Mini PETA 2",
  status: "missing",
  percentageBand: "red",
  missing: true,
  missingReason: "No submission recorded yet."
}
```

For completed/submitted tasks, use:

```js
missing: false
```

This explicit flag is preferred because a red/low score does not always mean a submission is missing.


---

# v3 SECURITY UPDATE — IMPORTANT

The Google Apps Script bridge is now protected by the signed-in Firebase Admin account.

For every Admin upload or Compliance Preview:

```text
Admin signs in with Firebase
→ browser gets a fresh Firebase ID token
→ token is sent with the Apps Script request
→ Apps Script validates the token with Firebase Authentication
→ Apps Script checks /admins/{uid} through Firestore REST
→ Firestore Security Rules decide whether that Firebase user is an admin
→ only then does Drive/Sheets work run
```

This means copying the Apps Script Web App URL alone is not enough to perform the privileged actions.

The Apps Script Web App can still be deployed as **Execute as: Me / Who has access: Anyone** because the application itself performs the Firebase-admin authorization check before any Drive or Sheets operation.

Do not remove `authenticateAdmin_()` from `Code.gs`.

## After replacing Code.gs

Whenever you change Apps Script code:

1. Apps Script → **Deploy**
2. **Manage deployments**
3. Edit the current Web App deployment
4. Choose **New version**
5. Deploy
6. Keep/copy the `/exec` Web App URL into `firebase-config.js`

If you create a completely new deployment, its URL may change.

## Current security boundary

- Student Firestore reads are protected by Firebase Authentication + Firestore Rules.
- A student can read only their own student profile and own compliance document.
- Published Lessons/Activities are restricted by the student's section in Firestore Rules.
- Admin Firestore writes require a document at `admins/{adminUid}`.
- Apps Script Drive/Sheets operations also require the same authenticated admin.
- Google Drive lesson/activity files can use link-view sharing because they are normal learning materials.
- Do not put compliance records, roster data, passwords, or private Sheets in public-link Drive files.


---

# v4 — Bulk Student Import

Admin → Students now supports:

- Add one student manually
- Import many students from `.xlsx`, `.xls`, or `.csv`
- Preview rows before account creation
- Validate required values
- Detect duplicate Student IDs inside the uploaded file
- Use one initial password for the import batch
- Store Student ID, Name, Gender, and Section in each Firestore student profile
- Skip Authentication accounts that already exist instead of stopping the whole batch

Required spreadsheet headers:

```text
Student ID | Name | Gender | Section
```

Accepted Gender values:

```text
Male
Female
M
F
```

The app includes downloadable templates:

```text
G10_Student_Import_Template.xlsx
G10_Student_Import_Template.csv
```

Excel parsing uses SheetJS in the Admin page. CSV importing has a built-in parser and can still work if the Excel parser CDN is unavailable.


---

# v5 — Automatic Section Directory

The Admin Panel now automatically builds its Section list from the unique `section` values found in Firestore student profiles.

Example:

```text
students/
  uid1 → section: "GRADE 10 - ST. FAUSTINA"
  uid2 → section: "GRADE 10 - ST. FAUSTINA"
  uid3 → section: "GRADE 10 - ST. MAXIMILIAN KOLBE"
```

Admin dropdowns automatically show only:

```text
GRADE 10 - ST. FAUSTINA
GRADE 10 - ST. MAXIMILIAN KOLBE
```

No duplicate section names are shown.

The dynamic section list is used in:

- Add One Student
- Lesson Allowed Sections
- Activity Allowed Sections
- Student Profiles section filter
- Compliance Sync section/sheet selector

Bulk-imported students automatically update the Section Directory after import.

For Add One Student, an admin can still select `+ Add new section` if the section does not exist yet.

Lessons and Activities support:
- All Sections
- one section
- multiple selected sections

The Section Directory is derived from Firestore student profiles; no separate section database is required.
