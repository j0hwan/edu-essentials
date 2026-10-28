import assert from "node:assert/strict";
import test from "node:test";
import postcss from "postcss";
import { readWorkspacePresentationSource, readWorkspaceStylesheets, workspacePresentationModules } from "./helpers/workspace-presentation.mjs";

test("shared fallback rules preserve their competing feature declarations", async () => {
  const { css } = await readWorkspaceStylesheets();
  const rules = [];
  postcss.parse(css).walkRules((rule) => rules.push(rule));
  const fallbackDeclaration = (selectors, property) => rules
    .filter((rule) => rule.parent.type === "root")
    .filter((rule) => selectors.includes(rule.selector))
    .flatMap((rule) => rule.nodes.filter((node) => node.type === "decl" && node.prop === property))
    .at(-1)?.value;

  assert.equal(fallbackDeclaration([".popover", ".widget-menu"], "min-width"), "min(178px, var(--widget-menu-available-width, calc(100vw - 24px)))");
  assert.equal(fallbackDeclaration([".modal-backdrop", ".side-panel-backdrop"], "place-items"), "stretch end");
  assert.equal(fallbackDeclaration([".modal-backdrop", ".side-panel-backdrop"], "padding"), "0");
});

test("workspace presentation modules keep explicit feature boundaries", async () => {
  const owners = [
    "navigation",
    "dashboard",
    "courseDetail",
    "courseVisual",
    "assignmentTable",
    "assignmentDetailDialog",
    "academicDialogs",
    "fileDialogs",
    "files",
    "search",
    "settings",
    "home",
    "widget",
    "widgetCatalog",
  ];

  for (const owner of owners) {
    const source = await readWorkspacePresentationSource(owner);
    assert.ok(source.trim(), `${workspacePresentationModules[owner]} has a feature implementation`);
    assert.doesNotMatch(source, /from\s+["']\.\/workspace-client(?:\.[jt]sx?)?["']/, `${workspacePresentationModules[owner]} does not depend on the coordinator`);
  }
});

test("extracted workspace styles stay in the ordered feature import list", async () => {
  const { paths } = await readWorkspaceStylesheets();
  const orderedFeatureStyles = [
    "app/workspace-shell.css",
    "app/workspace-search.css",
    "app/workspace-home.css",
    "app/workspace-widget.css",
    "app/workspace-dashboard.css",
    "app/course-visual.css",
    "app/assignment-table.css",
    "app/workspace-files.css",
    "app/workspace-settings.css",
    "app/course-detail.css",
  ];
  const orderedExistingStyles = [
    "app/location-input.css",
    "app/course-icon-picker.css",
    "app/class-setup.css",
    "app/course-syllabus.css",
    "app/course-syllabus-upload.css",
    "app/calendar.css",
    "app/local-file-preview.css",
    "app/file-upload-dialog.css",
    "app/file-organization-dialogs.css",
    "app/files-trash-dialog.css",
    "app/files-browser-tools.css",
    "app/file-archive-dialog.css",
    "app/files-card-preview.css",
    "app/files-browser.css",
    "app/native-document-editor.css",
    "app/widget-customization.css",
    "app/workspace-save-status.css",
    "app/onboarding-flow.css",
    "app/assistant.css",
    "app/class-card-expansion.css",
    "app/auth.css",
    "app/reference-ui.css",
    "app/dashboard.css",
    "app/home-skeleton.css",
    "app/courses-skeleton.css",
    "app/widget-appearance.css",
    "app/widget-block-layout.css",
    "app/widget-reorder.css",
  ];

  assert.deepEqual(paths.slice(0, orderedFeatureStyles.length), orderedFeatureStyles);
  assert.ok(paths.indexOf("app/globals.css") >= orderedFeatureStyles.length, "shared foundation rules follow the ordered feature stylesheet imports");
  const globalStylesIndex = paths.indexOf("app/globals.css");
  assert.deepEqual(paths.slice(globalStylesIndex + 1), orderedExistingStyles, "the coordinator keeps existing stylesheet imports in their authored cascade order");
  assert.ok(paths.indexOf("app/reference-ui.css") > paths.indexOf("app/globals.css"), "reference UI overrides follow shared foundations");
  assert.ok(paths.indexOf("app/dashboard.css") > paths.indexOf("app/reference-ui.css"), "existing dashboard overrides retain their cascade position");
  assert.ok(paths.indexOf("app/widget-reorder.css") > paths.indexOf("app/widget-block-layout.css"), "widget reorder rules remain after widget block layout rules");
});
