import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readWorkspaceStylesheets } from "./helpers/workspace-presentation.mjs";

const workspaceStyles = await readWorkspaceStylesheets();
const stylesheet = (path) => {
  const match = workspaceStyles.sources.find((entry) => entry.path === path);
  assert.ok(match, `${path} is imported by the workspace presentation`);
  return match.source;
};
const dashboardCss = workspaceStyles.css;
const skeletonCss = stylesheet("app/courses-skeleton.css");
const referenceCss = stylesheet("app/reference-ui.css");

function gridRules(css, selector) {
  const dom = new JSDOM(`<style>${css}</style>`);
  try {
    const declarations = [];
    for (const rule of dom.window.document.styleSheets[0].cssRules) {
      const rules = rule.conditionText ? rule.cssRules : [rule];
      for (const nested of rules) {
        if (nested.selectorText !== selector) continue;
        const columns = nested.style.getPropertyValue("grid-template-columns");
        if (columns) declarations.push({ media: rule.conditionText ?? null, columns });
      }
    }
    return declarations;
  } finally {
    dom.window.close();
  }
}

test("course cards and placeholders keep viewport-based column counts during sidebar reflow", () => {
  const expected = [
    { media: null, columns: "repeat(4, minmax(0, 1fr))" },
    { media: "(max-width: 1279px)", columns: "repeat(3, minmax(0, 1fr))" },
    { media: "(max-width: 1023px)", columns: "repeat(2, minmax(0, 1fr))" },
    { media: "(max-width: 539px)", columns: "minmax(0, 1fr)" },
  ];
  assert.deepEqual(gridRules(dashboardCss, ".dashboard-page .class-grid"), expected);
  assert.deepEqual(gridRules(skeletonCss, ".courses-skeleton__cards"), expected);
});

test("desktop content animates both horizontal edges with the same shell timing", () => {
  const desktopStyles = referenceCss.slice(referenceCss.indexOf("@media (min-width: 821px)"));
  const contentRule = desktopStyles.match(/\.reference-ui \.main-content \{([^}]+)\}/)[1];
  assert.match(contentRule, /transition: margin-left var\(--shell-reflow-duration\) var\(--shell-reflow-easing\), padding-right var\(--shell-reflow-duration\) var\(--shell-reflow-easing\);/);
});
