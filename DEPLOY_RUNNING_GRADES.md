# MCSian ICT 10 — Running Grade + Raw PT/TA Scores Upgrade

## What changed

- Student Dashboard: current term's numeric grade, obtained from the **published** E-Class Record snapshot.
- Student Compliance: same grade, missing requirements, Written Work status, PT raw scores/HPS, and Term Assessment raw scores/HPS.
- Login reminder modal: term grade plus original completion/missing-requirement reminders and music settings.
- Admin Compliance Preview: Running Grade column; Admin View Scores modal: grade display.
- Apps Script: detects **TERM GRADE / AW**; uses its numeric value as the *recorded* term grade. If AW is blank and AV is numeric, the AV value is shown as *provisional*, not as a final grade. If AW says `INC`, it displays `INC` and does **not** fall back to AV. Blank grades remain unavailable.
- Term Assessment detector: reads all **10** TA slots (AH–AQ) and includes only slots with a positive HPS. WW/PT also have 10 slots each.
- Privacy: student-facing Written Works publish **only** basic task metadata and Completed/Missing status. No WW score, HPS, score percentage, score color band, or future unknown raw fields are published. Performance Task and Term Assessment scores remain visible to their own authenticated students.

## Modified web-app files

1. `index.html` — three grade cards, legend text.
2. `app.js` — grade presentation and PT/TA scores on student Compliance.
3. `admin.js` — safe data publishing, grade preview, 10 TA slots, Admin score viewer.
4. `styles.css` — grade card design with mobile breakpoints.
5. `demo-data.js` — sample grade and scores for **local Demo Mode only**.
6. `service-worker.js` — cache version bumped to prevent old PWA scripts from remaining installed.

The original remaining web-app files, icons, and configuration are retained.

The separate `G10_Arduino_RunningGrade_AppsScript.gs` is the full updated **Google Apps Script** backend. **Do not publish it as a frontend website file.**

## Deployment order

1. **Back up** the deployed web app and existing Google Apps Script first.
2. In your **existing** Google Apps Script project, replace its code with the complete updated `.gs` code. Save, then select **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**. Keep the existing web-app URL / deployment connection; authorize required Google services if prompted.
3. Deploy the updated web-app files on the existing web host. Upload/replace all six modified frontend files together. If your host deploys from a ZIP, use the full updated web-app ZIP.
4. No Firestore Security Rules change is needed for this upgrade: the existing `studentCompliance` ownership rules and admin-only `adminCompliance` rules remain in place.
5. In the **Admin Panel**, set the global current term to whichever term you want students to see immediately after login (e.g., **Term 2** after the midterm). Verify the login reminder is enabled if you want the modal to display automatically.
6. In **Compliance Sync**, select the same term and confirm each section's correct Google Sheet URL is configured. Click **Preview Checked Sections**. Verify each student's **Running Grade** against the sheet. Verify any `INC` entry and provisional grade status before publishing.
7. Click **Sync Checked Sections & Publish**. This is mandatory — deploying code alone does not create the new published grade fields or reveal PT raw scores in old snapshots.
8. **Re-publish every previously published term** that students should still be able to view, especially Term 1. This also replaces legacy WW snapshots that previously contained percentage-related fields. Never rely on the UI alone to hide those fields in old Firestore documents.
9. Log in as an authorized **test student**, check the selected term's login modal, Dashboard, and Compliance. Verify WW only shows Completed/Missing, PT/TA show exact score/HPS, and grade matches AW (or explicitly provisional AV). Check desktop and mobile.
10. If using an installed PWA, reload while online so the new `service-worker.js` cache takes effect.

## Important data rules

- AW (`TERM GRADE`) = recorded numeric grade or a nonnumeric status such as `INC`.
- AV = provisional computed/transmuted grade, used only when AW is blank.
- No browser calculation of grades, and no student access to the Google Sheet URL.
- Sheets must have active tasks (positive HPS) for the existing preview/publish process to produce student rows. In the supplied Immaculate Conception sample workbook, TERM_2 and TERM_3 have no active HPS/tasks, so they will not publish records until those tabs contain data.
- Blank recorded score means **Missing**; recorded numeric zero means **Completed** with raw score `0 / HPS`.
- Grade data updates only after the admin runs a new Compliance Sync & Publish, not automatically on each Google Sheet edit.
- For a configured email-only admin account, the Google Apps Script bridge still requires the matching `/admins/{uid}` Firestore document, as in the original backend. This upgrade does not alter authentication.

## Verification performed

- Syntax checks: all changed JavaScript files and the reconstructed Apps Script backend passed `node --check`.
- Real sample workbook parser: detected HPS row, AW grade column, 10 TA slots; verified term grades and `INC` values from TERM_1.
- Student snapshot privacy tests: no WW raw values or unknown sensitive fields; PT and TA score/HPS retained.
- Grade display tests: recorded, provisional, `INC`, missing, and zero values.
- HTML IDs checked for duplication.

**Not performed:** live authentication against your Firebase project, deployment to your Google Apps Script project, and live browser validation against real student accounts. Those require your own deployed environment.
