# Clearance — 2:40 demonstration

Use actual gameplay capture. Label emulator material “Emulator gameplay — synthetic room”. Film real-object depth interaction on compatible hardware or explicitly identify it as emulated; omit failed/unverified demonstrations. Do not claim measured Quest performance without hardware results.

| Time | Picture | Narration |
| --- | --- | --- |
| 0:00–0:15 | Hand grants the first permit | “Tiny robots plan. Nothing moves without your clearance. This is a game about deciding when autonomous robots have earned your trust.” |
| 0:15–0:40 | Flick away a spill shortcut; safe route appears | “You never steer them. They choose the work and show their plans. Some cut corners. Reject the shortcut and watch it find a safer way.” |
| 0:40–1:00 | Palm stops a robot approaching a worker | “Your permission matters. Your palm can stop a robot before someone gets hurt.” |
| 1:00–1:20 | Flat-hand blocking; real mug only if verified | “The space around you changes the puzzle. Close a lane with your hand, and the crew has to work around it.” |
| 1:20–1:55 | Gold delegation, autonomous work, revocation | “Eventually you cannot approve every move. Gold clearance lets a robot work alone. Who deserves that freedom? And when should you take it back?” |
| 1:55–2:15 | Ghost hand, Assist and one-handed buttons | “Gestures are taught on the board. Assist mode makes recognition more forgiving and action buttons larger.” |
| 2:15–2:35 | Shift results, crew, Daily and Overtime | “Seven short shifts build your judgement. A daily puzzle and endless Overtime bring the crew back tomorrow.” |
| 2:35–2:40 | Title and final playable URL | “Clearance. Their plans. Your permission.” |

## Capture

With the preview server running, `node scripts/film.cjs firstPermit flick palmStop handWall gold` records emulator scenes. It requires Playwright/Chromium and ffmpeg. Inspect `scripts/reel.py` for assembly inputs. Review clips for failed or misleading actions before export.

Set `FFMPEG` to an encoder executable if it is not on PATH. On slow software renderers, `W=640`, `H=360`, `FPS=15`, and `OUT=film/draft` create a smaller review draft. The reel scales clips to 720p for captions; that does not add detail or establish headset performance. Re-record at the defaults for a higher-quality final cut when hardware permits.

Upload the final video publicly to YouTube or Vimeo, verify visibility signed out, and put its URL into Devpost. Keep runtime strictly below three minutes. Avoid generated gameplay and unsupported claims.
