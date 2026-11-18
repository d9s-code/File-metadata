// Runs before first paint (loaded synchronously from index.html) so a stored
// light/dark choice and style don't flash the defaults first. A file rather
// than an inline script so the Content-Security-Policy can stay script-src 'self'.
(function () {
  var root = document.documentElement;
  // The style (src/theme/uiStyle.ts): Workbench unless another was picked.
  root.setAttribute("data-style", "workbench");
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      root.setAttribute("data-theme", stored);
    }
    // The size (src/theme/uiScale.ts): 100% unless another was picked.
    var scale = Number(localStorage.getItem("ui-scale"));
    if (scale === 0.8 || scale === 0.9 || scale === 1.1 || scale === 1.25) {
      root.style.setProperty("--ui-scale", String(scale));
    }
    var style = localStorage.getItem("ui-style");
    if (style === "workbench" || style === "instrument" || style === "classic") {
      root.setAttribute("data-style", style);
    }
  } catch {
    // localStorage unavailable — system preference (via prefers-color-scheme) still applies.
  }
})();
