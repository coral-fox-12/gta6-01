# PROGRESS — SOLMAR BAY (gta6-01)

## Status: first playable + polish pass done (2026-11-17 late evening, VN)

## Done
- Repo created: https://github.com/coral-fox-12/gta6-01 (public, created after open).
  Anchor + MIT LICENSE commits intact; remote origin set; gh CLI PAT lacks
  `read:org` scope, so repo was created via the GitHub API with the saved PAT
  (token never printed). Push via a local credential helper reading the PAT file.
- Vendor: `vendor/makefun-game.ts` (kit copy, byte-identical), three.js 0.170.0
  min bundle vendored at `game/vendor/three.module.min.js` (npm pack, /tmp).
- `main.ts` (hand-in program, retyped) + `serve.ts` (static server, retyped).
- Game source written (all typed in-session): `index.html` (HUD/title/pause/
  end screens, import map), `src/util.js`, `src/audio.js` (WebAudio synth),
  `src/city.js` (procedural coastal city, beach, landmarks, colliders),
  `src/vehicles.js` (cars, driving physics, traffic AI, parked cars),
  `src/peds.js` (sidewalk pedestrians, flee/knock-down), `src/player.js`
  (third-person on-foot + camera + enter/exit), `src/police.js` (wanted 1–5,
  police cars + foot cops, chase/ram/arrest, decay), `src/combat.js`
  (hitscan shooting, tracers, enemies, punch, cash drops), `src/missions.js`
  (5 story missions: Wheels Up, The Drop, Heat Wave, The Big Score,
  Harbor Lights), `src/hud.js` (health/money/stars/clock/objective + live
  minimap), `src/shots.js` (?shot= staging: start/drive/chase/street),
  `src/main.js` (bootstrap, loop, crimes, save/load via localStorage).
- README.md written.

## Verified (headless Chromium, 2026-11-17 ~23:50 VN)
- [x] Serve game/ and load: zero console errors, zero failed requests on all
      four ?shot= scenes and on a plain load.
- [x] Screenshots taken as real renders (1280x720, headless Chromium via a
      stdlib-only CDP driver in /tmp/gta6-shots/drive.mjs): 1-chase (3-star
      chase, 57 km/h, police light bar visible), 2-drive (Marina road,
      53 km/h, sea ahead), 3-street (on foot in Downtown), 4-start (title
      screen, full panel fits 720p). Compressed to JPEG ≤256 KiB each into
      screenshots/ (1-chase.jpg first = cover).
- [x] `MAKEFUN_OUTPUT_DIR=/tmp/gta6-out node main.ts` builds dossier.json
      (4 images, text 115,601 chars) + out/game + out/screenshots. The
      DossierError was an empty screenshots/ dir, not a main.ts bug; main.ts
      now also fails fast with a clear message when screenshots/ is empty.
- [x] Camera fixes: in-car camera pulls in around buildings (was ending
      inside facades); car-car push bug fixed (cars no longer overlap);
      chase/drive staging positions moved onto road centrelines; drive shot
      has autopilot; title screen fits 720p; transient toasts cleared
      before captures. Viewport forced to true 1280x720 via CDP
      Emulation.setDeviceMetricsOverride (--window-size alone gave 528 px
      tall). Fresh Chrome profile per capture run (a reused profile served
      a stale cached shots.js).

## Polish pass (same session)
- Mission 5 "Harbor Lights": meet Vera's contact on the Boardwalk, take down
  3 Harbor Rats, lose the heat ($4,000). Fixed the defeat-step spawn bug:
  spawns are now keyed by mission id (the old code only ever spawned bank
  guards, once, so a second defeat mission could never complete).
- Drive-by shooting: click fires from a car, crosshair stays visible while
  driving; enemies' hit chance now falls with the target's speed.
- Solmar lighthouse at the tip of Pier 9 (striped tower + glowing lamp).
- Pedestrians dive out of the way of speeding cars; any gunfire (hit or
  miss) scares nearby peds.
- Hiding on foot cools wanted 35% faster than hiding in a car.
- Busted / flatlined end screens now play their own sound stings.
- `util.js` gained a seeded `shuffle()` (used for the Harbor Rats' spots);
  `serve.ts` prints the ?shot= URLs on start.

## To verify (next)
- [x] Walk (WASD), enter a car with E, drive; wanted + police on car theft.
- [x] Mission 1 starts and completes (steal car → Marina marker, $500).
- [x] HUD + minimap render; save/load works.
- [x] Re-take 2-drive + 4-start after the polish pass (lighthouse + 5th
      mission change those frames), re-run main.ts, commit + push.

## Play test (scripted CDP run, /tmp/gta6-shots/playtest.mjs, 2026-11-17 ~00:05 VN)
- New Game → playing, wheels-up objective correct. Walk (real W key event)
  moved 3.45 m. E steals a car (wanted 1, objective advances). Drive moves
  the car; a real mouse click from the car fires a drive-by shot (tracer 1).
- Mission 1 completes at the Marina marker ($750 total). Mission 2 pickup
  at Pier 9 + deliver to the Rookery ($1,550). Mission 4 bank → 4 guards
  spawn → fight → grab → escape ($4,550). Save/load round-trips money
  $4,550 + mission index 4. Mission 5 full flow: contact → 3 Harbor Rats
  (wanted 2) → lose heat → done ($8,550, isDone true). Lighthouse present.
- **Zero console errors, zero failed requests** (the earlier pointer-lock
  rejection is fixed with a catch).
- **Bug found by the play test (fixed): mission markers sat on landmark
  CENTRES, but landmarks have colliders — the player could never get within
  the marker radius, so missions 1, 2 and 4 were uncompletable.** Markers
  moved to the street beside each landmark: Marina (190,-116), Rookery
  (-58,104), Bay Bank (58,46). Pier 9 lowered from a 4 m solid box to a
  0.6 m deck so the player is not swallowed by it on the pickup.

## Known rough edges / to improve after first playable
- No shadow maps (perf choice for headless SwiftShader); blob shadows only.
- Traffic AI is simple lane-following; no traffic lights.
- Enemy AI: bank guards + Harbor Rats only (no roaming gangs yet).
- City textures are procedural canvas art (no image assets).
- Police cars use the same arcade physics; ramming is a simple push.
