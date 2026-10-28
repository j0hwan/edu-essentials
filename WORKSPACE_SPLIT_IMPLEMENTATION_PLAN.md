# Extract workspace presentation and feature styles first

## Summary and priorities

Refactor `app/workspace-client.tsx` and `app/globals.css` to let future agents understand and modify individual features with less unrelated context and fewer editing conflicts.

Prioritize major presentation boundaries and feature styles. Preserve the existing application lifecycle and central coordination. Success is a readable coordinator plus independently understandable features—not a particular file size or number of files.

This plan follows the existing flat `app/` component-and-stylesheet convention. Do not introduce a state library, change routes, convert to CSS Modules, or reorganize existing components wholesale.

Before implementation, recheck the current code and tests against this review: future changes may have altered the boundaries.

## Implementation boundaries

All filenames below are relative to `app/`.

| Destination | Responsibility |
|---|---|
| `workspace-navigation.tsx` | Sidebar, mobile navigation/header, navigation items, and experimental-menu presentation. Receive existing navigation callbacks and state. |
| `workspace-search.tsx` | Full search page, quick-search results, and their shared result construction. Continue using `TopbarSearch`. |
| `workspace-home.tsx` | Home layout, workspace tabs, customization controls, widget grid composition, widget picker, and workspace-name dialog presentation. Keep these related controls together initially. |
| `workspace-widget.tsx` | Widget frame and body rendering. Reuse `StudyWidget`, `TodaySection`, and `ReorderableWidgetGrid`; do not create a new file for every widget type. |
| `workspace-widget-catalog.ts` | Widget templates and default workspace definitions shared by initialization, rendering, and the picker. |
| `workspace-dashboard.tsx` | Dashboard presentation using the existing dashboard, study brief, and loading components. |
| `course-detail.tsx`, `course-visual.tsx` | Expanded-course content and the course visual shared with dashboard cards. Preserve existing expansion and image components. |
| `assignment-table.tsx` | Assignment table and small related presentation helpers, including status badges. |
| `assignment-detail-dialog.tsx` | Assignment detail presentation and attachment controls using supplied actions. |
| `workspace-files.tsx` | Files page presentation, preserving both `FilesBrowser` and legacy `FileList` branches. |
| `workspace-settings.tsx` | Settings presentation around `ProfileEditor` and existing account/data actions. |
| `workspace-academic-dialogs.tsx` | Composition of existing class setup, academic editor, and syllabus dialogs, including add-class choice presentation. |
| `workspace-file-dialogs.tsx` | Composition of existing file preview, upload, file editor, and native-document dialogs. |

Do not add wrapper files for the small Tasks composition, `AcademicCalendar` adapter, or already-extracted `AcademicAssistant`. Keep the small page-header helper with the coordinator initially.

New components receive explicit typed data and action props. Group related props where useful, but do not pass the entire application state or a universal setter object. Keep shared domain types in their existing modules; define component-specific prop types beside their components. No public API, persisted schema, or route changes are required.

### Keep lifecycle and shared state together

For this implementation, retain the following in `workspace-client.tsx`:

- Canonical academic/workspace data and persisted preferences, including dashboard view and calendar filter.
- Profile identity and drafts, account/session generations, experimental mode, and onboarding coordination.
- Autosave construction, subscription, hydration, serialization, revision/conflict handling, reload, cleanup, and draft export.
- Academic validation and commit actions, assistant preparation/application, and aggregate save/account guards.
- File queues, pending uploads, organization state, native-document drafts, Undo, and cross-page dialog selections.
- Navigation coordination, shared search query, study clock, and Home skeleton cache lifecycle.

Do not relocate state during presentation extraction. Feature components may retain the local state already owned by existing components, but new extraction boundaries must not introduce resets or different lifetimes.

Preserve these specific relationships:

- Files stays mounted and hidden when organization work remains open after navigation.
- Dialog presence wrappers, keys, portal targets, focus behavior, and course expansion suspension remain coordinated.
- Study timers continue across pages; ordinary ticks do not cause saves.
- Account/session checks reject stale async results.
- Sidebar links, modified clicks, mobile links, and programmatic navigation retain their existing behavior.

A larger coordinator is acceptable when it clearly exposes these dependencies.

## Styles

Keep genuinely shared foundations in `globals.css`: Tailwind import, tokens, theme variables, resets, typography, accessibility/focus helpers, shared buttons/forms, common modal frames, toast primitives, and global reduced-motion behavior.

Create stylesheets alongside extracted features:

- `workspace-shell.css`: shell geometry, sidebar, topbar, and mobile navigation.
- `workspace-home.css`, `workspace-widget.css`: Home controls/layout and widget presentation.
- `workspace-dashboard.css`: class grid, summary strip, and view controls.
- `course-detail.css`, `course-visual.css`, `assignment-table.css`: corresponding reusable presentation.
- `workspace-search.css`, `workspace-files.css`, `workspace-settings.css`: page-specific styles.

Continue using existing component stylesheets, including widget appearance/layout/reorder styles, file-browser styles, and dialog styles. Do not duplicate their responsibilities.

Move each feature’s responsive and motion rules with it. Preserve selector names, specificity, DOM structure, and effective stylesheet order. Initially use an explicit ordered import list so extracted base rules still precede existing overrides; colocation does not require changing loading behavior.

Treat `reference-ui.css` as an existing cross-feature dependency. Plain CSS remains globally scoped after extraction.

Do not move the global “Dashboard” or “Calendar” sections wholesale into existing `dashboard.css` or `calendar.css`: they cover different selector families. Inventory legacy calendar consumers and leave those rules in place during this pass. Dead-style deletion and cascade redesign are separate work.

Keep modal scroll-lock selectors with shared modal behavior.

## Small changes, verification, and agent ownership

1. **Establish a baseline.** Reinspect current components, styles, and tests. Record failures and representative screenshots before changes. Document navigation, dialog retention, and account-reset behavior.
2. **Extract navigation and shared academic presentation.** Move JSX and helpers without changing state ownership. Verify sidebar/mobile behavior, modified clicks, course expansion, and assignment interactions.
3. **Extract page views.** Move Settings, Files, and search first; dashboard/course detail next; Home/widgets last. Keep loading boundaries, refs, DOM hierarchy, and mounting conditions intact.
4. **Extract substantial dialog composition.** Move presentation only, retaining root-owned state, guards, callbacks, keys, and presence boundaries.
5. **Move styles by feature.** Use a separate reviewable change for each coherent style group. Preserve cascade order and compare appearance before continuing.
6. **Evaluate and stop.** Confirm that an agent can modify each major feature by reading its component, stylesheet, and explicit coordinator interface. Do not continue extracting solely to reduce line counts.

After each change, run lint/build and relevant existing tests. Update test loaders and path-dependent assertions where necessary without weakening behavioral checks.

Verification must cover:

- Desktop and narrow layouts, dark theme, reduced motion, loading skeletons, and overlays.
- Navigation, sidebar collapse, same-dashboard course closing, keyboard focus, and modified-click links.
- Widget editing/reordering/resizing, workspace switching, and persisted preferences.
- Dialog transitions, draft retention, organization dialogs surviving navigation, and native-document navigation blocking.
- Autosave retries/conflicts, account changes with delayed responses, upload queues and confirmation preferences, Undo, experimental mode, and assistant application.
- Timer completion once, with no saves from ticks alone.

Use existing autosave, save-efficiency, Home skeleton, course expansion, file, and dialog tests. Run `npm run verify:navigation` for navigation changes and the existing Home skeleton/class-modal browser verification scripts for those areas. Add targeted behavioral coverage only where these critical paths lack protection. Finish with `npm test` and visual comparisons; report any pre-existing failures or unverified scenarios.

### Parallel assignments

One integrator owns `workspace-client.tsx`, `globals.css`, shared contracts, and import ordering.

After contracts are established, bounded agents can prepare destination files for search/Settings, dashboard/course presentation, Home/widgets, and dialog presentation. Agents must not independently remove code from the shared source files; the integrator wires each extraction sequentially.

Assign independent verification of navigation, account isolation, autosave, and appearance. Keep edits to account/session, persistence, and cross-feature coordination serialized.

## Deferred work and completion criteria

Do **not** extract persistence or introduce new controller hooks in this implementation. Potential later candidates include navigation state, search behavior, Home skeleton caching, and the study clock—but only when subsequent feature work demonstrates a clear benefit.

Reconsider further extraction when a feature repeatedly requires reading unrelated coordinator code or agents repeatedly conflict in the same section. Any later hook must have a narrow responsibility and preserve existing lifetimes.

This pass is complete when:

- Major feature rendering and styles have clear owners.
- Feature components expose understandable dependencies without importing the coordinator.
- Shared coordination remains visible and reviewable.
- Behavior and appearance match the baseline.
- No additional files are needed merely to satisfy a size target.

The expected benefit is lower context and conflict costs for future agent work. Runtime performance improvements are not an objective or an assumed outcome.
