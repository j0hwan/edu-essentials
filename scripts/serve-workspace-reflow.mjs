import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { context } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function serveWorkspaceReflow(port = 0) {
  const builder = await context({
    entryPoints: [resolve(root, "tests/fixtures/workspace-reflow-browser.tsx")],
    bundle: true, write: false, platform: "browser", format: "iife", target: "chrome120",
    jsx: "automatic", loader: { ".css": "empty" },
    alias: {
      "next/link": resolve(root, "tests/helpers/next-link.mjs"),
      "next/navigation": resolve(root, "tests/helpers/next-navigation.mjs"),
    },
    define: { "process.env.NODE_ENV": JSON.stringify(process.env.REFLOW_MODE ?? "production") },
    logLevel: "warning",
  });
  const cssFiles = [
    "globals", "auth", "reference-ui", "dashboard", "home-skeleton", "courses-skeleton",
    "widget-appearance", "widget-block-layout", "widget-reorder", "class-card-expansion",
  ];
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/fixture.js") {
        const bundle = await builder.rebuild();
        response.setHeader("Content-Type", "text/javascript");
        response.end(bundle.outputFiles[0].text);
        return;
      }
      if (request.url !== "/home" && request.url !== "/dashboard") {
        const asset = resolve(root, "public", `.${new URL(request.url, "http://localhost").pathname}`);
        if (!asset.startsWith(resolve(root, "public") + "/")) {
          response.writeHead(404).end();
          return;
        }
        try {
          const contents = await readFile(asset);
          const extension = asset.split(".").pop();
          response.setHeader("Content-Type", { svg: "image/svg+xml", png: "image/png", webp: "image/webp", jpg: "image/jpeg", woff2: "font/woff2" }[extension] ?? "application/octet-stream");
          response.end(contents);
        } catch { response.writeHead(404).end(); }
        return;
      }
      const css = (await Promise.all(cssFiles.map((name) => readFile(resolve(root, `app/${name}.css`), "utf8"))))
        .map((source) => source.replace(/^@import[^;]+;\s*/gm, "")).join("\n");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixtureErrors = []; window.addEventListener("error", event => window.fixtureErrors.push(event.message)); window.addEventListener("unhandledrejection", event => window.fixtureErrors.push(String(event.reason)));</script><script src="/fixture.js"></script></body></html>`);
    } catch (error) {
      console.error(error);
      response.writeHead(500).end("Fixture build failed");
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolvePromise) => server.close(resolvePromise));
      await builder.dispose();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await serveWorkspaceReflow(4319);
  console.log(`Workspace reflow preview: ${fixture.baseUrl}/dashboard (or /home)`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
    await fixture.close();
    process.exit(0);
  });
}
