# Physical headset acceptance test

Status: NOT RUN by this change. Automated and emulator results are separate evidence.

Record tester, date, device, OS/browser, deployed commit, lighting, table/room, Assist setting and room/depth permissions. Open `?debug` and copy the local gesture report after exiting.

| Test | Pass condition | Evidence |
| --- | --- | --- |
| Hands-only launch | Permissions, launch and first shift without controllers | Pending |
| First permit | New player grants within 60 seconds without verbal help | Pending |
| Gestures | Grant, reject, stop one/all, pause and gold work reliably | Pending |
| Accidental input | Resting/reaching does not repeatedly trigger actions | Pending |
| Tracking recovery | Hide/restore hands; no unintended grant or stuck token | Pending |
| Placement | Usable height on two tables; cyan handle works | Pending |
| Missing permissions | Decline room/depth access; fallback remains playable | Pending |
| Real objects | Compatible depth hardware: mug blocks cells after hand leaves; removal clears them | Pending |
| Seated reach | Essential actions fit a comfortable two-foot radius | Pending |
| Narrow FoV | Status, permits, pause and actions remain easy to find | Pending |
| One hand / Assist | Campaign remains playable with enlarged alternatives | Pending |
| Pause/resume | Board/palm pause and system interruption preserve usable state | Pending |
| Retry | Campaign, Daily and Overtime restart their own modes | Pending |
| Exit/re-entry | Exit returns to browser; next entry succeeds | Pending |
| Denied XR entry | Cancel/deny entry; page and retry buttons return | Pending |
| Offline server | Solo works with companion server unreachable | Pending |
| Co-op setup | Host/join with letter buttons using hand rays; erase/cancel work | Pending |
| Co-op play | Both players act/pause; disconnect returns usable solo state | Pending |
| Performance | Sustain at least 60 fps on target Quest in L7/Overtime | Pending |
| Cold start | Record uncached URL-to-playable-shift time | Pending |

Run a busy scenario for at least ten minutes and record frame lows, performance guard level, thermal duration and whether depth/effects were disabled. Emulator frame rate cannot establish hardware performance. Capture failures as well as successes and resolve blockers before submitting.
