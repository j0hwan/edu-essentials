import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const compiled = new Map();
const testAliases = new Map([
  ["next/link", new URL("./next-link.mjs", import.meta.url).href],
  ["next/navigation", new URL("./next-navigation.mjs", import.meta.url).href],
]);
export async function clientModule(relative) {
  const path = resolve(root, relative);
  if (compiled.has(path)) return compiled.get(path);
  const source = (await readFile(path, "utf8")).replace(/import\s+["'][^"']+\.css["'];?/g, "");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const specifiers = [...code.matchAll(/^import\s+.*?from\s+["']([^"']+)["'];?$/gm)].map((match) => match[1]);
  for (const specifier of new Set(specifiers)) {
    let url;
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(path), specifier);
      let file;
      for (const suffix of ["", ".ts", ".tsx"]) { try { await access(base + suffix); file = base + suffix; break; } catch { /* Try the next TypeScript extension. */ } }
      if (!file) throw new Error(`Missing test import: ${specifier}`);
      url = await clientModule(file);
    } else url = testAliases.get(specifier) ?? import.meta.resolve(specifier);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  compiled.set(path, url);
  return url;
}
