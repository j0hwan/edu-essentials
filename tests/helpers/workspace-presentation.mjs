import { readFile, access } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export const workspacePresentationModules = Object.freeze({
  navigation: "app/workspace-navigation.tsx",
  dashboard: "app/workspace-dashboard.tsx",
  courseDetail: "app/course-detail.tsx",
  courseVisual: "app/course-visual.tsx",
  assignmentTable: "app/assignment-table.tsx",
  assignmentDetailDialog: "app/assignment-detail-dialog.tsx",
  academicDialogs: "app/workspace-academic-dialogs.tsx",
  fileDialogs: "app/workspace-file-dialogs.tsx",
  files: "app/workspace-files.tsx",
  search: "app/workspace-search.tsx",
  settings: "app/workspace-settings.tsx",
  home: "app/workspace-home.tsx",
  widget: "app/workspace-widget.tsx",
  widgetCatalog: "app/workspace-widget-catalog.ts",
});

export async function readWorkspacePresentationSource(owner) {
  const path = workspacePresentationModules[owner];
  if (!path) throw new Error(`Unknown workspace presentation owner: ${owner}`);
  return readFile(resolve(repoRoot, path), "utf8");
}

function moduleImports(source, filename) {
  const kind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind);
  const imports = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      && !clause.name && clause.namedBindings.elements.length
      && clause.namedBindings.elements.every((element) => element.isTypeOnly)) continue;
    imports.push(statement.moduleSpecifier.text);
  }
  return imports;
}

async function resolveModuleImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const suffix = extname(base);
  const candidates = suffix
    ? [base]
    : [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, resolve(base, "index.tsx"), resolve(base, "index.ts")];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { continue; }
  }
  return null;
}

function cssImports(source) {
  return [...source.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?[^;]*;/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}

export async function readWorkspaceStylesheets({ stylesheetOverrides = {} } = {}) {
  const stylesheetSources = [];
  const visitedModules = new Set();
  const visitedStylesheets = new Set();

  async function visitStylesheet(path, overridePath = null) {
    if (visitedStylesheets.has(path)) return;
    visitedStylesheets.add(path);
    const sourcePath = overridePath ? resolve(overridePath) : resolve(repoRoot, path);
    const source = await readFile(sourcePath, "utf8");
    for (const imported of cssImports(source)) {
      await visitStylesheet(relative(repoRoot, resolve(dirname(sourcePath), imported)));
    }
    stylesheetSources.push({ path, source });
  }

  async function visitModule(path) {
    const absolutePath = resolve(repoRoot, path);
    if (visitedModules.has(absolutePath)) return;
    visitedModules.add(absolutePath);
    const source = await readFile(absolutePath, "utf8");
    for (const specifier of moduleImports(source, absolutePath)) {
      if (specifier.endsWith(".css")) {
        const stylesheet = relative(repoRoot, resolve(dirname(absolutePath), specifier));
        await visitStylesheet(stylesheet, stylesheetOverrides[stylesheet] ?? null);
      } else {
        const imported = await resolveModuleImport(absolutePath, specifier);
        if (imported) await visitModule(relative(repoRoot, imported));
      }
    }
  }

  await visitStylesheet("app/globals.css", stylesheetOverrides["app/globals.css"] ?? null);
  await visitModule("app/workspace-client.tsx");

  return {
    paths: stylesheetSources.map(({ path }) => path),
    sources: stylesheetSources,
    css: inlineWorkspaceStyles(stylesheetSources),
  };
}

export function inlineWorkspaceStyles(stylesheetSources) {
  return stylesheetSources
    .map(({ source }) => source.replace(/^\s*@import[^;]+;\s*/gm, ""))
    .join("\n");
}
