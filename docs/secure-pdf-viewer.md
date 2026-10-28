# Secure uploaded-PDF viewer

This is the maintenance and reuse guide for the continuous PDF preview used by
syllabus previews, private-file dialogs, and class setup. The viewer displays
canvas pixels, not an embedded PDF document. Preserve this distinction when
changing its appearance or adding new entry points.

## Why not a native PDF iframe?

The original empty-sandbox PDF iframe was blocked by Chromium's built-in PDF
viewer, including in Helium. Removing the sandbox would trade that compatibility
problem for a weaker uploaded-content boundary. A blob URL inherits its creator's
origin; it is not an isolated origin for untrusted content. Download-response
headers also do not carry over as security policy for a newly created blob URL.

Do not fix preview failures by removing sandbox restrictions, embedding uploaded
HTML, making private storage public, or adding an unrestricted inline-file route.
The current solution renders PDF pages into images in an application-owned worker.

## Code map and data flow

| File | Responsibility |
| --- | --- |
| `app/private-files.tsx` | Loads private blobs, checks preview availability, guards against stale results, and revokes owned object URLs. |
| `app/class-setup-document-preview.tsx` | Class-setup document preview entry point. |
| `app/pdf-preview.tsx` | Continuous page layout, lazy rendering, sequential work queue, retries, and canvas cleanup. |
| `lib/pdf-preview-client.ts` | Creates a worker per page, enforces timeout/abort, validates results, draws and closes bitmaps, and terminates workers. |
| `lib/pdf-preview.worker.ts` | Adapts PDF.js to OffscreenCanvas, renders a page, and transfers its bitmap to the UI. |
| `lib/pdf-preview.ts` | Validates input and page dimensions, configures PDF.js, bounds output size, and disposes parsing/rendering tasks. |
| `app/api/files/route.ts` | Authenticated private-file download endpoint. |
| `lib/file-content.ts` | Verifies file availability, content revision, byte length, and saved digest when present. |
| `app/auth.css` | Shared scroll container and page styles. |

The flow is authenticated download → private Blob → worker parsing/rendering →
transferable ImageBitmap → visible canvas. No PDF iframe, object, or embed is
needed. The renderer receives bytes rather than a remote PDF URL, and this UI
does not install PDF scripting, attachment-opening, or interactive annotation
handlers.

The Files card thumbnail renderer in `app/files-card-preview.tsx` is a separate
first-page implementation. It does not currently use this terminable-worker
pipeline; do not assume the worker timeout or queue applies to thumbnails.

## Security and resource controls

- The download route authenticates the caller and checks file ownership. Keep
  those checks server-side; possession of a file ID is not authorization.
- Private downloads remain attachments with `Cache-Control: private, no-store`,
  `X-Content-Type-Options: nosniff`, and
  `Content-Security-Policy: sandbox; default-src 'none'`. The route currently uses
  the stored MIME type. A PDF blob's MIME normalization in the preview is not a
  replacement for upload-byte detection or authorization.
- Both the client and rendering core reject PDFs larger than 20 MiB. The core
  also requires `%PDF-` within the first 1,024 bytes before invoking PDF.js. This
  header check is not comprehensive validation or malware scanning.
- PDF.js receives `enableXfa: false`, `useWasm: false`,
  `maxImageSize: 5_000_000`, and `stopAtErrors: true`.
- Output is scaled to at most 1,200 × 1,600 pixels and at most 2× source scale.
  The client also rejects returned bitmaps exceeding those dimensions. The
  custom intermediate canvas factory rejects canvases over 5,000,000 pixels.
- Each page request has a default 20-second deadline. Abort, timeout, success,
  and failure terminate its worker. Termination is essential when parsing cannot
  cooperatively yield or be cancelled.
- Each mounted PDF document serializes page work. Pages within an 800-pixel
  vertical margin of the scroll viewport are mounted for rendering; distant
  canvases are unmounted and zero-sized while page placeholders retain space.
  Returning to a released page renders it again. Without IntersectionObserver,
  pages render sequentially without lazy unloading.
- Changing the source Blob remounts the document, aborting old work and ignoring
  late results. Unmounting a page also aborts pending or active work. Bitmaps are
  closed after handling, including rejected or stale results.
- A lost display-canvas context aborts its render and replaces that page's canvas
  for one automatic recovery attempt. Repeated loss offers retry/download; a
  manual retry allows recovery again. Rendering also rejects a lost context
  instead of reporting a blank or black canvas as successfully loaded.
- Errors are rendered as text, not HTML. Worker error details are limited to 200
  characters. A page failure offers retry/download without hiding other pages.

These are defense-in-depth controls, not a guarantee that arbitrary PDFs are
safe. A same-origin Web Worker is a lifecycle/DOM isolation mechanism, not a
separate-origin security sandbox. Compressed streams, total document complexity,
page count, placeholder DOM size, and aggregate work across multiple mounted
viewers are not globally bounded by the per-page limits. Keep the PDF dependency
updated and re-run integration checks after upgrades. Do not treat original-file
downloads as sanitized output or log private file bytes during troubleshooting.

## Worker protocol and bundling pitfalls

Requests use `{ type: "pdf-preview:render", data: Blob, page: number }`.
Successful replies use `{ type: "pdf-preview:result", pages, bitmap }`; failures
use `{ type: "pdf-preview:result", error: true, reason }`.

Only handle tagged result messages. PDF.js can emit its own startup message
(`action: "ready"`); treating that message as a preview result previously caused
the worker to be terminated before rendering.

Retain Vite's explicit constructor import:

```ts
import PdfPreviewWorker from "./pdf-preview.worker?worker";
```

Do not replace it with `new Worker(new URL(..., import.meta.url))` without
rechecking both dev and production transforms. Vinext's post-transform can
rewrite that base to `file:///ROOT/...`, which an HTTP page cannot load. Dev
workers must resolve to same-origin HTTP(S); production must reference the
emitted hashed worker asset. Keep the Vite client type import in `vite-env.d.ts`.

The worker relies on OffscreenCanvas and PDF.js's worker-compatible font APIs.
Its canvas/filter factories and font configuration are version-sensitive. The
no-op filter factory avoids DOM/SVG filter construction; it can affect visual
fidelity. Do not assume upstream PDF.js options behave identically in the
installed `unpdf/pdfjs` bundle. Verify actual rendering before changing these
adapters, and fail with retry/download rather than silently reverting to
main-thread parsing or an unsandboxed viewer.

## Reuse and UI behavior

```tsx
<PdfPreview data={privatePdfBlob} name={file.name} downloadUrl={ownedDownloadUrl} />
```

Import `PdfPreview` from `app/pdf-preview.tsx` using the appropriate relative
path. Supply an authenticated Blob, retain its name for accessible page labels
and downloads, and clean up any object URL at the owning entry point. Prefer
the existing private-file wrappers when working with stored files so their
availability and stale-request protections are preserved.

The viewer stacks all page placeholders in document order and scrolls inside
`.private-pdf-preview`; it has no Previous/Next controls. A first-page render
discovers the page count. The expanded Syllabus section hides the visible filename
but retains missing-file guidance, import/detach actions, and accessible names.

This is a raster preview, not a complete PDF editor or native viewer. It does
not provide text selection/search, a PDF text accessibility layer, interactive
forms, or native print/zoom controls. Original downloads remain available as a
fallback. Avoid adding nested scroll containers when embedding the viewer.

## Regression checks

Run from the repository root; build first because the emitted-worker test reads
production assets:

```sh
npm run build
node --test --test-concurrency=1 tests/pdf-preview*.test.mjs tests/inline-file-preview.test.mjs tests/class-setup.test.mjs tests/class-card-expansion.test.mjs tests/file-content.test.mjs tests/files.test.mjs
npx tsc --noEmit --incremental false
npx eslint app/pdf-preview.tsx lib/pdf-preview*.ts app/private-files.tsx
git diff --check
```

Coverage includes bounded rendering and disposal, worker abort/timeout/protocol,
real PDF parsing with mocked drawing primitives, Vite/Vinext dev transformation,
production-worker startup, private-file lifecycle, continuous page order,
sequential scheduling, offscreen cleanup, retries, and filename visibility.

After building, `node scripts/verify-pdf-preview-browser.mjs` checks actual page
pixels across repeated mounts and interrupted renders in Chromium. It also
clears page 1 to black and dispatches a controlled `contextlost` event, then
verifies that a fresh canvas restores page 1 while page 2 stays intact. Set
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` if using external browser tooling.
This controlled failure checks recovery; it does not reproduce a native GPU
failure or identify the trigger of an intermittent user report.

The Node/JSDOM and VM tests do not prove real browser font/canvas behavior or
visual fidelity. Before release, manually check Helium/Chromium and other supported
browsers in dev and production with multi-page, scanned, font-heavy, malformed,
and large PDFs. Scroll in both directions, retry a failed page, change files
during rendering, and close previews mid-render. Confirm private-file access
still fails for another account and no PDF iframe or `file:` worker URL appears.

For failures, inspect the worker request URL, tagged messages, browser worker
errors, and displayed bounded error text. A timeout should end in retry/download,
not a frozen UI. Do not loosen file privacy or embedding policy to work around
an unsupported or malformed document.
