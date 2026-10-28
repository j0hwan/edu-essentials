# Dashboard sidebar reflow

Home batches its resize measurements and uses FLIP for widget layout changes, although it skips that FLIP pass for sidebar changes. The dashboard now uses an explicit FLIP pass for sidebar changes: measure the visible blocks, apply the destination layout once, and animate their position and size with the shell's duration and easing. This avoids intermediate text-wrap changes moving whole rows abruptly. Individual `translate` and `scale` properties preserve the cards' existing hover transforms.

The dashboard-only shell transition override applies only while `AnimatedDashboard` is mounted. Other pages and the loading skeleton retain their shell transitions. Viewport column counts remain unchanged, with a maximum of four courses per row.

The study brief batches resize notifications into one animation frame, avoids redundant SVG/CSS writes, and measures its contour in layout coordinates rather than scaled visual coordinates. Rapid sidebar reversals start from the current visual rectangle. Resize, unmount, and enabling reduced motion cancel active reflow animations.

FLIP size animation uses destination text wrapping and temporarily scales content; it does not interpolate typography or line breaks. Browser checks cover the real workspace components with fake local data, not an authenticated production account.

## Verification

Run `node scripts/serve-workspace-reflow.mjs` and open `http://127.0.0.1:4319/dashboard` or `/home` for manual comparison. No account or persistence API is required.

Run `node scripts/verify-dashboard-reflow.mjs` with Playwright installed and Chrome available. If Playwright is installed outside this checkout, set `PLAYWRIGHT_MODULE` to its entrypoint; `CHROME_EXECUTABLE` optionally selects another Chromium executable. The script checks intermediate sizes, rapid reversal, one-to-four-column layouts, horizontal overflow, reduced motion, and runtime errors under 4× CPU throttling.

Focused component coverage lives in `tests/dashboard-reflow.test.mjs` and `tests/dashboard-summary-reflow.test.mjs`.
