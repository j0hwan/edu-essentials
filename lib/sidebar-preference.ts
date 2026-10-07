export const SIDEBAR_COLLAPSED_STORAGE_KEY = "edu-sidebar-collapsed";

export const SIDEBAR_COLLAPSED_BOOTSTRAP = `(()=>{
  try {
    const collapsed = window.localStorage.getItem("${SIDEBAR_COLLAPSED_STORAGE_KEY}");
    if (collapsed === "true" || collapsed === "false") {
      document.documentElement.setAttribute("data-sidebar-collapsed", collapsed);
    }
  } catch {}
})();`;
