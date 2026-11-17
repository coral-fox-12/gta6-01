// probe2.mjs — why does the player's ray miss a Viper at point-blank range?
// Prints the tracer endpoint, hitWall, and a manual ray from the player.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = 8126;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    `--remote-debugging-port=9336`, `--user-data-dir=/tmp/gta6-probe2-${Date.now()}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 40; i += 1) {
      try { targets = await (await fetch('http://127.0.0.1:9336/json')).json(); break; }
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
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }
    await evalJs("document.getElementById('btn-new').click()");
    await sleep(1000);
    await evalJs('(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(-128, -116); })()');
    await sleep(1500);
    const shot1 = await evalJs(`(() => {
      const g = window.__solmar.game;
      g.combat.fireCooldown = 0;
      const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
      g.player.camYaw = Math.atan2(v.x - g.player.x, v.z - g.player.z);
      g.player.camPitch = 0.32;
      const origin = g.camera.position.clone();
      const dir = g.camera.getWorldDirection(origin.clone());
      const r = g.combat.playerShoot(origin, dir, g.colliders, g.peds, g.player);
      const t = g.combat.tracers[g.combat.tracers.length - 1];
      const pos = t ? t.line.geometry.attributes.position.array : null;
      return {
        result: r ? r.type : null, hitWall: r?.hitWall ?? null,
        camPos: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)],
        dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)],
        viper: { x: +v.x.toFixed(2), z: +v.z.toFixed(2), h: v.health },
        tracerEnd: pos ? [+pos[3].toFixed(2), +pos[4].toFixed(2), +pos[5].toFixed(2)] : null,
        meshPos: [+v.mesh.position.x.toFixed(2), +v.mesh.position.y.toFixed(2), +v.mesh.position.z.toFixed(2)],
        meshWorld: v.mesh.matrixWorld.elements.slice(12, 15).map((n) => +n.toFixed(2)),
      };
    })()`);
    console.log('CAMERA-RAY SHOT:', JSON.stringify(shot1, null, 2));
    // Manual ray: from the player's head straight at the viper's chest.
    const shot2 = await evalJs(`(() => {
      const g = window.__solmar.game;
      g.combat.fireCooldown = 0;
      const v = g.combat.enemies.find((e) => e.faction === 'viper' && e.state !== 'down');
      const V3 = g.camera.position.constructor;
      const origin = new V3(g.player.x, 1.6, g.player.z);
      const dir = new V3(v.x - g.player.x, 1.35 - 1.6, v.z - g.player.z).normalize();
      const r = g.combat.playerShoot(origin, dir, g.colliders, g.peds, g.player);
      const t = g.combat.tracers[g.combat.tracers.length - 1];
      const pos = t ? t.line.geometry.attributes.position.array : null;
      return {
        result: r ? r.type : null, hitWall: r?.hitWall ?? null, enemy: r?.enemy?.name ?? null,
        viperHealth: v.health, aggro: g.combat.gangAggro,
        tracerEnd: pos ? [+pos[3].toFixed(2), +pos[4].toFixed(2), +pos[5].toFixed(2)] : null,
      };
    })()`);
    console.log('MANUAL-RAY SHOT:', JSON.stringify(shot2, null, 2));
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('PROBE2 FAILED', e); process.exit(1); });
