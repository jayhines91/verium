/*
 * Verium theme boot script.
 * Runs before React mounts to apply the persisted theme without a flash of
 * unstyled content. Keep this file self-contained (no imports, no exports);
 * the same constants are mirrored in src/lib/theme.ts.
 */
(function () {
  var STORAGE_KEY = "verium-theme-mode";
  var doc = document.documentElement;

  var mode;
  try {
    mode = window.localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    mode = null;
  }
  if (mode !== "light" && mode !== "dark" && mode !== "system") {
    mode = "system";
  }

  var resolved = mode;
  if (mode === "system") {
    var prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    resolved = prefersDark ? "dark" : "light";
  }

  if (resolved === "light") {
    doc.classList.add("light");
  } else {
    doc.classList.remove("light");
  }
  doc.classList.remove("dark");
})();
