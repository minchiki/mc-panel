// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
try {
  var theme = localStorage.getItem("mcp-theme");
  if (theme === "light") document.documentElement.classList.remove("dark");
} catch (e) {
  /* storage unavailable: keep dark default */
}
