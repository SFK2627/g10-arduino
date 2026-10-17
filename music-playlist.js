/* Shared, dependency-free Login Reminder music playlist helpers.
   Tolerates URLs pasted directly against one another (without delimiters). */
(function (root) {
  "use strict";

  const MAX_TRACKS = 100;
  const MAX_URL_LENGTH = 2048;

  function validUrl(value) {
    if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) return false;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") &&
        Boolean(url.hostname) && !url.username && !url.password;
    } catch (_) {
      return false;
    }
  }

  function key(value) { return String(value || "").trim(); }

  function normalize(input) {
    const values = Array.isArray(input) ? input : (input ? [input] : []);
    const seen = new Set();
    const output = [];
    for (const candidate of values) {
      const value = key(candidate);
      if (!validUrl(value) || seen.has(value)) continue;
      seen.add(value);
      output.push(value);
      if (output.length >= MAX_TRACKS) break;
    }
    return output;
  }

  function extract(input) {
    const text = String(input || "");
    const starts = [];
    const scheme = /https?:\/\//gi;
    let match;
    while ((match = scheme.exec(text))) starts.push(match.index);

    const found = [];
    const invalid = [];
    const seen = new Set();
    let duplicates = 0;
    for (let i = 0; i < starts.length; i++) {
      // Stop precisely at the NEXT URL scheme even when zero spaces exist.
      const chunk = text.slice(starts[i], starts[i + 1] ?? text.length);
      // Conventional paste separators and surrounding prose are discarded.
      const firstToken = chunk.split(/[\s<>"'`|,;\\\[\]{}()]+/, 1)[0] || "";
      const candidate = firstToken.replace(/[.!?]+$/, "");
      if (!validUrl(candidate)) {
        invalid.push(candidate.slice(0, 120));
      } else if (seen.has(candidate)) {
        duplicates++;
      } else {
        seen.add(candidate);
        found.push(candidate);
      }
    }
    return { urls: found, duplicates, invalid, detected: starts.length };
  }

  function merge(existing, additions) {
    const start = normalize(existing);
    const seen = new Set(start);
    const added = [];
    let duplicates = 0;
    let excess = 0;
    for (const candidate of additions || []) {
      const value = key(candidate);
      if (!validUrl(value)) continue;
      if (seen.has(value)) { duplicates++; continue; }
      if (start.length >= MAX_TRACKS) { excess++; continue; }
      seen.add(value);
      start.push(value);
      added.push(value);
    }
    return { urls: start, added, duplicates, excess };
  }

  root.G10MusicPlaylist = { extract, normalize, merge, validUrl, MAX_TRACKS };
})(typeof window !== "undefined" ? window : globalThis);
