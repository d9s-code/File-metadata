// Runs before first paint (loaded synchronously from index.html) so a stored
// light/dark choice doesn't flash the system theme first. A file rather than
// an inline script so the Content-Security-Policy can stay script-src 'self'.
(function () {
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch {
    // localStorage unavailable — system preference (via prefers-color-scheme) still applies.
  }
})();
