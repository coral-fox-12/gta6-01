// probe.mjs — one-off diagnostics for round-2 failures. Prints game-time rate,
// viper patrol motion, ped motion, and the click->shoot path in detail.
// Usage: node probe.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = 8125;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    `--remote-debugging-port=9335`, `--user-data-dir=/tmp/gta6-probe-${Date.now()}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 40; i += 1) {
      try { targets = await (await fetch('http://127.0.0.1:9335/json')).json(); break; }
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }

    // 1. Game-time rate on the title screen.
    const t0 = await evalJs('({ gt: window.__solmar.game.time, lt: window.__solmar.game.trafficLights.time })');
    await sleep(5000);
    const t1 = await evalJs('({ gt: window.__solmar.game.time, lt: window.__solmar.game.trafficLights.time })');
    console.log('TITLE game-time rate:', JSON.stringify({ dGame: +(t1.gt - t0.gt).toFixed(2), dLights: +(t1.lt - t0.lt).toFixed(2), overReal: 5 }));

    // 2. Ped motion on the title screen (no heading override — free walk).
    const p0 = await evalJs('({ x: window.__solmar.game.peds[0].x, z: window.__solmar.game.peds[0].z, speed: window.__solmar.game.peds[0].speed, state: window.__solmar.game.peds[0].state })');
    await sleep(5000);
    const p1 = await evalJs('({ x: window.__solmar.game.peds[0].x, z: window.__solmar.game.peds[0].z, state: window.__solmar.game.peds[0].state })');
    console.log('PED 5s:', JSON.stringify({ p0, p1, moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) }));

    // 3. New Game, then viper patrol motion + game-time rate while playing.
    await evalJs("document.getElementById('btn-new').click()");
    await sleep(1000);
    const g0 = await evalJs('({ gt: window.__solmar.game.time, v: window.__solmar.game.gangs.members.map(e => ({ n: e.name, x: +e.x.toFixed(2), z: +e.z.toFixed(2), s: e.state, pi: e.patrolIdx, pw: +e.patrolWait.toFixed(2), h: +e.heading.toFixed(2) })) })');
    await sleep(10000);
    const g1 = await evalJs('({ gt: window.__solmar.game.time, v: window.__solmar.game.gangs.members.map(e => ({ n: e.name, x: +e.x.toFixed(2), z: +e.z.toFixed(2), s: e.state, pi: e.patrolIdx, pw: +e.patrolWait.toFixed(2), h: +e.heading.toFixed(2) })) })');
    console.log('PLAYING game-time rate:', JSON.stringify({ dGame: +(g1.gt - g0.gt).toFixed(2), overReal: 10 }));
    for (let i = 0; i < g0.v.length; i += 1) {
      console.log('VIPER', g0.v[i].n, 'moved', +Math.hypot(g1.v[i].x - g0.v[i].x, g1.v[i].z - g0.v[i].z).toFixed(2), 'state', g0.v[i].s, '->', g1.v[i].s, 'patrolIdx', g0.v[i].pi, '->', g1.v[i].pi, 'wait', g0.v[i].pw, '->', g1.v[i].pw);
    }

    // 4. Click->shoot path: teleport next to a Viper, aim, click, read fast.
    await evalJs('(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(-128, -116); })()');
    await sleep(1500);
    const aim = await evalJs(`(() => {
      const g = window.__solmar.game;
      const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
      g.player.camYaw = Math.atan2(v.x - g.player.x, v.z - g.player.z);
      g.player.camPitch = 0.32;
      return { name: v.name, vx: v.x, vz: v.z, health: v.health };
    })()`);
    await sleep(600);
    const before = await evalJs('({ cd: window.__solmar.game.combat.fireCooldown, tracers: window.__solmar.game.combat.tracers.length, state: window.__solmar.game.state })');
    await click(640, 360);
    await sleep(60);
    const after = await evalJs(`(() => {
      const g = window.__solmar.game;
      return { cd: +g.combat.fireCooldown.toFixed(3), tracers: g.combat.tracers.length, v: g.combat.enemies.filter((e) => e.faction === 'viper').map((e) => ({ n: e.name, h: e.health, s: e.state })), pedsDown: g.peds.filter((p) => p.state === 'down').length, aggro: g.combat.gangAggro };
    })()`);
    console.log('SHOOT aim:', JSON.stringify(aim), 'before:', JSON.stringify(before), 'after:', JSON.stringify(after));
    // 5. Same shot, but called directly (bypasses the click path).
    const direct = await evalJs(`(() => {
      const g = window.__solmar.game;
      g.combat.fireCooldown = 0;
      const origin = g.camera.position.clone();
      const dir = g.camera.getWorldDirection(new (origin.constructor)(0, 0, 0));
      const r = g.combat.playerShoot(origin, dir, g.colliders, g.peds, g.player);
      return { result: r ? r.type : null, enemy: r?.enemy?.name ?? null, health: r?.enemy?.health ?? null, aggro: g.combat.gangAggro, tracers: g.combat.tracers.length };
    })()`);
    console.log('SHOOT direct playerShoot:', JSON.stringify(direct));
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
