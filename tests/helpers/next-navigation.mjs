import { useEffect, useState } from "react";

export function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPathname);
    return () => window.removeEventListener("popstate", syncPathname);
  }, []);
  return pathname;
}

export function useRouter() {
  return {
    push(href) {
      window.history.pushState({}, "", String(href));
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    },
    replace(href) {
      window.history.replaceState({}, "", String(href));
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    },
  };
}
