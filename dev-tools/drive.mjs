// CDP driver for SOLMAR BAY screenshots + console-error checks (Node 22 stdlib only).
// Rebuilt after a VM replacement wiped /tmp — lives in the repo now so it survives.
// Usage: node drive.mjs --shot chase --out /tmp/gta6-shots/1-chase.png --wait 5
//        node drive.mjs --shot "" --out /tmp/gta6-shots/plain.png --wait 3   (plain load, no staging)
//        node drive.mjs --shot drive --out x.png --until "window.__solmar.game.player.inCar" --until-timeout 60
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const shot = args.get('--shot') ?? 'drive';
const out = args.get('--out') ?? '/tmp/gta6-shots/shot.png';
const waitSec = Number(args.get('--wait') ?? '4');
const untilExpr = args.get('--until') ?? null;
const untilTimeoutSec = Number(args.get('--until-timeout') ?? '60');
const PORT = 8123;
const CDP_PORT = 9223;
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const REPO = '/home/hatch/workspace/makefun/gta6-01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: REPO, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--window-size=1280,720', '--hide-scrollbars',
    '--mute-audio', '--no-first-run', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/gta6-shots/profile-${Date.now()}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    // Wait for the DevTools endpoint.
    let targets = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        targets = await res.json();
        break;
      } catch { await sleep(500); }
    }
    if (!targets) throw new Error('DevTools endpoint never came up');
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        const p = msg.params || {};
        if (msg.method === 'Runtime.exceptionThrown') {
          errors.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || JSON.stringify(p.exceptionDetails)));
        } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
          errors.push('CONSOLE.ERROR: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else if (msg.method === 'Log.entryAdded' && p.entry?.level === 'error') {
          errors.push('LOG.ERROR: ' + p.entry.text + ' ' + (p.entry.url || ''));
        } else if (msg.method === 'Network.loadingFailed') {
          errors.push('NET.FAILED: ' + (p.errorText || '') + ' ' + (p.canceled ? '(canceled)' : ''));
        } else if (msg.method === 'Network.responseReceived' && p.response.status >= 400) {
          errors.push('HTTP' + p.response.status + ' ' + p.response.url);
        }
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const url = shot ? `${'http://127.0.0.1:' + PORT}/?shot=${shot}` : `http://127.0.0.1:${PORT}/`;
    await send('Page.navigate', { url });
    // Wait for the game to boot and stage the shot.
    for (let i = 0; i < 60; i += 1) {
      if (await evalJs('window.__shotReady === true')) break;
      await sleep(500);
    }
    if (untilExpr) {
      let ok = false;
      for (let i = 0; i < untilTimeoutSec * 2; i += 1) {
        try { if (await evalJs(untilExpr)) { ok = true; break; } } catch { /* keep waiting */ }
        await sleep(500);
      }
      if (!ok) throw new Error('until condition never became true: ' + untilExpr);
    } else {
      await sleep(waitSec * 1000);
    }
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out, Buffer.from(shot2.data, 'base64'));
    console.log('SHOT:', out);
    console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
    if (errors.length) process.exitCode = 1;
  } finally {
    chrome.kill();
    server.kill();
  }
}
main().catch((e) => { console.error('DRIVE FAILED', e); process.exit(1); });
