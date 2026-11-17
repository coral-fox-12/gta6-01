// playtest.mjs — scripted play-through of SOLMAR BAY in headless Chromium.
// Rebuilt after a VM replacement wiped /tmp — lives in the repo now so it survives.
// Exercises the real input path (CDP key/mouse events): New Game, walk, steal
// a car with E, drive, mission 1 completion, save/load, drive-by shooting,
// mission 5 (Harbor Lights) flow, and the lighthouse. Prints a JSON verdict.
// Usage: node playtest.mjs [--port 8123]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || 8123);
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    `--remote-debugging-port=9333`, `--user-data-dir=/tmp/gta6-playtest-${Date.now()}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const errors = [];
  try {
    let targets;
    for (let i = 0; i < 40; i += 1) {
      try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; }
      catch { await sleep(250); }
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      if (m.method === 'Network.loadingFailed') errors.push('NET ' + (m.params.errorText || ''));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push('HTTP' + m.params.response.status + ' ' + m.params.response.url);
      for (const w of [...waiters]) if (w(m)) waiters.splice(waiters.indexOf(w), 1);
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
    const key = async (code, k, type) => send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 });
    const holdKey = async (code, k, ms) => { await key(code, k, 'rawKeyDown'); await sleep(ms); await key(code, k, 'keyUp'); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    // Step the game's own per-frame function directly (n frames at 60 fps).
    // The headless VM runs the rAF loop at ~0.005-0.02x real time, so a fixed
    // real sleep after a teleport may span zero frames; stepping guarantees
    // the mission/police/combat updates actually process the new position.
    const stepGame = (n) => evalJs(`(() => { const g = window.__solmar.game; const dt = 1 / 60; for (let i = 0; i < ${n}; i += 1) g.updatePlaying(dt); return true; })()`);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }
    const out = {};
    const state = () => evalJs('window.__solmar.getState()');
    // getState() reports the CAR's position while driving (player.x/z freeze
    // at the entry point), so always read through it.
    const pos = async () => (await state()).player;

    // 1. New Game.
    await evalJs("document.getElementById('btn-new').click()");
    await sleep(1000);
    let s = await state();
    out.newGame = { state: s.state, mission: s.mission, objective: s.objective };

    // 2. Walk with W (real key event).
    const p0 = await pos();
    await holdKey('KeyW', 'w', 5000);
    const p1 = await pos();
    out.walk = { from: p0, to: p1, moved: Math.hypot(p1.x - p0.x, p1.z - p0.z) };

    // 3. Teleport next to a parked car, press E, check inCar + mission step 2.
    await evalJs(`(() => { const g = window.__solmar.game; const c = g.nearestCar(500); g.player.reset(c.x + 2.5, c.z); })()`);
    await sleep(300);
    await key('KeyE', 'e', 'rawKeyDown'); await sleep(100); await key('KeyE', 'e', 'keyUp');
    await sleep(800);
    s = await state();
    out.stealCar = { inCar: s.inCar, wanted: s.wanted, objective: s.objective };

    // 4. Drive with W.
    const d0 = await pos();
    await holdKey('KeyW', 'w', 5000);
    const d1 = await pos();
    const speed = await evalJs('Math.abs(window.__solmar.game.player.inCar?.speed || 0) * 3.6');
    out.drive = { from: d0, to: d1, moved: Math.hypot(d1.x - d0.x, d1.z - d0.z), speedKmh: Math.round(speed) };

    // 5. Drive-by: click while driving, expect a tracer + no error.
    await click(640, 360);
    await sleep(300);
    out.driveBy = {
      tracers: await evalJs('window.__solmar.game.combat.tracers.length'),
      cooldown: await evalJs('window.__solmar.game.combat.fireCooldown'),
    };

    // 6. Mission 1: teleport the car onto the Marina marker, expect completion.
    await evalJs(`(() => { const g = window.__solmar.game; const c = g.player.inCar; c.speed = 0; c.x = 190; c.z = -116; c.mesh.position.set(190, 0, -116); })()`);
    await stepGame(10);
    s = await state();
    out.mission1 = { money: s.money, mission: s.mission, objective: s.objective };

    // 6b. Mission 2: jump to mission 2, pick up the package at Pier 9
    // (on foot), then deliver it to the Rookery marker.
    await evalJs(`(() => { const g = window.__solmar.game; g.missions.restore({ index: 1, completed: ['wheels-up'] }); g.missions.startNext(); g.player.reset(232, -58); })()`);
    await stepGame(10);
    let m2 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission2pickup = m2;
    await evalJs('window.__solmar.game.player.reset(-58, 104)');
    await stepGame(10);
    s = await state();
    out.mission2deliver = { mission: s.mission, objective: s.objective, money: s.money };

    // 6c. Mission 4 bank + grab steps: start mission 4, walk to the bank
    // marker (step 1), defeat the guards (step 2), walk to the vault marker.
    await evalJs(`(() => { const g = window.__solmar.game; g.missions.restore({ index: 3, completed: ['wheels-up','the-drop','heat-wave'] }); g.missions.startNext(); g.player.reset(58, 46); })()`);
    await stepGame(10);
    let m4 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text, enemies: window.__solmar.game.combat.enemies.length })');
    out.mission4bank = m4;
    await evalJs(`(() => { const g = window.__solmar.game; for (const e of g.combat.enemies) { e.health = 0; e.state = 'down'; } for (let i = 0; i < 4; i += 1) g.missions.onEnemyDown(); })()`);
    await stepGame(10);
    m4 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission4afterFight = m4;
    await evalJs('window.__solmar.game.police.setWanted(0)');
    await stepGame(10);
    s = await state();
    out.mission4done = { money: s.money, objective: s.objective };

    // 7. Save / load round-trip.
    await evalJs('window.__solmar.game.saveGame()');
    const saved = await evalJs('JSON.parse(localStorage.getItem("solmar-bay-save-v1"))');
    await evalJs('window.__solmar.game.loadGame()');
    s = await state();
    out.saveLoad = { savedMoney: saved?.money, savedMissionIndex: saved?.missions?.index, afterLoadMoney: s.money };

    // 8. Mission 5 flow: start it, meet the contact, defeat the Rats, lose heat.
    await evalJs(`(() => { const g = window.__solmar.game; g.missions.restore({ index: 4, completed: ['wheels-up','the-drop','heat-wave','the-big-score'] }); g.missions.startNext(); })()`);
    await sleep(500);
    let m5 = await evalJs('({ id: window.__solmar.game.missions.active?.def.id, step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission5start = m5;
    await evalJs(`(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(196, 58); })()`);
    await stepGame(10);
    m5 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text, enemies: window.__solmar.game.combat.enemies.map(e => e.name), wanted: window.__solmar.game.police.wanted })');
    out.mission5fight = m5;
    await evalJs(`(() => { const g = window.__solmar.game; for (const e of g.combat.enemies) { e.health = 0; e.state = 'down'; } g.missions.onEnemyDown(); g.missions.onEnemyDown(); g.missions.onEnemyDown(); })()`);
    await stepGame(10);
    m5 = await evalJs('({ step: window.__solmar.game.missions.currentStep()?.text })');
    out.mission5afterFight = m5;
    await evalJs('window.__solmar.game.police.setWanted(0)');
    await stepGame(10);
    s = await state();
    out.mission5done = { money: s.money, objective: s.objective, done: await evalJs('window.__solmar.game.missions.isDone') };

    // 9. Lighthouse present.
    out.lighthouse = await evalJs('window.__solmar.game.city.buildings.some(b => b.name === "Solmar Lighthouse")');
    out.errors = errors;
    console.log(JSON.stringify(out, null, 2));
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('PLAYTEST FAILED', e); process.exit(1); });
