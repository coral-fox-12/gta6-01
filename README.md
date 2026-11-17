# SOLMAR BAY — an open-world crime game

An original open-world crime game that runs offline in a desktop browser from static
files. Built for the make.fun **gta6-01** competition ("Make GTA 6"). Everything is
original: the city, characters, vehicles, story, art and music. Nothing from Rockstar
Games or any other commercial game.

## The story

Rook Marlowe swore he was out. Then his sister Lena borrowed $40,000 from Vera Kross —
the fixer who owns Solmar Bay after dark. Five jobs. One week. Pay it off, or the Bay
keeps them both.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests: every script is a file under `game/`
(three.js is vendored as `game/vendor/three.module.min.js`).

| Key | Action |
| --- | --- |
| W A S D | Move on foot / drive — Shift to sprint |
| Mouse | Look (click the game to lock the cursor) |
| E | Steal / enter / exit a car |
| Click | Shoot (on foot or from a car — drive-by) |
| F | Punch |
| Space | Jump / handbrake |
| P / Esc | Pause — M mute |

## What's in the game

- **A city to explore** — Solmar Bay: a coastal street grid with downtown towers, a
  beach and boardwalk, a park, a plaza, the Marina, Old Town, Palm Row, the Docks,
  and the Solmar lighthouse at the tip of Pier 9.
- **On foot and by car** — third-person walking, running and jumping; arcade driving
  with steering, braking and handbrake. Steal any parked or traffic car.
- **Traffic and pedestrians** — AI cars follow the street grid and brake for the car
  ahead; citizens stroll the sidewalks, flee from gunfire and crime, and dive out
  of the way of speeding cars.
- **Wanted level + police** — 1–5 stars. Stealing cars, hitting pedestrians and
  assault raise heat. SBPD interceptors chase and ram; foot cops chase and arrest.
  Break line of sight and stay hidden to cool off — hiding on foot cools heat
  faster than hiding in a car.
- **Five story missions** — Wheels Up, The Drop, Heat Wave, The Big Score,
  Harbor Lights — with map markers, dialogue, objectives, pass/fail and cash
  rewards.
- **Combat** — hitscan pistol with tracer and muzzle flash (including drive-by
  shooting from a car), melee punches, armed bank guards and Harbor Rats who
  shoot back, health and slow regen, cash pickups.
- **HUD + live minimap** — health, money, wanted stars, clock, district name,
  mission objective, and a minimap showing roads, the player arrow, traffic,
  police and the mission marker.
- **Start screen, pause, save/load** — progress (money, missions, position) saves
  to localStorage automatically; Continue resumes it.
- **Sound** — fully synthesized WebAudio: engine hum, police sirens, gunshots,
  pickup chimes and an original bass loop. No audio files.

## Screenshots

`?shot=start` shows the title screen, `?shot=drive` a drive through the Marina,
`?shot=chase` a 3-star police chase, `?shot=street` on-foot play in Downtown.
Each is a real render of the live game (see `game/src/shots.js`).

## Layout

- `main.ts` — the hand-in program (Node 22, stdlib only): copies `game/` +
  `screenshots/` to `/output` and writes `dossier.json`.
- `serve.ts` — tiny static server for local play.
- `game/index.html` — the game page (import map for three.js).
- `game/src/` — the game's own source, one job per file: `main.js` (bootstrap +
  loop), `city.js`, `vehicles.js`, `peds.js`, `player.js`, `police.js`,
  `combat.js`, `missions.js`, `hud.js`, `audio.js`, `shots.js`, `util.js`.
- `game/vendor/three.module.min.js` — vendored three.js 0.170.0.
- `screenshots/` — 4 real renders of the game.

## License

MIT — see `LICENSE`.
