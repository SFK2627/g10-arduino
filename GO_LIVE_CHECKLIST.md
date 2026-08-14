# G10 Arduino Hub v3 — Go-Live Checklist

Follow this order. No npm, Node.js, terminal deployment, or paid Firebase plan is required for the starter.

## A. Firebase Authentication

- [ ] Firebase Console → project `g10proj`
- [ ] Authentication → Get started
- [ ] Sign-in method → Email/Password → Enable
- [ ] Create one teacher/admin Email/Password user
- [ ] Copy the teacher/admin UID

## B. Firestore Database

- [ ] Create Firestore Database
- [ ] Use the normal locked/production setup rather than leaving broad test rules
- [ ] Rules tab → paste `firestore.rules` → Publish
- [ ] Create collection `admins`
- [ ] Create document whose Document ID is the teacher/admin Firebase UID
- [ ] Add `name` = teacher name
- [ ] Add `role` = `admin`
- [ ] Create `settings/main` or let Admin Settings create it after sign-in

## C. Firestore indexes

Create the two composite indexes described in `README_SETUP.md` / `firestore.indexes.json`:

- [ ] `lessons`: term + published + allowedSections(Array contains)
- [ ] `activities`: term + published + allowedSections(Array contains)

## D. Put the static app online

- [ ] Upload the project files to a GitHub repository
- [ ] GitHub Settings → Pages
- [ ] Deploy from branch → main → root
- [ ] Open the generated HTTPS site
- [ ] Test `admin.html`
- [ ] Test `index.html`

Local double-click remains Demo Mode by design.

## E. First Admin test

- [ ] Open `admin.html` from the hosted site
- [ ] Sign in with the teacher Firebase account
- [ ] Save School Year / Current Term / Announcement
- [ ] Create 2 test student accounts
- [ ] Log in to `index.html` with those Student IDs
- [ ] Confirm each account sees only its own profile

## F. Google Apps Script bridge

- [ ] New Apps Script project
- [ ] Replace `Code.gs` with `apps-script/Code.gs`
- [ ] Add Script Property:
      `COMPLIANCE_SPREADSHEET_ID = <your Google Sheet file ID>`
- [ ] Deploy as Web App
- [ ] Execute as: Me
- [ ] Who has access: Anyone
- [ ] Copy the `/exec` URL
- [ ] Paste it into `firebase-config.js` → `appsScriptUrl`

The v3 bridge rejects Drive/Sheets actions unless the request carries a valid Firebase ID token belonging to a Firestore admin.

## G. Test Drive upload

- [ ] Admin → Lessons
- [ ] Choose a small PDF
- [ ] Save Lesson
- [ ] Confirm a file appears in Drive folder `G10-ARDUINO-HUB/lessons`
- [ ] Student → Lessons
- [ ] Confirm only metadata loads first
- [ ] Click VIEW LESSON
- [ ] Confirm the selected Drive PDF opens

Repeat for Activities.

## H. Compliance — still needs your real Sheet structure

Before real Compliance publishing, configure the exact `COMPLIANCE_SCHEMA` in `apps-script/Code.gs`.

We still need your actual:

- [ ] Google Sheet header row
- [ ] Student ID column name
- [ ] Student name column name
- [ ] Activity/task columns
- [ ] Maximum score for each task
- [ ] Which tasks are Practical Exam
- [ ] Exact compliance/status thresholds
- [ ] Exact definition of `missing`
- [ ] Exact colors/status names you want

Do not publish guessed grades.

After configured:

- [ ] Admin → Compliance Sync
- [ ] PREVIEW SYNC
- [ ] Check Student IDs and task results
- [ ] PUBLISH PREVIEW TO FIRESTORE
- [ ] Student → Compliance
- [ ] Check `MGA KULANG / MISSING REQUIREMENTS`
- [ ] Check the full Compliance list
- [ ] Confirm another student cannot read that student's compliance

## I. Production test before adding the whole class

Test with only 2–3 students first:

- [ ] Correct login
- [ ] Wrong password
- [ ] Logout/login
- [ ] Desktop
- [ ] Phone
- [ ] Tablet width
- [ ] Lesson filtering by section
- [ ] Activity filtering by section
- [ ] Drive PDF
- [ ] Drive image
- [ ] Compliance
- [ ] Missing Requirements
- [ ] Admin publish/unpublish
- [ ] Apps Script rejects a non-admin account

Only after all checks pass should the full roster be added.
