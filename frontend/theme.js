// Applied before the app module to avoid a light flash on dark-theme reloads.
(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    preference =
      localStorage.getItem("site.theme.override") ||
      localStorage.getItem("site.theme") ||
      "system";
  } catch {}
  const apply = () => {
    const mode =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    window.dispatchEvent(new Event("themechange"));
  };
  window.setAppTheme = (value) => {
    preference = ["light", "dark", "system"].includes(value) ? value : "system";
    try {
      localStorage.setItem("site.theme", preference);
    } catch {}
    apply();
  };
  media.addEventListener("change", apply);
  apply();
})();
