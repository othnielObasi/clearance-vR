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
| Block a lane | Rest an open hand flat, palm-down, just above the board: waiting robots replan round it, moving robots wait for it | — |
| See behind tall racking | Lean or tilt your head | Press the eye button (see-through racking) |
| Pause | Turn one hand palm-up; poke the pause button that appears above it | Press ⏸ at the near-right corner |
| Give standing clearance | Pinch the gold permit from its pad and drop it on any robot | Press ★ above the robot |

Every gesture has a poke alternative, so the game is fully playable one-handed and on desktop (mouse clicks on the buttons).

**Assist mode** (landing page, or the pause menu in the headset) is for players with limited reach, grip or steadiness: pinches and open hands register more loosely, the palm can point less exactly, a slower flick rejects, and the buttons above each robot are 40% bigger and always shown instead of appearing only when a hand comes near. Hold times are unchanged, so a resting hand does not stop robots by accident. The setting is remembered on the device. See-through racking (the eye button) covers players who cannot lean.

Levels in this build: 1 First Shift (grant and reject), 2 Someone's Here (workers and stops), 3 Short Supply (scarce, expiring permits, three robots), 4 Too Good To Be True (trap proposals), 5 Standing Orders (gold permits: more work than permits, so you must delegate, and delegating to the wrong robot loses the shift), 6 Close the Aisle (a worker paces a busy aisle: stop robots in time, or close the aisle with your hand or a real object), 7 Peak Season (the finale: four robots, both rule-benders, a worker, a spill, tall racking and earned gold permits).

**Standing clearance (gold permits).** Some modes earn a gold permit every few deliveries (Overtime: every 4; Standing Orders: every 2, starting with one). Hand it to a robot and for 20 seconds it clears its own plans, shown by a gold halo that counts down. A robot on its own waits for workers to pass by itself, but it still plans by its own idea of the rules: a robot that is still cutting corners will take a shortcut unwatched, and that counts as a risk you let through. A stop takes the gold back at once. In Overtime, a reformed robot can relapse while holding gold. The decision moves from "is this plan safe?" to "who has earned autonomy, and when do I take it back?". Plus the **Daily Shift**: one generated level per UTC day, the same for everyone, with a streak and a copyable result card. And **Overtime**: an endless shift where tasks keep coming, new robots join as you score, reformed robots relapse, and every delivery earns a permit back; it ends at your first safety mistake. A stop that genuinely prevents harm refunds its permit; taking a permit straight back does not count.

**The crew.** Bolt (orange, rule-bender), Pip (teal, careful), Rook (purple, steady) and Juno (pink, speedy) appear across all modes. Each remembers how you treated them between sessions (caught, let through, stopped for nothing, saved) and greets you accordingly. Bolt starts bold if you have let his shortcuts through more often than you caught them.

**Your real desk matters.** On entering the headset the game finds your real table from the Quest's room setup (WebXR plane detection) and rests the board on it, falling back to a hit-test ray and then to a head-relative position; a spatial anchor keeps it there. The headset's depth sensor then watches the board: put a mug, a bottle or a box on it, take your hand away, and after about a second the cells under it become walls that robots plan round, just like a flat hand. Scans pause while a hand is over the board so arms never count, and pickup and drop-off spots are never blocked. Add `?occlusion` to let real hands and objects hide the robots behind them (off by default until tuned on a headset). Each shift ends with a field note linking its lesson to how real automated systems are supervised.

**Tuning on a headset.** Open the game with `?debug` to see a live panel of pinch distance, palm angle, flick speed and frame rate next to the board.

## Run it

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev        # HTTPS dev server on your LAN
npm test           # planner, authority rules and headless level simulations
npm run build      # static build in dist/
```

**On a Quest:** run `npm run dev`, then open `https://<your-computer's-LAN-IP>:5173` in the Quest Browser, accept the self-signed certificate warning, and press **Start shift**. WebXR requires HTTPS, which is why the dev server uses a local certificate.

**Deploy to Vercel:** import the GitHub repo at vercel.com/new (framework, build command and output folder come from `vercel.json`), or from this folder run `npx vercel --prod`. Every push to `main` then redeploys.

**Deploy to GitHub Pages:** push to `main` on GitHub with Pages enabled (Settings → Pages → Source: GitHub Actions). The workflow runs the tests, builds with the right base path and publishes to `https://<user>.github.io/<repo>/`.

## Evaluation

`npm run eval` plays every level with three bot players and prints a metrics table:

| Metric | What it tells us | Target |
| --- | --- | --- |
| Careful player result | The level is winnable with good judgement | Win, 3 stars |
| Careless player result | Approving everything is punished | Lose, or under 3 stars |
| Novice win rate (40 runs) | Difficulty for a first-timer: human reaction delays, misses 30% of shortcuts and 25% of stops | L1 ≥90%, L2 70–95%, L3 50–80%, L4 45–80%, L5 60–90%, L6 50–85%, L7 45–80% |
| Pressure | Share of novice play time with 2+ robots asking at once | ≥15% from level 3 |
| Decisions per minute | How busy the player is | Rises across levels |
| Trust calibration (per shift) | Over-trust (risky approved, worker incidents) vs under-trust (safe plans blocked, needless stops) | Careful play scores "calibrated" |
| Delegation (gold modes) | A careful player who gives gold only to trustworthy robots, against one who gives it to anyone, over the same Overtime seeds | Wise delivers more; only naive lets shortcuts through |

The bands are enforced by `tests/difficulty.test.ts`, so a level edit that breaks the difficulty curve fails CI. The Daily Shift generator only accepts a candidate level if the careful bot gets 3 stars, the careless bot cannot, and novices win 4–9 of 10 runs.

Playtest metrics to collect by hand (15–16 Nov): time to first successful grant (target under 60 s with no help), first-five-minutes rating (target 4/5 from 5 of 8 players), and whether players can name the robot they trust least after level 1.

## Online extras (optional)

The game is complete offline. A small companion server in `server/` adds two things, and the game falls back silently if it is unreachable:

- **Fresh crew lines and a shift debrief, from Muse Spark Open** (Meta's open-weight model, served by Baseten). As a shift starts the game asks once for new in-character lines for that shift's robots, based on how the player has treated each of them; as it ends it asks for a two-sentence debrief from the shift supervisor. Play never waits for either. Lines that carry gameplay facts (how many seconds a shortcut saves) stay written by hand. The server only lets through short, clean lines from known robots and situations.
- **Play together**: two players, one warehouse. The host opens a room and reads out a 4-letter code; the partner joins with it on the landing page, then both enter the headset. The host's game runs the shift and sends its state about ten times a second; the partner's actions (grant, reject, stop, gold, pause, hand and object walls) go to the host. Each player sees the other's hands as blue ghost points over the board.

Set `VITE_CLEARANCE_SERVER=https://your-server` when building (in Vercel: Project settings, Environment variables), or test with `?server=https://your-server`. Without it, the Play together button is hidden and robots use their written lines.

**Run the server:** on any small Linux host with Docker, copy `server/deploy/.env.example` to `server/deploy/.env`, fill in `DOMAIN` (for example `51-15-1-2.sslip.io` for IP 51.15.1.2) and `BASETEN_API_KEY`, then from `server/deploy` run `docker compose up -d --build`. Caddy gets the HTTPS certificate. `GET /health` reports whether the model key is set. The `.env` file is git-ignored.

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
- **Works offline.** The game needs no account or server; the optional online extras above fail quietly, so nothing can break a shift.

## Status

Working: core simulation, levels 1–7, Daily Shift, Overtime, standing clearance, crew memory, desk anchoring, spatial sound, desktop preview and landing page (59 passing tests; a careful bot wins every level with 3 stars, a careless one loses the safety levels).

Not yet verified on a headset: hand-gesture thresholds, passthrough placement height and performance.
