/* Grade 10 Admin-only section performance aggregation. Pure: no Firebase writes. */
(function (scope) {
  'use strict';
  const BANDS = [
    { key: 'white', label: 'White', min: 96, max: 100 },
    { key: 'green', label: 'Green', min: 91, max: 95.999999 },
    { key: 'yellow', label: 'Yellow', min: 86, max: 90.999999 },
    { key: 'gray', label: 'Gray', min: 81, max: 85.999999 },
    { key: 'orange', label: 'Orange', min: 75, max: 80.999999 },
    { key: 'red', label: 'Red', min: 0, max: 74.999999 }
  ];
  function numericGrade(record) {
    if (!record || String(record.gradeStatus || '').toUpperCase() === 'INC' ||
        String(record.gradeType || '').toLowerCase() === 'incomplete') return null;
    const raw = record.termGrade;
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const grade = Number(raw);
    return Number.isFinite(grade) && grade >= 0 && grade <= 100 ? grade : null;
  }
  function missingCount(record) {
    if (!record) return null;
    const raw = record.summary && record.summary.missing;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '' &&
        Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
    if (Array.isArray(record.tasks)) {
      return record.tasks.filter(t => t && (t.missing === true || String(t.status).toLowerCase() === 'missing')).length;
    }
    return null;
  }
  function band(grade) {
    if (grade === null || grade === undefined || !Number.isFinite(grade)) return 'unavailable';
    const match = BANDS.find(b => grade >= b.min && grade <= b.max);
    return match ? match.key : 'unavailable';
  }
  function summary(rows) {
    const graded = rows.filter(r => r.grade !== null);
    const published = rows.filter(r => r.published);
    const count = key => rows.filter(r => r.trend === key).length;
    const distribution = Object.fromEntries(BANDS.map(b => [b.key, graded.filter(r => r.band === b.key).length]));
    return {
      total: rows.length,
      published: published.length,
      notPublished: rows.length - published.length,
      graded: graded.length,
      noGrade: published.length - graded.length,
      missing: published.filter(r => r.missing !== null && r.missing > 0).length,
      complete: published.filter(r => r.missing === 0).length,
      unknownCompliance: published.filter(r => r.missing === null).length,
      improved: count('improved'), declined: count('declined'), unchanged: count('unchanged'),
      comparable: rows.filter(r => r.trend !== 'unavailable').length,
      average: graded.length ? graded.reduce((sum, r) => sum + r.grade, 0) / graded.length : null,
      distribution
    };
  }
  function build(students, snapshots, term) {
    const active = students.filter(s => s.active !== false).slice().sort((a, b) =>
      String(a.fullName || a.studentId || '').localeCompare(String(b.fullName || b.studentId || ''), undefined, { sensitivity: 'base' }));
    const rows = active.map(s => {
      const stored = snapshots.get(s.uid) || {};
      const now = stored.current || null;
      const first = Number(term) === 1 ? null : (stored.first || null);
      const grade = numericGrade(now);
      const previous = numericGrade(first);
      const delta = grade !== null && previous !== null ? Math.round((grade - previous) * 100) / 100 : null;
      const trend = delta === null ? 'unavailable' : delta > 0 ? 'improved' : delta < 0 ? 'declined' : 'unchanged';
      return {
        uid: s.uid,
        fullName: String(s.fullName || s.studentId || 'Unnamed student'),
        studentId: String(s.studentId || ''), section: String(s.section || 'Unassigned').trim() || 'Unassigned',
        published: Boolean(now), grade, previous, delta, trend,
        missing: missingCount(now), band: band(grade),
        gradeIncomplete: Boolean(now) && (String(now.gradeStatus || '').toUpperCase() === 'INC' ||
          String(now.gradeType || '').toLowerCase() === 'incomplete'),
        publishedAt: now && (now.publishedAt || now.lastUpdated || null),
        priority: Boolean(now) && (trend === 'declined' || missingCount(now) >= 2 || (grade !== null && grade < 75))
      };
    });
    const sections = Array.from(new Set(rows.map(r => r.section))).sort((a,b) => a.localeCompare(b))
      .map(name => ({ name, rows: rows.filter(r => r.section === name),
        stats: summary(rows.filter(r => r.section === name)) }));
    return { rows, sections, stats: summary(rows), term: Number(term) };
  }
  scope.G10PerformanceAnalytics = Object.freeze({ BANDS, band, numericGrade, missingCount, summary, build });
})(typeof window === 'undefined' ? globalThis : window);
