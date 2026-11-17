// playtest2.mjs — round-2 verification for SOLMAR BAY (traffic lights, Vipers
// gang, mission 6) in headless Chromium. Same CDP approach as playtest.mjs.
// LESSON (measured 18/11): headless swiftshader runs the game at ~0.01-0.02x
// real time (dt is clamped to 0.05 s/frame and frames take ~2 s), so EVERY wait
// in this script is keyed to GAME time (window.__solmar.game.time), never to
// fixed real seconds. Pure-math checks (phaseOf) are verified directly.
// Usage: node playtest2.mjs [--port 8124]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || 8124);
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    `--remote-debugging-port=9334`, `--user-data-dir=/tmp/gta6-playtest2-${Date.now()}`,
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
      try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); break; }
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
    const gameTime = () => evalJs('window.__solmar.game.time');
    // Wait until `seconds` of GAME time have passed (polls every 2 s real).
    // Returns the game seconds actually advanced.
    const waitGame = async (seconds, capRealMs = 300000) => {
      const t0 = await gameTime();
      const start = Date.now();
      while (Date.now() - start < capRealMs) {
        await sleep(2000);
        const t = await gameTime();
        if (t - t0 >= seconds) return +(t - t0).toFixed(2);
      }
      return +(await gameTime() - t0).toFixed(2);
    };
    // Wait until `fn` (evaluated in-page, returns truthy) or the real cap.
    const waitFor = async (expr, capRealMs = 120000, pollMs = 1000) => {
      const start = Date.now();
      while (Date.now() - start < capRealMs) {
        const v = await evalJs(expr);
        if (v) return v;
        await sleep(pollMs);
      }
      return await evalJs(expr);
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }
    const out = {};
    const state = () => evalJs('window.__solmar.getState()');

    // ---------- A. Title screen: lights cycle + ped kerb rule ----------
    // A1. 25 lights; the cycle math is verified directly (pure function), and
    // the live loop is verified by watching game time advance the summary.
    const sum0 = await evalJs('window.__solmar.getState().lights');
    out.lights0 = sum0;
    check('lights-count-25', sum0?.lights === 25, sum0);
    check('lights-phases-sum-50', sum0 && sum0.green + sum0.yellow + sum0.red === 50, sum0);
    const cycleTable = await evalJs(`(() => {
      const g = window.__solmar.game;
      const l = g.trafficLights.lights[12]; // a mid-grid light
      const at = (t) => ({ z: g.trafficLights.phaseOf(l, 'z', t), x: g.trafficLights.phaseOf(l, 'x', t) });
      return { t0: at(0), t4: at(4), t9: at(9), t11: at(11), t19: at(19) };
    })()`);
    out.cycleTable = cycleTable;
    check('cycle-math', cycleTable.t0.z === 'green' && cycleTable.t0.x === 'red'
      && cycleTable.t9.z === 'yellow' && cycleTable.t11.x === 'green'
      && cycleTable.t19.z === 'red' && cycleTable.t19.x === 'yellow', cycleTable);
    const adv = await waitGame(1.5, 300000);
    const sum1 = await evalJs('window.__solmar.getState().lights');
    out.lights1 = sum1;
    out.lightsGameAdvanced = adv;
    check('lights-cycle-turns-live', adv >= 1.5 && JSON.stringify(sum0) !== JSON.stringify(sum1), { adv, sum0, sum1 });

    // A2/A3. Ped kerb rule. Spots are picked by CURRENT phase (with >=4 s of
    // game time left in that phase), so no clock manipulation is needed:
    // a green-phase kerb for the wait test, a red-phase kerb for the cross test.
    const pickSpots = `(() => {
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
    })()`;
    const spots = await evalJs(pickSpots);
    out.pedSpots = spots;
    check('ped-spots-found', !!spots.green && !!spots.red, spots);
    const placePed = (idx, spot) => evalJs(`(() => {
      const g = window.__solmar.game; const p = g.peds[${idx}];
      p.state = 'walk'; p.x = ${spot.x}; p.z = ${spot.z};
      p.heading = Math.PI; p.targetHeading = Math.PI;
      p.mesh.position.set(p.x, 0, p.z); return { x: p.x, z: p.z };
    })()`);
    const holdHeading = (idx) => evalJs(`window.__solmar.game.peds[${idx}].targetHeading = Math.PI; window.__solmar.game.peds[${idx}].heading = Math.PI;`);
    const pedPos = (idx) => evalJs(`({ x: window.__solmar.game.peds[${idx}].x, z: window.__solmar.game.peds[${idx}].z })`);
    if (spots.green) {
      // Wait test: the ped walks ~1.1 m to the kerb (0.65 s game), then must
      // stand there while the light stays green. Measure movement only in the
      // second half of the window (after it has reached the kerb).
      await placePed(0, spots.green);
      const t0 = await gameTime();
      let pKer = null;
      const startW = Date.now();
      while (Date.now() - startW < 300000) {
        await holdHeading(0);
        await sleep(2000);
        const t = await gameTime();
        if (t - t0 >= 0.7) { pKer = await pedPos(0); break; }
      }
      const advW = await waitGame(1.0, 300000);
      const pEnd = await pedPos(0);
      const waitMoved = pKer ? Math.hypot(pEnd.x - pKer.x, pEnd.z - pKer.z) : null;
      out.pedWait = { spot: spots.green, atKerb: pKer, atEnd: pEnd, movedAfterKerb: waitMoved === null ? null : +waitMoved.toFixed(2), gameAdvanced: advW };
      check('ped-waits-on-green', waitMoved !== null && waitMoved < 0.4, out.pedWait);
    }
    if (spots.red) {
      // Cross test: on red the ped must walk straight across the road.
      await placePed(1, spots.red);
      const c0 = await pedPos(1);
      const advC = await waitGame(2.0, 300000);
      const c1 = await pedPos(1);
      const crossMoved = Math.hypot(c1.x - c0.x, c1.z - c0.z);
      out.pedCross = { spot: spots.red, from: c0, to: c1, moved: +crossMoved.toFixed(2), gameAdvanced: advC };
      check('ped-crosses-on-red', crossMoved > 2.5, out.pedCross);
    }

    // ---------- B. New Game: traffic stops at a red light ----------
    await evalJs("document.getElementById('btn-new').click()");
    await waitGame(0.15, 60000);
    let stoppedAtRed = null;
    const startB = Date.now();
    while (Date.now() - startB < 240000) {
      const hit = await evalJs(`(() => {
        const g = window.__solmar.game;
        for (const c of g.cars) {
          if (c.role !== 'traffic') continue;
          const a = g.trafficLights.lightAhead(c.x, c.z, c.routeAxis, c.routeDir);
          if (a && a.dist >= 8 && a.dist < 16 && a.phase !== 'green' && Math.abs(c.speed) < 1) {
            return { x: +c.x.toFixed(1), z: +c.z.toFixed(1), speed: +c.speed.toFixed(2), dist: +a.dist.toFixed(1), phase: a.phase };
          }
        }
        return null;
      })()`);
      if (hit) { stoppedAtRed = hit; break; }
      await sleep(1000);
    }
    out.trafficStoppedAtRed = stoppedAtRed;
    check('traffic-stops-at-red', !!stoppedAtRed, stoppedAtRed);

    // ---------- C. Gangs: patrol, hostility, gang-wide aggro ----------
    const vipers0 = await evalJs('window.__solmar.game.gangs.members.map(e => ({ name: e.name, faction: e.faction, x: +e.x.toFixed(1), z: +e.z.toFixed(1), state: e.state }))');
    out.vipers0 = vipers0;
    check('gang-count-6', vipers0.length === 6, vipers0.length);
    check('gang-all-viper-faction', vipers0.every((v) => v.faction === 'viper'), vipers0);
    // Patrol: poll until one Viper has walked > 2 m (needs ~0.85 s game time).
    let patrolMoved = null;
    const startC = Date.now();
    while (Date.now() - startC < 240000) {
      const v1 = await evalJs('window.__solmar.game.gangs.members.map(e => ({ name: e.name, x: +e.x.toFixed(1), z: +e.z.toFixed(1) }))');
      patrolMoved = v1.map((v) => {
        const before = vipers0.find((b) => b.name === v.name);
        return before ? +Math.hypot(v.x - before.x, v.z - before.z).toFixed(1) : 0;
      });
      if (patrolMoved.some((d) => d > 2)) break;
      await sleep(2000);
    }
    out.patrolMoved = patrolMoved;
    check('gang-patrols-move', patrolMoved && patrolMoved.some((d) => d > 2), patrolMoved);
    // Hostility + shooting: walk into the Docks turf on foot; vipers must
    // attack, and (kept polling, not breaking on attack) a tracer or a health
    // drop must be observed. Tracers live 0.12 s game (~6-12 s real here), so
    // a 1 s real poll catches them.
    await evalJs('(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(-128, -116); })()');
    await waitGame(0.15, 60000);
    let attacked = null;
    let sawTracer = false;
    let healthDrop = null;
    const startH = Date.now();
    while (Date.now() - startH < 300000) {
      const s = await evalJs(`(() => {
        const g = window.__solmar.game;
        return { attack: g.combat.enemies.some((e) => e.faction === 'viper' && e.state === 'attack'), health: g.player.health, tracers: g.combat.tracers.length };
      })()`);
      if (s.attack && !attacked) attacked = s;
      if (s.tracers > 0) sawTracer = true;
      if (s.health < 100 && healthDrop === null) healthDrop = s.health;
      if (attacked && (sawTracer || healthDrop !== null)) break;
      await sleep(1000);
    }
    out.gangHostility = { attacked, sawTracer, healthDrop };
    check('gang-attacks-in-turf', !!attacked, out.gangHostility);
    check('gang-shoots', sawTracer || healthDrop !== null, out.gangHostility);
    // Gang-wide aggro: shoot one Viper through the REAL input path (aim the
    // camera, click at screen centre). First wait for the camera to damp onto
    // the teleported player — at the headless frame rate it lags minutes behind
    // a teleport, and a shot from the stale title-orbit camera hits a wall.
    const camOk = await waitFor('(() => { const g = window.__solmar.game; return Math.hypot(g.camera.position.x - g.player.x, g.camera.position.z - g.player.z) < 10; })()', 180000, 2000);
    out.cameraConverged = !!camOk;
    check('camera-converged', !!camOk, camOk);
    let aggro = null;
    for (let attempt = 0; attempt < 2 && !(aggro && aggro.gangAggro); attempt += 1) {
      const aim = await evalJs(`(() => {
        const g = window.__solmar.game;
        const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
        if (!v) return null;
        g.player.camYaw = Math.atan2(v.x - g.player.x, v.z - g.player.z);
        g.player.camPitch = 0.32;
        return { name: v.name, health: v.health };
      })()`);
      out['gangAggroAim' + attempt] = aim;
      await waitGame(0.1, 60000);
      const aimDot = await evalJs(`(() => {
        const g = window.__solmar.game;
        const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
        if (!v) return 0;
        const dir = g.camera.getWorldDirection(g.camera.position.clone());
        const dx = v.x - g.camera.position.x, dy = 1.35 - g.camera.position.y, dz = v.z - g.camera.position.z;
        const len = Math.hypot(dx, dy, dz);
        return +((dir.x * dx + dir.y * dy + dir.z * dz) / len).toFixed(3);
      })()`);
      out['gangAggroAimDot' + attempt] = aimDot;
      if (aimDot < 0.95) continue;
      await click(640, 360);
      await sleep(200);
      aggro = await evalJs(`(() => {
        const g = window.__solmar.game;
        const px = g.player.x, pz = g.player.z;
        return {
          gangAggro: g.combat.gangAggro,
          vipers: g.combat.enemies.filter((e) => e.faction === 'viper').map((e) => ({ name: e.name, state: e.state, health: e.health, dist: +Math.hypot(e.x - px, e.z - pz).toFixed(1) })),
        };
      })()`);
    }
    out.gangAggro = aggro;
    check('gang-aggro-set', aggro && aggro.gangAggro === true, aggro);
    // Every living Viper within 60 m must now be hunting.
    let aggro2 = null;
    const startA = Date.now();
    while (Date.now() - startA < 120000) {
      aggro2 = await evalJs(`(() => {
        const g = window.__solmar.game;
        const px = g.player.x, pz = g.player.z;
        return g.combat.enemies.filter((e) => e.faction === 'viper' && e.state !== 'down').map((e) => ({ name: e.name, state: e.state, dist: +Math.hypot(e.x - px, e.z - pz).toFixed(1) }));
      })()`);
      const inRange = aggro2.filter((v) => v.dist <= 60);
      if (inRange.length > 0 && inRange.every((v) => v.state === 'attack')) break;
      await sleep(2000);
    }
    out.gangAggroAfter = aggro2;
    const inRange2 = (aggro2 || []).filter((v) => v.dist <= 60);
    check('gang-hunts-within-60m', inRange2.length > 0 && inRange2.every((v) => v.state === 'attack'), aggro2);

    // ---------- D. Mission 6: The Serpent's Head ----------
    const moneyBefore = (await state()).money;
    await evalJs(`(() => { const g = window.__solmar.game; g.missions.restore({ index: 5, completed: ['wheels-up','the-drop','heat-wave','the-big-score','harbor-lights'] }); g.missions.startNext(); })()`);
    await waitGame(0.15, 60000);
    let m6 = await evalJs('({ id: window.__solmar.game.missions.active?.def.id, step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission6start = m6;
    check('mission6-starts', m6.id === 'serpents-head', m6);
    await evalJs('(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(-116, -140); })()');
    await waitGame(0.15, 60000);
    m6 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text, enemies: window.__solmar.game.combat.enemies.map(e => e.name), wanted: window.__solmar.game.police.wanted })');
    out.mission6fight = m6;
    check('mission6-crew-spawns', m6.enemies.includes('Serpent') && m6.enemies.filter((n) => n.startsWith('Viper')).length >= 4, m6);
    check('mission6-defeat-step', (m6.step || '').includes('Serpent'), m6);
    await evalJs(`(() => { const g = window.__solmar.game; for (const e of g.combat.enemies) { e.health = 0; e.state = 'down'; } for (let i = 0; i < 5; i += 1) g.missions.onEnemyDown(); })()`);
    await waitGame(0.15, 60000);
    m6 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission6afterFight = m6;
    check('mission6-after-fight', (m6.step || '').includes('Lose the heat'), m6);
    await evalJs('window.__solmar.game.police.setWanted(0)');
    await waitGame(0.15, 60000);
    const s6 = await state();
    out.mission6done = { money: s6.money, objective: s6.objective, done: await evalJs('window.__solmar.game.missions.isDone'), zone: await evalJs('window.__solmar.game.zoneName(-140, -140)') };
    check('mission6-pays-6000', s6.money === moneyBefore + 6000, { before: moneyBefore, after: s6.money });
    check('mission6-done', out.mission6done.done === true, out.mission6done);
    check('turf-zone-name', out.mission6done.zone === 'Viper Turf — The Docks', out.mission6done.zone);

    out.errors = errors;
    out.failures = failures;
    console.log(JSON.stringify(out, null, 2));
    if (failures.length || errors.length) {
      console.error('PLAYTEST2 FAILURES:', failures.length, 'ERRORS:', errors.length);
      process.exitCode = 1;
    }
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('PLAYTEST2 FAILED', e); process.exit(1); });
