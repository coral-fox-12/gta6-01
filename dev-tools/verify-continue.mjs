// verify-continue.mjs — round-4 verification for the Continue-button fix.
// Proves the exact player-facing flow: New Game -> earn money (mission 1) ->
// save -> quit to title -> Continue is ENABLED -> click Continue -> resume
// with money / mission / position intact. Uses the real DOM buttons
// (btn-new / btn-quit-title / btn-continue) and the real Esc pause key.
// Usage: node dev-tools/verify-continue.mjs [--port 8130]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || 8130);
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.env.HOME + '/workspace/makefun/gta6-01', stdio: 'ignore' });
  await sleep(800);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--mute-audio',
    '--remote-debugging-port=9340', `--user-data-dir=/tmp/gta6-verify-continue-${Date.now()}`,
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
      try { targets = await (await fetch('http://127.0.0.1:9340/json')).json(); break; }
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
    const stepGame = (n) => evalJs(`(() => { const g = window.__solmar.game; const dt = 1 / 60; for (let i = 0; i < ${n}; i += 1) g.updatePlaying(dt); return true; })()`);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i += 1) { if (await evalJs('window.__shotReady === true')) break; await sleep(500); }
    const out = {};
    const state = () => evalJs('window.__solmar.getState()');

    // 1. Fresh profile: no save yet -> Continue must be DISABLED at boot.
    out.continueDisabledAtBoot = await evalJs("document.getElementById('btn-continue').disabled");
    check('continue-disabled-at-boot-no-save', out.continueDisabledAtBoot === true, out.continueDisabledAtBoot);

    // 2. New Game (real button).
    await evalJs("document.getElementById('btn-new').click()");
    await sleep(1000);
    let s = await state();
    out.newGame = { state: s.state, money: s.money };
    check('new-game-playing', s.state === 'playing', out.newGame);
    check('new-game-money-250', s.money === 250, out.newGame);

    // 3. Earn money: steal a car, drive it onto the Marina marker (mission 1).
    await evalJs(`(() => { const g = window.__solmar.game; const c = g.nearestCar(500); g.player.reset(c.x + 2.5, c.z); })()`);
    await sleep(300);
    await key('KeyE', 'e', 'rawKeyDown'); await sleep(100); await key('KeyE', 'e', 'keyUp');
    await sleep(800);
    await evalJs(`(() => { const g = window.__solmar.game; const c = g.player.inCar; c.speed = 0; c.x = 190; c.z = -116; c.mesh.position.set(190, 0, -116); })()`);
    await stepGame(10);
    s = await state();
    out.mission1 = { money: s.money, mission: s.mission };
    check('mission1-completed', s.mission !== 'wheels-up' || s.money > 250, out.mission1);
    check('mission1-money-grew', s.money > 250, out.mission1);

    // 4. On foot at a distinctive spot, then save (real saveGame).
    await evalJs(`(() => { const g = window.__solmar.game; if (g.player.inCar) g.player.exitCar(); g.player.reset(100, -50); })()`);
    await stepGame(5);
    await evalJs('window.__solmar.game.saveGame()');
    const saved = await evalJs('JSON.parse(localStorage.getItem("solmar-bay-save-v1"))');
    out.saved = { money: saved?.money, missionIndex: saved?.missions?.index, px: saved?.player?.x, pz: saved?.player?.z };
    check('save-exists', !!saved, out.saved);
    check('save-money-matches', saved?.money === s.money, out.saved);

    // 5. Pause with the real Esc key (also saves), then quit to title via the
    // real "Main menu" button.
    await key('Escape', 'Escape', 'rawKeyDown'); await sleep(100); await key('Escape', 'Escape', 'keyUp');
    await sleep(500);
    s = await state();
    out.paused = { state: s.state };
    check('paused', s.state === 'paused', out.paused);
    await evalJs("document.getElementById('btn-quit-title').click()");
    await sleep(500);
    s = await state();
    out.title = {
      state: s.state,
      titleVisible: await evalJs("!document.getElementById('title-screen').classList.contains('hidden')"),
      saveStillThere: await evalJs("!!localStorage.getItem('solmar-bay-save-v1')"),
    };
    check('back-on-title', s.state === 'title', out.title);

    // 6. THE FIX: Continue must now be ENABLED on the title screen.
    out.continueDisabledAfterQuit = await evalJs("document.getElementById('btn-continue').disabled");
    check('continue-enabled-after-quit-with-save', out.continueDisabledAfterQuit === false, out.continueDisabledAfterQuit);

    // 7. Click Continue for real and confirm the resume round-trips.
    await evalJs("document.getElementById('btn-continue').click()");
    await sleep(800);
    s = await state();
    const p = await evalJs('({ x: window.__solmar.game.player.x, z: window.__solmar.game.player.z, health: window.__solmar.game.player.health })');
    out.resumed = { state: s.state, money: s.money, mission: s.mission, px: p.x, pz: p.z, health: p.health };
    check('resumed-playing', s.state === 'playing', out.resumed);
    check('resume-money-intact', s.money === saved.money, out.resumed);
    check('resume-mission-intact', s.mission === out.mission1.mission, out.resumed);
    check('resume-position-intact', Math.abs(p.x - saved.player.x) < 0.01 && Math.abs(p.z - saved.player.z) < 0.01, out.resumed);

    out.errors = errors;
    out.failures = failures;
    check('zero-console-errors', errors.length === 0, errors);
    console.log(JSON.stringify(out, null, 2));
    if (failures.length) { console.error('VERIFY-CONTINUE FAILURES:', failures.length); process.exitCode = 1; }
    else console.log('VERIFY-CONTINUE: ALL CHECKS PASSED');
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('VERIFY-CONTINUE FAILED', e); process.exit(1); });
