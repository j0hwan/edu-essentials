# Priority carousel gesture behavior

The priority list follows horizontal input while a gesture is active, then settles on the current or an adjacent page. Vertical gestures scroll the webpage. Once a gesture is recognized as horizontal, later diagonal movement belongs to the carousel until that gesture ends.

## Research

Reviewed October 15, 2026:

- [Apple: Designing Fluid Interfaces, WWDC18](https://developer.apple.com/videos/play/wwdc2018/803/). The iPhone examples emphasize immediate feedback, continuous redirection, tracking a recognized drag directly, and projecting release velocity to choose an endpoint. Apple recommends starting spring tuning without overshoot and adding bounce only when it serves the interaction.
- [Apple: UIScrollView.isDirectionalLockEnabled](https://developer.apple.com/documentation/uikit/uiscrollview/isdirectionallockenabled). UIKit can restrict general horizontal or vertical drags to one axis. Its diagonal behavior does not define this web carousel's policy; we deliberately keep horizontal ownership through diagonal wheel packets so the webpage cannot move underneath a swipe.
- [W3C: Pointer Events, supported direct manipulation behavior](https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior). Declare `touch-action` before a gesture. `pan-y` leaves vertical touch panning to the browser while allowing the carousel to handle horizontal drags. Canceling a pointer event alone does not prevent browser panning, and browser takeover is reported through `pointercancel`.
- [W3C: Wheel Events](https://w3c.github.io/uievents/split/wheel-events.html). Wheel packets use pixel, line, or page units. Custom handling needs a non-passive listener and cancelable events. Wheel input has no universally available physical finger-up phase, so an inactivity fallback is needed where the browser does not expose momentum information.

## Implementation decisions

These are project choices informed by those sources, rather than Apple-prescribed constants or an exact reproduction of iOS physics:

- Track horizontal and vertical wheel gestures separately. Keep the chosen axis through mixed input and the horizontal momentum tail; retain Ctrl+wheel zoom and vertical page scrolling for vertical gestures.
- Translate the current page and its adjacent previews together. Limit travel to one adjacent page so a large swipe cannot reveal empty space beyond that page or skip multiple pages.
- Allow at most 21.6px of resisted pull at the first and last pages, using a 24px resistance scale. Apply inward movement to the displayed position immediately, so reversing a large pull never requires unwinding invisible accumulated input.
- Recognize deliberate reversal even below the fast-flick threshold. A return toward the current page should cancel the earlier outward page choice.
- Use a 48ms release fallback at an unavailable edge, compared with 80ms for ordinary paging. The edge return uses a critically damped spring with stiffness 900; page changes use stiffness 700. Start an edge return toward the resting position, with no extra outward coast, and settle page changes without overshooting their destination.
- Consume same-direction packets throughout a page change and until 200ms of quiet after arrival. A `momentum: false` packet alone does not prove a new gesture: it can still belong to the swipe that reached the destination. Derive the guarded direction from the selected page, so a minor inward correction cannot misclassify subsequent momentum.
- Count uncancelable tail packets as continued input for the quiet window without letting them move the cards or interrupt the animation. Changing browser cancelability mid-swipe must not reopen the destination page.
- Require 6px of consecutive opposing horizontal input to interrupt a page change or its arrival guard; reset that intent on original-direction or native momentum packets. Edge and canceled-return springs remain immediately interruptible. Preserve horizontal axis ownership through mixed momentum packets.
- Preserve `touch-action: pan-y`, latch vertical pointer intent, and cancel stale movement on browser takeover, changed assignments, resized content, or lifecycle interruptions.
- Keep adjacent previews inert and hidden from accessibility APIs. Reduced motion preserves paging while skipping translated tracking and spring animation.

## Verification

Deterministic tests cover travel bounds, deep-pull reversal, slow cancellation after crossing a paging threshold, axis ownership, momentum, reduced motion, and cleanup. `scripts/verify-priority-carousel.mjs` exercises real wheel input, document scroll position, and touch panning. Run it with `PLAYWRIGHT_MODULE` pointing to the available Playwright runtime and optionally `CHROME_EXECUTABLE` pointing to Chrome.

The local Chrome 155 run kept document scroll at 0px through horizontal input followed by a vertical wheel packet, while a vertical-start gesture scrolled the page by 100px. A large edge pull stopped at 21.6px; a 1px reversal immediately reduced it to 20.6px, and the return reached the resting tolerance in about 247ms. Large paging input stopped at exactly one page plus the 8px gap. Real touch input preserved vertical page scrolling and horizontal card tracking, with no browser console or page errors.

Arrival regressions also cover both directions with late packets reporting unknown, false, and true momentum. The browser keeps the destination at offset 0 after those packets; deterministic tests additionally cover sparse input during settling, mixed cancelability, small inward nudges, and alternating direction noise.

Automated browser checks establish gesture routing and motion bounds. Judging the final feel still benefits from trying the carousel on a physical trackpad or iPhone.
