import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const setupCss = await readFile(new URL("../app/class-setup.css", import.meta.url), "utf8");
const authCss = await readFile(new URL("../app/auth.css", import.meta.url), "utf8");
const markup = '<form class="academic-editor class-setup class-setup-customize-step"><div class="class-setup-card-controls"></div><label class="class-setup-color"><input type="color"></label><div class="class-setup-zoom"><input type="range"></div><button class="class-setup-image-button"><span class="class-setup-image-affordance">Change image</span></button></form>';

test("the class color stays square regardless of generic editor stylesheet order", () => {
  for (const css of [`${setupCss}\n${authCss}`, `${authCss}\n${setupCss}`]) {
    const dom = new JSDOM(`<style>${css}</style>${markup}`);
    try {
      const color = dom.window.getComputedStyle(dom.window.document.querySelector('[type="color"]'));
      assert.equal(color.width, "44px");
      assert.equal(color.height, "44px");
      assert.equal(color.minWidth, color.maxWidth);
      assert.equal(color.minHeight, color.maxHeight);
      const zoom = dom.window.getComputedStyle(dom.window.document.querySelector('[type="range"]'));
      assert.equal(zoom.padding, "0px");
    } finally { dom.window.close(); }
  }
});

test("Change image is visible for an empty cover and hidden until hover or focus after upload", () => {
  const dom = new JSDOM(`<style>${setupCss}</style>${markup}`);
  try {
    const button = dom.window.document.querySelector("button");
    const label = button.querySelector("span");
    assert.equal(dom.window.getComputedStyle(label).opacity, "1");
    button.classList.add("has-image");
    assert.equal(dom.window.getComputedStyle(label).opacity, "0");
    button.classList.remove("has-image");
    assert.equal(dom.window.getComputedStyle(label).opacity, "1");
  } finally { dom.window.close(); }
});
