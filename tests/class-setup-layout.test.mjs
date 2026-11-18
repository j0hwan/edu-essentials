import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const setupCss = await readFile(new URL("../app/class-setup.css", import.meta.url), "utf8");
const authCss = await readFile(new URL("../app/auth.css", import.meta.url), "utf8");
const markup = '<form class="academic-editor class-setup class-setup-customize-step"><div class="class-setup-card-controls"></div><label class="class-setup-color"><input type="color"></label><div class="class-setup-zoom"><input type="range"></div><button class="class-setup-image-button"><span class="class-setup-image-affordance">Change image</span></button></form>';

test("inline name editors keep the same single-line box when their text is cleared", () => {
  for (const css of [`${setupCss}\n${authCss}`, `${authCss}\n${setupCss}`]) {
    const dom = new JSDOM(`<style>${css}</style><form class="academic-editor class-setup"><div class="class-setup-section-heading"><h3><span class="class-setup-meeting-title" contenteditable="plaintext-only">Labs</span></h3></div></form>`);
    try {
      const title = dom.window.document.querySelector(".class-setup-meeting-title");
      const initial = dom.window.getComputedStyle(title);
      title.replaceChildren();
      const empty = dom.window.getComputedStyle(title);
      assert.ok(Math.abs(parseFloat(empty.height) - parseFloat(empty.fontSize) * 1.45) < 0.01);
      assert.equal(empty.height, initial.height);
      assert.equal(empty.minHeight, initial.minHeight);
      assert.equal(empty.whiteSpace, "pre");
      assert.equal(empty.lineHeight, initial.lineHeight);
    } finally { dom.window.close(); }
  }
});

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

test("Change image is hidden immediately while dragging even when the preview is focused", () => {
  const dom = new JSDOM(`<style>${setupCss}</style>${markup}`);
  try {
    const button = dom.window.document.querySelector("button");
    const label = button.querySelector("span");
    button.classList.add("has-image");
    button.focus();
    assert.equal(dom.window.getComputedStyle(label).opacity, "1");
    button.dataset.dragging = "true";
    const dragging = dom.window.getComputedStyle(label);
    assert.equal(dragging.opacity, "0");
    assert.equal(dragging.visibility, "hidden");
    assert.equal(dragging.transition, "none");
    delete button.dataset.dragging;
    assert.equal(dom.window.getComputedStyle(label).opacity, "1");
    assert.equal(dom.window.getComputedStyle(label).visibility, "visible");
  } finally { dom.window.close(); }
});
