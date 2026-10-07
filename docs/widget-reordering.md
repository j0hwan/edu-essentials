# Widget rearrangement: research and implementation plan

## Interaction research

Research reviewed on October 6, 2026, using Apple's support guides, design
guidelines, and WWDC transcripts.

- [Move apps and widgets on the iPhone Home Screen](https://support.apple.com/guide/iphone/move-apps-and-widgets-on-the-home-screen-iphd2fc8ce30/ios)
  documents entering edit mode until items jiggle and dragging an app or widget
  to a different position. Holding at a screen edge allows moving between pages.
- [Add and edit widgets](https://support.apple.com/en-gb/118610) describes moving
  a widget among other apps and widgets in Home Screen edit mode, then finishing
  with Done.
- [Design great widgets, WWDC20](https://developer.apple.com/videos/play/wwdc2020/10103/)
  describes widgets jiggling like apps in edit mode and using direct manipulation
  to customize them. Widgets occupy distinct footprints.
- [Designing Fluid Interfaces, WWDC18](https://developer.apple.com/videos/play/wwdc2018/803/)
  explains preserving the relative position between touch and content, tracking
  gestures directly, and allowing motion to be redirected or interrupted.
- [Drag and drop, Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)
  recommends a drag image and feedback identifying a valid destination. A
  collection can use a placeholder to indicate where content will land. Invalid
  destinations should lose their drop feedback; unsuccessful drops can return
  the preview to its source or fade it away.
- [Accessibility, Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/accessibility)
  and [Customize onscreen motion](https://support.apple.com/guide/iphone/customize-onscreen-motion-iph0b691d3ed/ios)
  support reducing decorative movement, scale, and repetitive motion while
  keeping direct manipulation usable.

Home Screen jiggle and direct dragging are documented behaviors. The general
drag-and-drop and fluid-interface guidance informs the implementation, but does
not establish SpringBoard's private implementation. Apple does not specify its
exact insertion algorithm, lift scale, shadow, spring, or reorder delay in these
sources. The motion and target thresholds here are application design choices.

## Planned behavior

1. Customize exposes drag handles and a subtle edit cue.
2. Moving a handle beyond a small activation threshold lifts a full-content
   preview of that widget. The grab position remains anchored to the pointer.
3. The board reserves the dragged widget's entire footprint at the projected
   destination. Other widgets move into the layout that will be committed if
   the user releases there.
4. Every candidate order uses the existing production packing function,
   including mini pairing and both responsive column counts. Target selection
   uses projected geometry rather than chasing neighbors while they animate;
   a small hysteresis prevents boundary oscillation.
5. A valid release commits the preview order once and settles the lifted widget
   into its destination. Moving outside the board removes the valid-drop cue.
6. Escape, an invalid drop, pointer cancellation, or a change of workspace or
   edit context restores the saved order. Hovering never updates persisted
   workspace state.
7. Pointer events support mouse, touch, and pen. Edge scrolling allows reaching
   widgets below the viewport. Existing Move earlier / Move later controls
   remain available for keyboard and assistive-technology use.
8. Reduced motion retains the layout preview and pointer tracking while
   suppressing edit jiggle, lift scaling, and animated layout travel.

## Implementation boundaries

The reorderable board owns temporary order and the drag lifecycle. The existing
animated grid remains responsible for placement and interrupted FLIP animation.
Workspace state is updated only through the existing validated commit path.
The floating preview is an inert DOM snapshot, so notes and timer components
remain mounted once with their stable IDs throughout the drag. Nested scroll
positions are preserved for both the dragged widget and displaced neighbors.

This feature arranges widgets on the Home board. The separate appearance studio
continues to edit visual appearance. Page switching, widget stacks, folder
creation, and persistent empty grid positions are outside this interaction.

The application uses a 5px drag activation threshold and 14px insertion
hysteresis. The lifted card scales to 1.025 around the actual grab point.
Neighbor motion uses each card's existing appearance timing; drop settling is
capped at 240ms and cancellation fades over 120ms. A zero transition setting
disables settling and fading. These are application tuning values, not Apple's
Home Screen specifications.

## Verification

Verify projected versus committed order, mixed footprints and paired minis on
two- and four-column boards, stationary-pointer stability, interruption and
invalid-drop cleanup, note identity and content, no persistence during preview,
one commit on release, and system/account reduced-motion behavior. Use actual
React components in behavioral tests and a browser to inspect pointer tracking,
neighbor movement, touch dragging, scrolling, and the visible landing space.

The browser fixture in `scripts/verify-widget-reorder.mjs` mounts the actual
Workspace component with synthetic data and production CSS. Its desktop,
touch, reduced-motion, and stationary-edge-scroll checks passed in Chrome,
including preservation of a scrolled note after cancellation and a committed
reorder of a neighboring widget. Touch input uses Chrome emulation.
The existing `scripts/verify-widget-layout.mjs` checks also passed across all
18 widget types, mixed footprints, responsive widths, menus, and scrollbar
stability. Browser snapshots are written under `.vinext/verify-widget-reorder`.
