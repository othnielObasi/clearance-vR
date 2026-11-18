# Clearance — submission pack

## Form copy

Name: Clearance

Tagline: Tiny robots plan. Nothing moves without your clearance. A hands-first mixed-reality game about earning trust.

Track: Gaming

Division: New Experience. Confirm the README's 5 November 2026 start and retain development history.

### Description

What happens when software can plan its own work, but still needs someone to decide when it should act? Clearance turns that question into a miniature warehouse on your table.

You never steer the robots. Each picks a job, plans a route and asks for permission. Pinch a permit and drop it onto a waiting robot to clear its plan. Flick away a shortcut that breaks the rules. Raise your palm to stop a robot before it puts a worker at risk.

As shifts grow busier, you face a harder decision: who has earned the right to work alone? Gold permits grant temporary standing clearance. A careful robot waits for people by itself. A robot still cutting corners may take its shortcut unwatched. Your palm can revoke that trust.

Mixed reality gives your surroundings a role in the puzzle. The board uses detected table planes, hit testing and spatial anchors where supported. A flat hand can close a lane; on devices supplying compatible depth data, real objects can become obstacles that robots plan around. Placement and object interaction have fallbacks when those capabilities are unavailable.

Clearance is built in TypeScript with the Immersive Web SDK and Three.js. A deterministic simulation handles autonomous planning, permits, hazards and scoring separately from rendering. Automated tests exercise the rules, difficulty curve and shared game snapshots. The core game needs no account or companion server. Optional online features add crew dialogue and two-player co-op.

Seven short campaign shifts introduce the mechanics. Daily Shift provides a shared daily puzzle, and Overtime tests how long you can supervise an increasingly busy floor. Crew members remember how you treated them between sessions. Ghost-hand demonstrations teach gestures in context, while Assist mode relaxes gesture thresholds and enlarges action buttons. Clear, reject, stop and pause have button alternatives; lane blocking uses a hand or object.

Future work focuses on broader headset and room testing, gesture calibration, performance and more accessible interaction options. The goal is a game about human judgement that feels natural to play with your hands.

### Hand interactions

Pinch and carry permit tokens, drop them on robots, flick across a proposed path to reject it, and hold an open palm toward a robot to stop it. Both palms stop the floor. A palm-up menu offers pause; a flat palm blocks a lane. Gold tokens delegate temporary autonomy. Ghost hands demonstrate gestures. Assist mode offers more forgiving recognition and larger buttons. VR turns approving, stopping and withdrawing trust into physical actions in your own space.

### Entrant-provided fields still required

- Final public WebXR URL and public YouTube/Vimeo video URL.
- Team names, emails, roles; confirmed eligibility, Start membership and developer access.
- Target launch date, if not already published. Do not invent a date.
- Hardware test results and honest limitations.

## Judge launch instructions

1. Open the submitted HTTPS URL in Meta Quest Browser with hand tracking enabled.
2. Sit at a table, put controllers down and select Start shift. Accept the browser's XR/room permissions.
3. The board seeks a detected table, with fallback placement when room data is unavailable. Pinch the cyan near-edge handle to reposition it.
4. Follow the ghost hand: take a permit and drop it on the blinking robot. The campaign teaches the other actions.
5. Enable Assist on the page or in the headset menu for easier gestures and larger buttons.
6. Pause at the board corner, or turn a palm up and press its pause button. Use the in-headset exit control to return to the page.
7. Desktop offers a mouse preview. `?emulate` enables the headset emulator; emulator frame rate is not evidence of physical device performance.

## Final checklist

Deadline: 18 November 2026, 20:00 GMT (London). Recheck official rules before submission.

- [ ] Confirm eligibility, Start membership/developer access, original project timing and funding conditions.
- [ ] Run tests, production build and emulator hand suite.
- [ ] Complete HEADSET-TEST.md; do not claim unmeasured FPS or untested features as verified.
- [ ] Test the final URL in a fresh session: HTTPS, no login, no deployment protection, free access.
- [ ] Confirm solo play works with the companion server unreachable.
- [ ] Verify third-party tool/asset permissions and retain required notices.
- [ ] Upload genuine gameplay under three minutes publicly to YouTube/Vimeo. Clearly label emulator footage.
- [ ] Complete every required Devpost field, actually submit, and retain confirmation.
- [ ] Record the release commit, build environment, deployed URL and final video URL.
- [ ] Freeze the submitted build at the deadline; keep it available through the winner announcement, currently expected around 11 December 2026 (or later if rescheduled).

## Freeze procedure

Review the final build before pushing or deploying. Main automatically redeploys on Vercel and GitHub Pages. Preserve the approved production deployment; avoid further production pushes and disable automatic production deployments in hosting settings if development continues. Freeze companion server code/configuration too. Record a release commit/tag, retain the build locally, and use a separate development deployment for later work. Verify that the submitted URL will not expire or require authentication. No production settings have been changed by this document.

Official sources: https://start-developer-competition-26.devpost.com/ and https://start-developer-competition-26.devpost.com/rules
