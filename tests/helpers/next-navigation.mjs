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

export function useSearchParams() {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const syncSearch = () => setSearch(window.location.search);
    window.addEventListener("popstate", syncSearch);
    return () => window.removeEventListener("popstate", syncSearch);
  }, []);
  return new URLSearchParams(search);
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
