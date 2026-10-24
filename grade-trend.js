/* G10 grade direction helper: no previous grade value is exposed in student snapshots. */
(function (scope) {
  "use strict";

  function numericGrade(value, status, type) {
    if (String(status || "").trim().toUpperCase() === "INC" ||
        String(type || "").trim().toLowerCase() === "incomplete") return null;
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const grade = Number(value);
    return Number.isFinite(grade) && grade >= 0 && grade <= 100 ? grade : null;
  }

  function fromSheetRow(row, term, previousTermAvailable) {
    const selected = Number(term);
    if (selected <= 1 || selected > 3) return null;
    const result = { previousTerm: selected - 1, trend: "unavailable" };
    if (!previousTermAvailable || !row || !row.previousTermGradeFound) return result;

    const current = numericGrade(row.termGrade, row.gradeStatus, row.gradeType);
    const previous = numericGrade(row.previousTermGrade,
      row.previousTermGradeStatus, row.previousTermGradeType);
    if (current === null || previous === null) return result;

    result.trend = current > previous ? "improved"
      : current < previous ? "declined" : "unchanged";
    return result;
  }

  function forDisplay(record, term) {
    if (Number(term) <= 1 || !record) return null;
    const movement = record.gradeMovement;
    if (!movement || Number(movement.previousTerm) !== Number(term) - 1) return null;
    if (numericGrade(record.termGrade, record.gradeStatus, record.gradeType) === null) return null;
    const allowed = ["improved", "declined", "unchanged", "unavailable"];
    if (!allowed.includes(movement.trend)) return null;
    return movement.trend;
  }

  scope.G10GradeTrend = Object.freeze({ numericGrade, fromSheetRow, forDisplay });
})(typeof window === "undefined" ? globalThis : window);
