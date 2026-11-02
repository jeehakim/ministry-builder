// Applies the saved (or system) colour scheme before first paint, so dark mode does not flash.
// Served as a static file so the Content-Security-Policy needs no 'unsafe-inline' for scripts.
(function () {
  try {
    var t = localStorage.getItem("ministry.theme");
    var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();
