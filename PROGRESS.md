# PROGRESS — SOLMAR BAY (gta6-01)

## Status: first playable version in progress (2026-11-17 evening, VN)

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
  (4 story missions: Wheels Up, The Drop, Heat Wave, The Big Score),
  `src/hud.js` (health/money/stars/clock/objective + live minimap),
  `src/shots.js` (?shot= staging: start/drive/chase/street), `src/main.js`
  (bootstrap, loop, crimes, save/load via localStorage).
- README.md written.

## To verify (next)
- [ ] Serve game/ and load in headless Chromium: zero console errors, zero
      failed requests.
- [ ] Walk (WASD), enter a car with E, drive; wanted + police on car theft.
- [ ] Mission 1 starts and completes (steal car → Marina marker).
- [ ] HUD + minimap render; save/load works.
- [ ] Take 4 real screenshots (1-chase, 2-drive, 3-street, 4-start), each
      ≤256 KiB, long side ≤1280, short side ≥480.
- [ ] `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` succeeds;
      verify out/dossier.json + out/game + out/screenshots.
- [ ] Commit + push, report first playable version to parent.

## Known rough edges / to improve after first playable
- No shadow maps (perf choice for headless SwiftShader); blob shadows only.
- Traffic AI is simple lane-following; no traffic lights.
- No drive-by shooting; combat is on-foot only.
- Enemy AI: guards only (no roaming gangs yet).
- City textures are procedural canvas art (no image assets).
- Wanted decay is time-based when unseen; no "hiding in alley" bonus yet.
- Police cars use the same arcade physics; ramming is a simple push.
