// probe3.mjs — FAST round-2 verification. The headless VM runs the game at
// ~0.005-0.02x real time, so instead of waiting on the rAF loop this probe
// drives the game's OWN per-frame functions directly (updatePlaying,
// updateEnemies, Ped.update, TrafficLights.update) with fixed dt steps inside
// evaluate — the exact code the loop calls, just stepped synchronously.
// The click test uses the real input path (canvas mousedown -> tryShoot).
// Usage: node probe3.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = 8128;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    `--remote-debugging-port=9338`, `--user-data-dir=/tmp/gta6-probe3-${Date.now()}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const errors = [];
  const failures = [];
  const check = (name, cond, info) => {
    if (!cond) failures.push(name + (info !== undefined ? ' :: ' + JSON.stringify(info) : ''));
    return cond;
  };
  try {
    let targets;
    for (let i = 0; i < 40; i += 1) {
      try { targets = await (await fetch('http://127.0.0.1:9338/json')).json(); break; }
      catch { await sleep(250); }
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      if (m.method === 'Network.loadingFailed') errors.push('NET ' + (m.params.errorText || ''));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push('HTTP' + m.params.response.status + ' ' + m.params.response.url);
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }
    const out = {};
    const state = () => evalJs('window.__solmar.getState()');

    // ---------- 1. Lights: count, cycle math, live update() ----------
    const sum0 = await evalJs('window.__solmar.getState().lights');
    out.lights0 = sum0;
    check('lights-count-25', sum0?.lights === 25, sum0);
    check('lights-phases-sum-50', sum0 && sum0.green + sum0.yellow + sum0.red === 50, sum0);
    const cycle = await evalJs(`(() => {
      const g = window.__solmar.game;
      const l = g.trafficLights.lights[12];
      const at = (t) => ({ z: g.trafficLights.phaseOf(l, 'z', t), x: g.trafficLights.phaseOf(l, 'x', t) });
      return { t0: at(0), t4: at(4), t9: at(9), t11: at(11), t19: at(19) };
    })()`);
    out.cycleTable = cycle;
    check('cycle-math', cycle.t0.z === 'green' && cycle.t0.x === 'red'
      && cycle.t9.z === 'yellow' && cycle.t11.x === 'green'
      && cycle.t19.z === 'red' && cycle.t19.x === 'yellow', cycle);
    // Drive update() directly: 2 s of cycle, twice — summary + lamp repaint.
    const stepped = await evalJs(`(() => {
      const g = window.__solmar.game;
      const before = g.trafficLights.summary();
      const lampBefore = g.trafficLights.lights[12].lampNS.material === g.trafficLights.lights[12].lampNS.material ? g.trafficLights.lights[12].lampNS.material.color.getHex() : 0;
      g.trafficLights.update(2);
      const mid = g.trafficLights.summary();
      g.trafficLights.update(2);
      const after = g.trafficLights.summary();
      return { before, mid, after, time: +g.trafficLights.time.toFixed(2), lampHex: g.trafficLights.lights[12].lampNS.material.color.getHex() };
    })()`);
    out.lightsStepped = stepped;
    check('lights-update-advances', stepped.time >= 3.9, stepped);
    check('lights-summary-changes', JSON.stringify(stepped.before) !== JSON.stringify(stepped.after), stepped);
    // The background loop also advances time on its own (slowly, but > 0).
    const lt0 = await evalJs('window.__solmar.game.trafficLights.time');
    await sleep(10000);
    const lt1 = await evalJs('window.__solmar.game.trafficLights.time');
    out.liveLightAdvance = +(lt1 - lt0).toFixed(3);
    check('lights-advance-in-live-loop', lt1 > lt0, out.liveLightAdvance);

    // ---------- 2. Peds: wait on green / cross on red (title screen) ----------
    const spots = await evalJs(`(() => {
      const g = window.__solmar.game;
      const tl = g.trafficLights;
      const pick = (want) => {
        for (const s of [-116, -58, 0, 58, 116]) {
          for (const x of [-20, -30, -10, 10, 20, 30, -40, 40]) {
            const z = s + 7.6;
            const hit = g.colliders.some((b) => x > b.minX - 0.6 && x < b.maxX + 0.6 && z > b.minZ - 0.6 && z < b.maxZ + 0.6);
            if (hit) continue;
            let best = null; let bestD = Infinity;
            for (const l of tl.lights) { const d = Math.hypot(x - l.x, z - l.z); if (d < bestD) { bestD = d; best = l; } }
            const tt = (tl.time + best.offset) % 20;
            const phase = tt < 10 ? 'red' : tt < 18 ? 'green' : 'yellow';
            const remain = phase === 'red' ? 10 - tt : phase === 'green' ? 18 - tt : 20 - tt;
            if (phase === want && remain >= 4) return { x, z, street: s, phase, remain: +remain.toFixed(1) };
          }
        }
        return null;
      };
      return { green: pick('green'), red: pick('red') };
    })()`);
    out.pedSpots = spots;
    check('ped-spots-found', !!spots.green && !!spots.red, spots);
    if (spots.green) {
      const w = await evalJs(`(() => {
        const g = window.__solmar.game;
        const p = g.peds[0];
        p.state = 'walk'; p.x = ${spots.green.x}; p.z = ${spots.green.z};
        p.heading = Math.PI; p.targetHeading = Math.PI;
        p.mesh.position.set(p.x, 0, p.z);
        const dt = 1 / 60;
        const step = (n) => {
          for (let i = 0; i < n; i += 1) {
            if (i % 10 === 0) { p.heading = Math.PI; p.targetHeading = Math.PI; }
            p.update(dt, g.colliders, g._rng(), null, null, g.trafficLights);
          }
        };
        step(60); // 1 s game: reach the kerb
        const atKerb = { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
        step(180); // +3 s game: must still be at the kerb while green
        const atEnd = { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
        return { atKerb, atEnd, moved: +Math.hypot(atEnd.x - atKerb.x, atEnd.z - atKerb.z).toFixed(2) };
      })()`);
      out.pedWait = w;
      check('ped-waits-on-green', w.moved < 0.4, w);
    }
    if (spots.red) {
      const c = await evalJs(`(() => {
        const g = window.__solmar.game;
        const p = g.peds[1];
        p.state = 'walk'; p.x = ${spots.red.x}; p.z = ${spots.red.z};
        p.heading = Math.PI; p.targetHeading = Math.PI;
        p.mesh.position.set(p.x, 0, p.z);
        const from = { x: p.x, z: p.z };
        const dt = 1 / 60;
        for (let i = 0; i < 180; i += 1) {
          if (i % 10 === 0) { p.heading = Math.PI; p.targetHeading = Math.PI; }
          p.update(dt, g.colliders, g._rng(), null, null, g.trafficLights);
        }
        const to = { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
        return { from, to, moved: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(2) };
      })()`);
      out.pedCross = c;
      check('ped-crosses-on-red', c.moved > 2.5, c);
    }

    // ---------- 3. New Game: traffic, patrol, gang hostility/aggro ----------
    await evalJs("document.getElementById('btn-new').click()");
    await sleep(2000);
    // Traffic stops at red: step the whole game 30 s and watch for a car
    // sitting at speed ~0 with a red/yellow light 8-16 m ahead.
    const traffic = await evalJs(`(() => {
      const g = window.__solmar.game;
      const dt = 1 / 60;
      for (let i = 0; i < 1800; i += 1) {
        g.updatePlaying(dt);
        for (const c of g.cars) {
          if (c.role !== 'traffic') continue;
          const a = g.trafficLights.lightAhead(c.x, c.z, c.routeAxis, c.routeDir);
          if (a && a.dist >= 8 && a.dist < 16 && a.phase !== 'green' && Math.abs(c.speed) < 1) {
            return { x: +c.x.toFixed(1), z: +c.z.toFixed(1), speed: +c.speed.toFixed(2), dist: +a.dist.toFixed(1), phase: a.phase, stepped: i };
          }
        }
      }
      return null;
    })()`);
    out.trafficStoppedAtRed = traffic;
    check('traffic-stops-at-red', !!traffic, traffic);
    // Patrol: step the enemy AI 2 s and watch a Viper walk its route.
    const patrol = await evalJs(`(() => {
      const g = window.__solmar.game;
      const before = g.gangs.members.map((e) => ({ n: e.name, x: e.x, z: e.z }));
      const dt = 1 / 60;
      for (let i = 0; i < 120; i += 1) g.combat.updateEnemies(dt, g.player, g.colliders);
      const moved = g.gangs.members.map((e) => {
        const b = before.find((x) => x.n === e.name);
        return b ? +Math.hypot(e.x - b.x, e.z - b.z).toFixed(1) : 0;
      });
      return { moved, states: g.gangs.members.map((e) => e.state) };
    })()`);
    out.patrol = patrol;
    check('gang-patrols-move', patrol.moved.some((d) => d > 2), patrol);
    const vipers0 = await evalJs('window.__solmar.game.gangs.members.map(e => ({ name: e.name, faction: e.faction }))');
    check('gang-count-6', vipers0.length === 6, vipers0.length);
    check('gang-all-viper-faction', vipers0.every((v) => v.faction === 'viper'), vipers0);
    // Hostility + shooting: walk into the turf, step 3 s of game.
    const host = await evalJs(`(() => {
      const g = window.__solmar.game;
      if (g.player.inCar) g.player.exitCar();
      g.player.reset(-128, -116);
      const dt = 1 / 60;
      let attacked = false; let sawTracer = false; let minHealth = g.player.health;
      for (let i = 0; i < 180; i += 1) {
        g.updatePlaying(dt);
        if (g.combat.enemies.some((e) => e.faction === 'viper' && e.state === 'attack')) attacked = true;
        if (g.combat.tracers.length > 0) sawTracer = true;
        if (g.player.health < minHealth) minHealth = g.player.health;
        if (attacked && (sawTracer || minHealth < 100)) break;
      }
      return { attacked, sawTracer, minHealth };
    })()`);
    out.gangHostility = host;
    check('gang-attacks-in-turf', host.attacked === true, host);
    check('gang-shoots', host.sawTracer === true || host.minHealth < 100, host);
    // Gang-wide aggro through the REAL click path. Snap the camera to its
    // target with the game's own cameraTarget (dt=1 -> k~1) so the ray is true.
    const snap = await evalJs(`(() => {
      const g = window.__solmar.game;
      const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
      if (!v) return null;
      g.player.camYaw = Math.atan2(v.x - g.player.x, v.z - g.player.z);
      g.player.camPitch = 0.32;
      g.player.cameraTarget(g.camera, 1, g.colliders, []);
      const dir = g.camera.getWorldDirection(g.camera.position.clone());
      const dx = v.x - g.camera.position.x, dy = 1.35 - g.camera.position.y, dz = v.z - g.camera.position.z;
      const len = Math.hypot(dx, dy, dz);
      return { name: v.name, health: v.health, aimDot: +((dir.x * dx + dir.y * dy + dir.z * dz) / len).toFixed(3) };
    })()`);
    out.gangAggroAim = snap;
    check('gang-aim-dot', snap && snap.aimDot > 0.95, snap);
    await click(640, 360);
    await sleep(200);
    const aggro = await evalJs(`(() => {
      const g = window.__solmar.game;
      const px = g.player.x, pz = g.player.z;
      return {
        gangAggro: g.combat.gangAggro,
        vipers: g.combat.enemies.filter((e) => e.faction === 'viper').map((e) => ({ name: e.name, state: e.state, health: e.health, dist: +Math.hypot(e.x - px, e.z - pz).toFixed(1) })),
      };
    })()`);
    out.gangAggro = aggro;
    check('gang-aggro-set', aggro.gangAggro === true, aggro);
    const hunt = await evalJs(`(() => {
      const g = window.__solmar.game;
      const dt = 1 / 60;
      for (let i = 0; i < 120; i += 1) g.combat.updateEnemies(dt, g.player, g.colliders);
      const px = g.player.x, pz = g.player.z;
      return g.combat.enemies.filter((e) => e.faction === 'viper' && e.state !== 'down').map((e) => ({ name: e.name, state: e.state, dist: +Math.hypot(e.x - px, e.z - pz).toFixed(1) }));
    })()`);
    out.gangAggroAfter = hunt;
    const inRange = hunt.filter((v) => v.dist <= 60);
    check('gang-hunts-within-60m', inRange.length > 0 && inRange.every((v) => v.state === 'attack'), hunt);

    // ---------- 4. Mission 6: The Serpent's Head ----------
    const stepGame = (n) => evalJs(`(() => { const g = window.__solmar.game; const dt = 1 / 60; for (let i = 0; i < ${n}; i += 1) g.updatePlaying(dt); return true; })()`);
    const moneyBefore = (await state()).money;
    await evalJs(`(() => { const g = window.__solmar.game; g.missions.restore({ index: 5, completed: ['wheels-up','the-drop','heat-wave','the-big-score','harbor-lights'] }); g.missions.startNext(); })()`);
    await stepGame(10);
    let m6 = await evalJs('({ id: window.__solmar.game.missions.active?.def.id, step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission6start = m6;
    check('mission6-starts', m6.id === 'serpents-head', m6);
    await evalJs('(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(-116, -140); })()');
    await stepGame(10);
    m6 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text, enemies: window.__solmar.game.combat.enemies.map(e => e.name), wanted: window.__solmar.game.police.wanted })');
    out.mission6fight = m6;
    check('mission6-crew-spawns', m6.enemies.includes('Serpent') && m6.enemies.filter((n) => n.startsWith('Viper')).length >= 4, m6);
    check('mission6-defeat-step', (m6.step || '').includes('Serpent'), m6);
    await evalJs(`(() => { const g = window.__solmar.game; for (const e of g.combat.enemies) { e.health = 0; e.state = 'down'; } for (let i = 0; i < 5; i += 1) g.missions.onEnemyDown(); })()`);
    await stepGame(10);
    m6 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission6afterFight = m6;
    check('mission6-after-fight', (m6.step || '').includes('Lose the heat'), m6);
    await evalJs('window.__solmar.game.police.setWanted(0)');
    await stepGame(10);
    const s6 = await state();
    out.mission6done = { money: s6.money, objective: s6.objective, done: await evalJs('window.__solmar.game.missions.isDone'), zone: await evalJs('window.__solmar.game.zoneName(-140, -140)') };
    check('mission6-pays-6000', s6.money === moneyBefore + 6000, { before: moneyBefore, after: s6.money });
    check('mission6-done', out.mission6done.done === true, out.mission6done);
    check('turf-zone-name', out.mission6done.zone === 'Viper Turf — The Docks', out.mission6done.zone);

    out.errors = errors;
    out.failures = failures;
    console.log(JSON.stringify(out, null, 2));
    if (failures.length || errors.length) {
      console.error('PROBE3 FAILURES:', failures.length, 'ERRORS:', errors.length);
      process.exitCode = 1;
    }
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('PROBE3 FAILED', e); process.exit(1); });
