# Corner widget resizing

## iOS reference and scope

Apple's iPhone guide documents choosing from the sizes a widget supports, and
WidgetKit models those sizes as widget families rather than arbitrary dimensions:

- https://support.apple.com/guide/iphone/customize-apps-and-widgets-on-the-home-screen-iph385473442/ios
- https://developer.apple.com/documentation/widgetkit/widgetfamily
- https://developer.apple.com/design/human-interface-guidelines/accessibility

The lower-right edit-mode grip is the visual reference for this interaction.
Apple does not publish the Home Screen resize spring, duration, or snap
thresholds. The motion values below are application tuning, not a claim about
SpringBoard's private implementation. The existing size menu remains available.

## Interaction

In Customize, each widget has an L-shaped lower-right grip with a 44px pointer
target. Drag it inward to shrink or outward to grow. Horizontal and vertical
movement select among the app's existing Mini, Small, Medium horizontal, Medium
vertical, and Large footprints; diagonal movement changes both dimensions.

After a 5px activation threshold, the widget follows pointer movement continuously
one-for-one with the pointer, including diagonal resizing, so its corner does not
outrun the cursor. At the supported footprint
limits, its live size uses a bounded rubber stretch. A neighboring-layout preview
uses the nearest supported size, with 14px distance hysteresis to avoid flickering
at a boundary. The gesture uses the committed footprint dimensions and pointer
delta, never the changing animated rectangle. Placement uses the same two- and
four-column packing rules as normal rendering, including mini pairing. Content
blur grows with distance from the original footprint, capped at 8px, with gently
boosted color and brightness to diffuse light; the resize grip remains sharp. The
widget and its content remain mounted with the same identity throughout resizing.

The resized widget takes placement priority: its original small-cell row is
reserved before surrounding widgets are packed. Growing a bottom-half mini
uses the top of that same cell rather than falling into a later row. Wider
sizes shift left only when needed to stay inside the board. Other widgets move
into the remaining space and animate around the reserved footprint.

The latest resize priority is saved separately for two- and four-column boards,
so releasing or reloading does not undo the preview layout. Cancellation restores
the previous saved priority. Explicit reordering clears these anchors; ordinary
content edits preserve them, and deleting the anchored widget removes its anchor.

On release, the widget snaps to the exact nearest supported footprint, including
when that is its original size. Blur, color, and brightness return to neutral as
the widget and displaced neighbors settle from their current visual bounds,
anchored at the top left. Interrupted transitions continue from their current
appearance. A lightly bouncy dimension spring settles in 420ms; neighbors use
their existing shorter layout transitions. Content sharpens over 220ms during
settling.
System/account reduced motion and zero-duration appearance settings disable the
settling animation; reduced motion keeps blur, color, and brightness neutral while
preserving direct manipulation and the final layout.

Only a changed, valid release commits a size through the existing workspace
save path. Previewing, clicking without movement, and releasing at the original
size do not write. Growing a mini into a non-mini clears its mini-block flag.
Escape, pointer cancellation, capture loss, window blur/resize, and changes to
the workspace, widget data, or editing context restore the saved size. Resizing
and reordering are mutually exclusive. Mouse, touch, and pen use the same pointer
lifecycle; the resize grip does not scroll the page during a touch gesture.

## Accessible alternatives

Focus the corner grip and use Left/Right to change width or Up/Down to change
height. Boundaries are no-ops. Enter or Space opens the existing named size
choices, which are also available through the widget options menu. A live status
announces pointer and keyboard size changes, exposes the current size as the
grip's accessible description, and the grip has a visible focus outline.
