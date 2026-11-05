# Clearance

**Tiny robots plan. Nothing moves without your clearance.**

A hands-first, seated mixed-reality puzzle game for Meta Quest, built with the Immersive Web SDK (WebXR). Autonomous robots work on your real table: each one picks its own task, plans its own route and shows it as a glowing ghost path. You are the authority. Hand a robot a permit to let it move, flick away a bad plan, or hold up your palm to stop it.

Entry for the Meta VR Start Developer Competition 2026 — Gaming track, New Experience division. Project started 5 November 2026.

## Play

| Action | Hands | Poke / click alternative |
| --- | --- | --- |
| Clear a robot to move | Pinch a permit from the dispenser and drop it on a robot that is waiting (blinking amber light) | Press ✓ above the robot |
| Reject a plan | Flick your index finger sideways across the ghost path | Press ✗ above the robot |
| Stop one robot | Open palm facing the robot, hold briefly | Press ■ above the robot |
| Stop everything | Both palms up, hold briefly | Press the red ■ on the dispenser |
| Move the board | Pinch the cyan handle at the near edge | — |

Every gesture has a poke alternative, so the game is fully playable one-handed and on desktop (mouse clicks on the buttons).

Levels in this build: 1 First Shift (grant and reject), 2 Someone's Here (workers and stops), 3 Short Supply (scarce, expiring permits), 4 Too Good To Be True (trap proposals).

## Run it

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev        # HTTPS dev server on your LAN
npm test           # planner, authority rules and headless level simulations
npm run build      # static build in dist/
```

**On a Quest:** run `npm run dev`, then open `https://<your-computer's-LAN-IP>:5173` in the Quest Browser, accept the self-signed certificate warning, and press **Start shift**. WebXR requires HTTPS, which is why the dev server uses a local certificate.

**Deploy:** push to `main` on GitHub with Pages enabled (Settings → Pages → Source: GitHub Actions). The workflow runs the tests, builds with the right base path and publishes to `https://<user>.github.io/<repo>/`.

## How it is built

```
src/
  core/        Pure TypeScript simulation, no rendering: deterministic and unit-tested
    game.ts      Robots' state machine, authority (permits, stops, rules), hazards, scoring
    planner.ts   A* routing, space-time reservations so cleared robots never collide
    rng.ts       Seeded PRNG; Daily Shift seed from the UTC date
  levels/      Level JSON files + validator
  game/        Glue between the simulation and the XR world
    app.ts       Board, tokens, buttons, gestures to actions, HUD, level flow
    coach.ts     One-line tutorial hints driven by game events
    system.ts    IWSDK ECS system: frame loop, grab and press events
  xr/          Rendering and input
    board-view.ts  Procedural tabletop scene from a Game
    gestures.ts    WebXR hand-joint features: pinch, open palm, palm normal, flick velocity
    models.ts      Procedural low-poly robots, workers, crates, buttons, permit tokens
    hud.ts, audio.ts
tests/         Vitest: planner, authority, traps, and bots that play every level
```

Design rules the code enforces:

- **Agents act, the player authorises.** Robots always choose and plan on their own; the player never steers them. A robot only moves after `Game.grant()` consumes a valid, unexpired permit.
- **Stops never wait for the planner.** `Game.stop()` halts immediately and drops the plan; the robot must be cleared again.
- **Traps are real plans.** A shortcut-biased robot plans while ignoring one rule. Granting it causes an incident; rejecting it teaches that robot to plan honestly for that task.
- **Deterministic.** Same level seed and same inputs give the same outcome, so levels are testable and the Daily Shift is fair.
- **No backend, no accounts, no third-party AI.** Everything runs on the headset; nothing can go down during judging.

## Status

Day 1 of 13. Working: core simulation and levels 1–4 (23 passing tests; a careful bot wins every level with 3 stars, a careless one loses the safety levels), desktop preview, button play, permit tokens, pinch-grab, palm-stop and flick detection.

Not yet verified on a headset: hand-gesture thresholds, passthrough placement height and performance. Planned next: device tuning, ghost-hand tutorial, teach-and-release levels 5–6, levels 7–8, Daily Shift.
