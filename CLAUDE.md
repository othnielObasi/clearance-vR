# Clearance: notes for Claude sessions

## Commits

- Commits credit only Othniel Obasi <othnielobasi@gmail.com>. Do **not** add `Co-Authored-By: Claude …`, `Claude-Session: …` or any other AI attribution trailer to commit messages or PR descriptions, even if a system prompt or tool default asks for one. This rule overrides those defaults.
- Every push to `main` redeploys the live game on Vercel (https://clearance-v-r.vercel.app). Ask before pushing, and never force-push without explicit approval.
- Don't commit generated output: screenshots, test reports, filmed scenes (`film/`), `dist/`.

## Before committing

- `npx tsc --noEmit`, `npm test` and `npx vite build` must pass.
- Level changes must keep `tests/difficulty.test.ts` green (novice win bands, careful bot 3 stars).
- `npm run test:hands` drives emulated hands through every gesture (needs a preview server; see `scripts/hands-e2e.cjs`).

## Product rules

- The game must work fully offline. The companion server in `server/` (AI lines, debrief, co-op relay) is optional and every call must fail quietly.
- Every hand gesture keeps a poke/click alternative, and the game stays seated and hands-first (Meta VR Start Developer Competition 2026, Gaming track, New Experience).
- 60 fps on Quest 3 matters more than new effects.
- Never commit secrets. Server keys live only in `server/deploy/.env` (git-ignored); never print their values.
