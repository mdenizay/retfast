// Applies the stored or system theme before first paint (kept as a file so CSP can forbid inline scripts).
try {
  var t = localStorage.getItem("rf-theme");
  if (t !== "light" && t !== "dark") t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
