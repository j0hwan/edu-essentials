/* eslint-disable react/prop-types -- Minimal Next.js Link stand-in used only by the client-module tests. */
import { createElement } from "react";

export default function Link({ href, onClick, children, ...props }) {
  return createElement("a", {
    ...props,
    href: String(href),
    onClick(event) {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      window.history.pushState({}, "", String(href));
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    },
  }, children);
}
