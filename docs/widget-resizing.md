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

After a 5px activation threshold, the board previews the nearest supported size.
A 14px distance hysteresis avoids flickering between sizes at a boundary. The
gesture uses the committed footprint dimensions and pointer delta, never the changing
animated rectangle. Placement uses the same two- and four-column packing rules
as normal rendering, including mini pairing. The widget and its content remain
mounted with the same identity throughout resizing.

The widget and displaced neighbors animate from their current visual bounds to
the new layout, anchored at the top left. Interrupted transitions continue from
their current appearance. A lightly overshooting ease-out settles in at most
260ms and respects shorter per-widget timings. System/account reduced motion and
zero-duration appearance settings disable the resize animation while preserving
direct manipulation and the final layout.

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
