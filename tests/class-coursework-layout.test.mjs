import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const [setup, coursework, auth] = await Promise.all(["class-setup.css", "class-coursework.css", "auth.css"].map((name) => readFile(new URL(`../app/${name}`, import.meta.url), "utf8")));

test("every wizard step uses bounded content scrolling without shrinking its header or footer", () => {
  for (const step of ["", "class-setup-schedule-step", "class-setup-coursework-step", "class-setup-customize-step"]) {
    for (const css of [`${auth}\n${setup}`, `${setup}\n${auth}`]) {
      const dom = new JSDOM(`<style>${css}</style><div class="modal-backdrop"><form class="academic-editor class-setup ${step}"><header class="class-setup-header"></header><fieldset class="class-setup-body"></fieldset><footer class="class-setup-actions"></footer></form></div>`);
      try {
        const style = (selector) => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
        assert.equal(style("form").display, "flex");
        assert.equal(style("form").overflow, "hidden");
        assert.equal(style("fieldset").minHeight, "0px");
        assert.equal(style("fieldset").overflowY, "auto");
        assert.equal(style("fieldset").alignContent, "start");
        assert.equal(style("header").flexShrink, "0");
        assert.equal(style("footer").flexShrink, "0");
      } finally { dom.window.close(); }
    }
  }
});

test("Coursework matches Schedule sizing and resists generic editor style collisions", () => {
  for (const css of [`${auth}\n${setup}\n${coursework}`, `${coursework}\n${setup}\n${auth}`]) {
    const dom = new JSDOM(`<style>${css}</style><form class="academic-editor class-setup"><div class="class-setup-schedule"></div><section class="class-coursework"><aside class="class-coursework-rail"><div class="class-coursework-category-list"></div><button class="class-coursework-add"></button></aside><div class="class-coursework-main"><div class="class-coursework-editor"><label>Title<input></label><label>Description<textarea></textarea></label><div class="class-coursework-completion"><label class="class-coursework-grade-check"><input type="checkbox">Grade received</label></div></div></div></section></form>`);
    try {
      const style = (selector) => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
      assert.equal(style(".class-coursework").gridTemplateColumns, style(".class-setup-schedule").gridTemplateColumns);
      assert.equal(style(".class-coursework-category-list").overflowY, "auto");
      assert.equal(style(".class-coursework-add").minHeight, "46px");
      assert.equal(style(".class-coursework-editor").gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
      assert.equal(style(".class-coursework-editor > label").margin, "0px");
      assert.equal(style("input").boxSizing, "border-box");
      assert.equal(style("input").minWidth, "0px");
      assert.equal(style("textarea").resize, "vertical");
      assert.equal(style(".class-coursework-grade-check").flexDirection, "row");
      assert.equal(style(".class-coursework-completion").flexWrap, "wrap");
    } finally { dom.window.close(); }
  }
});

test("narrow layouts stack editors, reserve the footer, and wrap expanded skip dates", () => {
  const dom = new JSDOM(`<style>${setup}\n${coursework}</style>`);
  try {
    const rules = [...dom.window.document.styleSheets[0].cssRules].filter((rule) => rule.conditionText);
    const mobileRule = (selector) => rules.filter((rule) => rule.conditionText === "(max-width: 560px)").flatMap((rule) => [...rule.cssRules]).find((rule) => rule.selectorText?.split(", ").includes(selector))?.style;
    assert.equal(mobileRule(".modal-backdrop:has(> .class-setup)").padding, "12px");
    assert.equal(mobileRule(".class-coursework-editor").getPropertyValue("grid-template-columns"), "minmax(0, 1fr)");
    assert.equal(mobileRule(".class-setup-skip-content").getPropertyValue("flex-wrap"), "wrap");
    assert.equal(mobileRule(".class-setup.academic-editor .class-setup-skip-date-fallback").getPropertyValue("max-width"), "100%");
    const tablet = rules.filter((rule) => rule.conditionText === "(max-width: 760px)").flatMap((rule) => [...rule.cssRules]);
    assert.ok(tablet.some((rule) => rule.selectorText === '.class-setup-progress li:not([aria-current="step"]) .class-setup-step-label' && rule.style.display === "none"));
    assert.ok(tablet.some((rule) => rule.selectorText === ".class-coursework" && rule.style.getPropertyValue("grid-template-columns") === "minmax(0, 1fr)"));
  } finally { dom.window.close(); }
});
