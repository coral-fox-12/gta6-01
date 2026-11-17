// SOLMAR BAY — main game. Boots three.js, wires every system together, runs the loop.
// An original open-world crime game: on foot and by car, traffic, traffic lights,
// pedestrians, police, two roaming gangs, seven story missions, combat, HUD + live
// minimap, save/load, synth sound.
import * as THREE from 'three';
import { buildCity, collideCircle, DISTRICTS, BEACH_X, SEA_X, HALF } from './city.js';
import { spawnCars, Car } from './vehicles.js';
import { spawnPeds } from './peds.js';
import { Player } from './player.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { MissionManager, MISSIONS, STORY_BLURB } from './missions.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';
import { stageShot, autopilotInput } from './shots.js';
import { TrafficLights } from './traffic.js';
import { Gangs, GANG_TURF } from './gangs.js';
import { clamp, dist2d, makeRng, money } from './util.js';

const SAVE_KEY = 'solmar-bay-save-v1';
const SPAWN = { x: 0, z: 40 };
const FINE_BUSTED = 200;
const FINE_DEAD = 100;

export class Game {
  constructor() {
    this.state = 'title'; // title | playing | paused | busted | dead
    this.money = 250;
    this.time = 0;
    this.autopilot = false;
    this.shotMode = null;
    this.seed = 1;
    this.saveTimer = 0;
    this.keys = {};
    this.dragging = false;
    this.titleAngle = 0;
    this.markedCar = null;
    this.mission3CarSpawned = false;
    this.enemiesSpawnedFor = null;
    this.sound = new SoundBank();
    this.setupDom();
    this.setupThree();
    this.buildWorld();
    this.bindInput();
    this.applyShotParam();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupDom() {
    this.canvas = document.getElementById('game');
    this.hudEl = document.getElementById('hud');
    this.titleEl = document.getElementById('title-screen');
    this.pauseEl = document.getElementById('pause-screen');
    this.endEl = document.getElementById('end-screen');
    this.endTitle = document.getElementById('end-title');
    this.endSub = document.getElementById('end-sub');
    document.getElementById('story-blurb').textContent = STORY_BLURB;
    const missionList = document.getElementById('mission-list');
    missionList.innerHTML = MISSIONS.map((m) => `<li><b>${m.title}</b> — ${m.intro}</li>`).join('');
    document.getElementById('btn-new').addEventListener('click', () => this.startGame(true));
    document.getElementById('btn-continue').addEventListener('click', () => this.startGame(false));
    document.getElementById('btn-resume').addEventListener('click', () => this.resume());
    document.getElementById('btn-restart').addEventListener('click', () => this.startGame(true));
    document.getElementById('btn-quit-title').addEventListener('click', () => this.showTitle());
    document.getElementById('btn-end').addEventListener('click', () => this.afterEndScreen());
    document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());
    this.hud = new Hud();
  }

  setupThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 40, 80);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  buildWorld() {
    const params = new URLSearchParams(window.location.search);
    this.seed = parseInt(params.get('seed') || '1', 10) || 1;
    const city = buildCity(this.scene, this.seed);
    this.city = city;
    this.colliders = city.colliders;
    this.trafficLights = new TrafficLights(this.scene);
    this.cars = spawnCars(this.scene, this.seed, this.colliders);
    this.peds = spawnPeds(this.scene, 26, this.seed, this.colliders);
    this.player = new Player(this.scene);
    this.player.reset(SPAWN.x, SPAWN.z);
    this.police = new Police(this.scene, this.colliders);
    this.combat = new Combat(this.scene, this.sound);
    this.gangs = new Gangs(this.scene, this.combat);
    this.combat.onCash = (v) => { this.money += v; this.hud.showMessage('Picked up ' + money(v)); };
    this.missions = new MissionManager(this.scene);
    this.updateContinueButton();
  }

  updateContinueButton() {
    const has = !!localStorage.getItem(SAVE_KEY);
    document.getElementById('btn-continue').disabled = !has;
  }

  // ---------- screens & state ----------

  showTitle() {
    this.state = 'title';
    this.titleEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.endEl.classList.add('hidden');
    this.hudEl.classList.add('hidden');
    document.exitPointerLock?.();
    this.sound.setEngine(0, false);
    this.sound.setSiren(false, 0);
  }

  startGame(fresh) {
    this.sound.init();
    this.sound.startMusic();
    if (fresh) {
      localStorage.removeItem(SAVE_KEY);
      this.money = 250;
      this.missions.restore({ index: 0, completed: [] });
      this.combat.clearEnemies();
      this.combat.clearPickups();
      this.gangs.reset();
      this.police.reset();
      this.player.reset(SPAWN.x, SPAWN.z);
      this.markedCar = null;
      this.mission3CarSpawned = false;
      this.enemiesSpawnedFor = null;
    } else {
      this.loadGame();
    }
    this.state = 'playing';
    this.titleEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.endEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.hud.showMessage('Welcome back to Solmar Bay, Rook.', 5);
    this.updateContinueButton();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseEl.classList.remove('hidden');
    document.exitPointerLock?.();
    this.saveGame();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.pauseEl.classList.add('hidden');
  }

  toggleMute() {
    this.sound.init();
    this.sound.setEnabled(!this.sound.enabled);
    document.getElementById('btn-mute').textContent = this.sound.enabled ? '🔊 Sound: on' : '🔇 Sound: off';
  }

  showEnd(kind) {
    this.state = kind; // 'busted' | 'dead'
    if (kind === 'busted') {
      this.sound.busted();
      this.endTitle.textContent = 'BUSTED';
      this.endSub.textContent = 'The SBPD hauled you in. Fine: ' + money(FINE_BUSTED) + '. Vera is not impressed.';
    } else {
      this.sound.flatline();
      this.endTitle.textContent = 'FLATLINED';
      this.endSub.textContent = 'You woke up at St. Marina General, ' + money(FINE_DEAD) + ' lighter. The Bay doesn\'t wait.';
    }
    this.endEl.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  afterEndScreen() {
    this.endEl.classList.add('hidden');
    this.money = Math.max(0, this.money - (this.state === 'busted' ? FINE_BUSTED : FINE_DEAD));
    this.police.reset();
    this.player.reset(SPAWN.x, SPAWN.z);
    this.player.health = this.player.maxHealth;
    this.missions.active = null; // restart the current mission from its marker
    this.combat.clearEnemies();
    this.gangs.reset();
    this.enemiesSpawnedFor = null;
    this.state = 'playing';
    this.saveGame();
  }

  // ---------- save / load ----------

  saveGame() {
    const data = {
      money: this.money,
      missions: this.missions.serialize(),
      player: { x: this.player.x, z: this.player.z, health: this.player.health },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  loadGame() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { data = null; }
    if (!data) { this.startGame(true); return; }
    this.money = data.money ?? 250;
    this.missions.restore(data.missions);
    this.combat.clearEnemies();
    this.combat.clearPickups();
    this.gangs.reset();
    this.police.reset();
    this.player.reset(data.player?.x ?? SPAWN.x, data.player?.z ?? SPAWN.z);
    this.player.health = data.player?.health ?? 100;
    this.markedCar = null;
    this.mission3CarSpawned = false;
    this.enemiesSpawnedFor = null;
  }

  // ---------- input ----------

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this.tryEnterExitCar();
      if (e.code === 'KeyF') this.tryPunch();
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (e.code === 'KeyM') this.toggleMute();
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      this.sound.init();
      if (e.button === 0) {
        // Shooting works on foot and from a car (drive-by): the shot goes where
        // the camera points, which while driving is straight ahead of the car.
        this.tryShoot();
        this.dragging = true;
      }
      if (document.pointerLockElement !== this.canvas) {
        // Pointer lock can fail (headless, iframe, denied) and the call
        // rejects as a promise in newer browsers — never let that surface
        // as an uncaught exception; the game plays fine without the lock.
        try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* no pointer lock */ }
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || this.player.inCar) return;
      if (document.pointerLockElement === this.canvas || this.dragging) {
        this.player.look(e.movementX, e.movementY);
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      // The crosshair stays visible while driving too: it is the drive-by sight.
      this.hud.setCrosshairVisible(this.state === 'playing');
    });
  }

  inputState() {
    return {
      forward: !!(this.keys.KeyW || this.keys.ArrowUp),
      back: !!(this.keys.KeyS || this.keys.ArrowDown),
      left: !!(this.keys.KeyA || this.keys.ArrowLeft),
      right: !!(this.keys.KeyD || this.keys.ArrowRight),
      sprint: !!(this.keys.ShiftLeft || this.keys.ShiftRight),
      jump: !!this.keys.Space,
    };
  }

  nearestCar(maxD = 4.5) {
    const px = this.player.x, pz = this.player.z;
    let best = null; let bestD = maxD;
    for (const car of this.cars) {
      const d = dist2d(px, pz, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    for (const car of this.police.cars) {
      const d = dist2d(px, pz, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  tryEnterExitCar() {
    if (this.state !== 'playing') return;
    if (this.player.inCar) {
      this.player.exitCar();
      this.sound.click();
      return;
    }
    const car = this.nearestCar();
    if (!car) return;
    this.player.enterCar(car);
    this.sound.click();
    // Stealing a car is a crime — unless it is yours (mission cars are marked, not owned).
    if (!car.stolen) {
      car.stolen = true;
      if (car.marked) {
        this.police.setWanted(3);
        this.hud.showMessage('That\'s Vera\'s car — the SBPD is on you. LOSE THEM!', 5);
        this.sound.wantedUp();
      } else if (car.police) {
        this.police.addCrime(2, 'stole a police car');
        this.hud.showMessage('You stole a police cruiser! The SBPD is furious.', 4);
        this.sound.wantedUp();
      } else {
        this.police.addCrime(1, 'stole a car');
        this.hud.showMessage('Car stolen — ' + car.name + '. The SBPD is looking for you.', 4);
        this.sound.wantedUp();
      }
    }
  }

  tryPunch() {
    if (this.state !== 'playing' || this.player.inCar) return;
    const result = this.combat.punch(this.player, this.peds);
    if (result?.type === 'hit-ped') {
      this.police.addCrime(1, 'assault');
      this.hud.showMessage('You hit a civilian! Wanted level up.', 3);
      this.sound.wantedUp();
    } else if (result?.type === 'hit-enemy') {
      this.missions.onEnemyDown();
      this.checkEnemyDown(result.enemy);
    }
  }

  tryShoot() {
    if (this.state !== 'playing') return;
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const result = this.combat.playerShoot(origin, dir, this.colliders, this.peds, this.player);
    if (!result) return;
    // Any gunfire — hit or miss — scares nearby pedestrians away.
    const px = this.player.inCar ? this.player.inCar.x : this.player.x;
    const pz = this.player.inCar ? this.player.inCar.z : this.player.z;
    for (const p of this.peds) {
      if (dist2d(p.x, p.z, px, pz) < 15) p.fleeFrom(px, pz);
    }
    if (result.type === 'hit-ped') {
      this.police.addCrime(1, 'shot a civilian');
      this.hud.showMessage('You shot a civilian! Wanted level up.', 3);
      this.sound.wantedUp();
      for (const p of this.peds) p.fleeFrom(this.player.x, this.player.z);
    } else if (result.type === 'hit-enemy') {
      this.missions.onEnemyDown();
      this.checkEnemyDown(result.enemy);
    }
  }

  checkEnemyDown(enemy) {
    if (enemy.state === 'down' && !enemy.countedDown) {
      enemy.countedDown = true;
      this.money += 0; // cash comes from the pickup, not the kill
    }
  }

  // ---------- per-frame ----------

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clockDelta());
    this.time += dt;
    if (this.state === 'title') {
      this.titleAngle += dt * 0.05;
      const r = 150;
      this.camera.position.set(Math.sin(this.titleAngle) * r, 55, Math.cos(this.titleAngle) * r);
      this.camera.lookAt(0, 12, 0);
      this.updateAmbient(dt, true);
    } else if (this.state === 'playing') {
      this.updatePlaying(dt);
    }
    this.missions.animateMarker(this.time);
    this.renderer.render(this.scene, this.camera);
    if (!this.shotReady) {
      this.shotReady = true;
      window.__shotReady = true;
    }
  }

  clockDelta() {
    const now = performance.now() / 1000;
    const d = this._lastT === undefined ? 0.016 : now - this._lastT;
    this._lastT = now;
    return d;
  }

  updateAmbient(dt, titleMode, danger = null, cars = null) {
    // Traffic lights keep cycling even behind the title screen, and traffic
    // and pedestrians keep the city alive.
    if (this.trafficLights) this.trafficLights.update(dt);
    for (const car of this.cars) {
      if (car.role === 'traffic') car.updateTraffic(dt, this.colliders, this.cars, this._rng(), this.trafficLights);
    }
    // `cars` is only passed while playing: peds dodge fast cars, and behind the
    // title screen the traffic is far from the camera anyway.
    for (const p of this.peds) p.update(dt, this.colliders, this._rng(), danger, cars, this.trafficLights);
  }

  _rng() {
    // A seeded RNG for ambient updates (traffic/ped randomness).
    if (!this._ambientRng) this._ambientRng = makeRng(12345);
    return this._ambientRng;
  }

  updatePlaying(dt) {
    const player = this.player;
    const now = this.time;
    // --- player / car ---
    if (player.inCar) {
      const car = player.inCar;
      const input = this.autopilot
        ? autopilotInput(this, dt)
        : {
            throttle: (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) + (this.keys.KeyS || this.keys.ArrowDown ? -0.7 : 0),
            brake: this.keys.Space ? 1 : 0,
            steer: (this.keys.KeyA || this.keys.ArrowLeft ? -1 : 0) + (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0),
          };
      // Note: steering sign — A turns left (negative), D right (positive) matches drive().
      const hitWall = car.drive(dt, input, this.colliders, [...this.cars, ...this.police.cars]);
      if (hitWall && Math.abs(car.speed) > 8) {
        this.sound.crash();
        if (Math.abs(car.speed) > 14) this.police.addCrime(0, 'reckless driving');
      }
      // Running over pedestrians.
      for (const p of this.peds) {
        if (p.state === 'down') continue;
        if (dist2d(car.x, car.z, p.x, p.z) < 2.0 && Math.abs(car.speed) > 3) {
          p.knockDown();
          this.police.addCrime(1, 'hit a pedestrian');
          this.hud.showMessage('You hit a pedestrian! Wanted level up.', 3);
          this.sound.wantedUp();
          this.sound.crash();
        }
      }
      this.sound.setEngine(Math.abs(car.speed) / 30, true);
    } else {
      player.updateOnFoot(dt, this.inputState(), this.colliders);
      this.sound.setEngine(0, false);
    }
    player.regen(dt, now);
    if (player.health <= 0) { this.showEnd('dead'); return; }

    // --- traffic, peds, police, combat ---
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    const danger = this.police.wanted > 0 ? { x: px, z: pz } : null;
    this.updateAmbient(dt, false, danger, [...this.cars, ...this.police.cars]);
    const policeEvents = this.police.update(dt, player, this.cars, now);
    for (const ev of policeEvents) {
      if (ev.type === 'busted') { this.showEnd('busted'); return; }
      if (ev.type === 'wanted-down') this.hud.showMessage('Heat cooling off… ' + ev.level + ' star' + (ev.level === 1 ? '' : 's') + ' left.', 3);
      if (ev.type === 'ram') this.sound.crash();
    }
    this.sound.setSiren(this.police.sirenOn, dt);
    this.combat.updateEnemies(dt, player, this.colliders);
    this.gangs.update(dt, px, pz);

    // --- missions ---
    const missionEvents = this.missions.update(dt, {
      px, pz, inCar: player.inCar, wanted: this.police.wanted,
      spawnX: SPAWN.x, spawnZ: SPAWN.z,
    });
    for (const ev of missionEvents) this.handleMissionEvent(ev);

    // --- camera, HUD, zone ---
    player.cameraTarget(this.camera, dt, this.colliders,
      [...this.cars, ...this.police.cars].filter((c) => c !== player.inCar));
    const speedKmh = player.inCar ? Math.abs(player.inCar.speed) * 3.6 : 0;
    this.hud.update(dt, {
      player, police: this.police, missions: this.missions,
      money: this.money, cars: this.cars, enemies: this.combat.enemies,
      speedKmh, zone: this.zoneName(px, pz),
    });
    this.hud.setCrosshairVisible(true);

    // --- autosave ---
    this.saveTimer += dt;
    if (this.saveTimer > 15) { this.saveTimer = 0; this.saveGame(); }
  }

  zoneName(x, z) {
    if (this.gangs && this.gangs.inTurf(x, z)) return 'Viper Turf — The Docks';
    if (this.gangs && this.gangs.inGullTurf(x, z)) return 'Gull King Turf — The Boardwalk';
    if (x > BEACH_X) return 'Solmar Beach';
    if (x > SEA_X - 40) return 'The Boardwalk';
    let best = null; let bestD = Infinity;
    for (const d of DISTRICTS) {
      const dd = dist2d(x, z, d.x, d.z);
      if (dd < bestD) { bestD = dd; best = d.name; }
    }
    return best || 'Solmar Bay';
  }

  handleMissionEvent(ev) {
    if (ev.type === 'mission-start') {
      this.sound.missionStart();
      this.hud.showBanner(ev.def.title, ev.def.intro, 6);
      this.hud.showMessage(ev.def.intro, 6);
      if (ev.def.id === 'heat-wave' && !this.mission3CarSpawned) {
        this.spawnMarkedCar();
      }
    } else if (ev.type === 'step') {
      this.sound.missionStart();
      this.hud.showMessage('Objective: ' + ev.step.text, 5);
      // Defeat steps spawn their own crew, keyed by mission: the old code only
      // ever spawned bank guards (and only once), so a second defeat mission
      // could never complete.
      if (ev.step.type === 'defeat') {
        const id = this.missions.active?.def.id;
        if (id === 'the-big-score' && this.enemiesSpawnedFor !== 'the-big-score') {
          this.spawnBankGuards();
        } else if (id === 'harbor-lights' && this.enemiesSpawnedFor !== 'harbor-lights') {
          this.spawnHarborRats();
        } else if (id === 'serpents-head' && this.enemiesSpawnedFor !== 'serpents-head') {
          this.spawnSerpentCrew();
        } else if (id === 'gull-kings' && this.enemiesSpawnedFor !== 'gull-kings') {
          this.spawnGullCrew();
        }
      }
    } else if (ev.type === 'mission-complete') {
      this.money += ev.def.reward;
      this.sound.missionPass();
      this.sound.cash();
      this.hud.showBanner('JOB DONE — ' + ev.def.title, 'Vera paid ' + money(ev.def.reward) + '. Balance: ' + money(this.money), 5);
      this.saveGame();
    } else if (ev.type === 'note') {
      this.hud.showMessage(ev.text, 4);
    }
  }

  spawnMarkedCar() {
    this.mission3CarSpawned = true;
    // Vera's courier car, parked on Palm Row — bright yellow so the player can find it.
    const car = this.makeCar(116, 145, 0, 0xe8c832, { role: 'parked', name: 'Courier Sunburst' });
    car.marked = true;
    this.markedCar = car;
  }

  makeCar(x, z, heading, color, opts) {
    const car = new Car(this.scene, x, z, heading, color, opts);
    this.cars.push(car);
    return car;
  }

  spawnHarborRats() {
    this.enemiesSpawnedFor = 'harbor-lights';
    // The Harbor Rats wait on the Boardwalk by Vera's contact (spawn spots are
    // shuffled so the crew does not stand in the same order every run).
    const spots = this._rng().shuffle([[202, 50], [204, 66], [192, 68]]);
    spots.forEach(([x, z], i) => {
      this.combat.spawnEnemy(x, z, 'Harbor Rat ' + (i + 1), 60);
    });
    this.police.setWanted(2);
    this.hud.showMessage('The Harbor Rats are armed — and their friends called the SBPD.', 5);
    this.sound.wantedUp();
  }

  spawnBankGuards() {
    this.enemiesSpawnedFor = 'the-big-score';
    const spots = [[46, 20], [70, 20], [46, 40], [70, 40]];
    spots.forEach(([x, z], i) => {
      this.combat.spawnEnemy(x, z, 'Vault Guard ' + (i + 1), 60);
    });
    this.police.setWanted(3);
    this.hud.showMessage('Bank guards are armed! Take them down — the SBPD is coming.', 5);
    this.sound.wantedUp();
  }

  spawnSerpentCrew() {
    this.enemiesSpawnedFor = 'serpents-head';
    // Serpent holds the old fish market at the Docks; his crew fans out along
    // the streets around him. The red bandana marks the boss — the purple
    // jackets mark the rest of the gang.
    this.combat.spawnEnemy(-116, -140, 'Serpent', 100, {
      faction: 'viper', jacket: 0x2a0a3a, bandana: 0xc23b2e,
    });
    const spots = [[-128, -116], [-104, -116], [-116, -152], [-116, -128]];
    spots.forEach(([x, z], i) => {
      this.combat.spawnEnemy(x, z, 'Viper ' + (i + 1), 60, {
        faction: 'viper', jacket: 0x7a2e8f, bandana: 0x7a2e8f,
      });
    });
    this.police.setWanted(3);
    this.hud.showMessage('Serpent and his Vipers are armed — and the SBPD is coming. End it.', 5);
    this.sound.wantedUp();
  }

  spawnGullCrew() {
    this.enemiesSpawnedFor = 'gull-kings';
    // Kingfisher holds the Boardwalk by the old arcade; his crew fans out
    // along the beach front. The gold bandana marks the boss — the teal
    // jackets mark the rest of the gang.
    this.combat.spawnEnemy(190, -8, 'Kingfisher', 100, {
      faction: 'gull', jacket: 0x0a3a3a, bandana: 0xe8c832,
    });
    const spots = [[196, -16], [174, 0], [196, 16], [214, 0]];
    spots.forEach(([x, z], i) => {
      this.combat.spawnEnemy(x, z, 'Gull King ' + (i + 1), 60, {
        faction: 'gull', jacket: 0x0e7c86, bandana: 0xe8c832,
      });
    });
    this.police.setWanted(3);
    this.hud.showMessage('Kingfisher and his Gull Kings are armed — and the SBPD is coming. Take the Boardwalk back.', 5);
    this.sound.wantedUp();
  }

  // ---------- screenshot API (used by shots.js) ----------

  applyShotParam() {
    const params = new URLSearchParams(window.location.search);
    const shot = params.get('shot');
    if (!shot) return;
    this.shotMode = shot;
    stageShot(shot, this.shotApi());
    this.shotStaged = true;
  }

  shotApi() {
    return {
      showTitle: () => this.showTitle(),
      startGame: () => { this.startGame(true); },
      teleportPlayer: (x, z) => { this.player.reset(x, z); },
      teleportCar: (x, z, heading) => {
        const car = this.player.inCar;
        if (!car) return;
        car.x = x; car.z = z; car.heading = heading;
        car.mesh.position.set(x, 0, z);
        car.mesh.rotation.y = heading;
        this.player.camYaw = heading;
      },
      nearestCarTo: (x, z) => {
        let best = null; let bestD = Infinity;
        for (const c of this.cars) {
          const d = dist2d(x, z, c.x, c.z);
          if (d < bestD) { bestD = d; best = c; }
        }
        return best;
      },
      putPlayerInCar: (car) => {
        if (!car) return;
        this.player.x = car.x; this.player.z = car.z;
        this.player.enterCar(car);
        car.stolen = true; // staged scene: no crime popup for the shot
      },
      setWanted: (n) => this.police.setWanted(n),
      startMission: (i) => {
        this.missions.restore({ index: i, completed: MISSIONS.slice(0, i).map((m) => m.id) });
        this.missions.startNext();
        this.sound.missionStart();
        this.hud.showMessage(this.missions.currentStep()?.text || '', 6);
      },
      setAutopilot: (on) => { this.autopilot = on; },
      clearMessage: () => this.hud.clearMessage(),
      spawnPoliceChase: () => {
        for (let i = 0; i < 2; i += 1) this.police.spawnCar();
        // Place the interceptors behind the player for the frame (20 m / 30 m,
        // 12 m/s): the player gets a head start and the chase reads through
        // the wanted stars + minimap. (Flanking them puts them in the chase
        // camera's dead zone, and they ram the player to a standstill before
        // it gets moving — tried, worse.)
        const car = this.player.inCar;
        if (car) {
          this.police.cars.forEach((pc, i) => {
            const back = 20 + i * 10;
            pc.x = car.x - Math.sin(car.heading) * back + (i === 0 ? 4 : -4);
            pc.z = car.z - Math.cos(car.heading) * back;
            pc.heading = car.heading;
            pc.speed = 12;
          });
        }
      },
    };
  }
}

// Boot the game and expose a small handle for play-testing.
const game = new Game();
window.__solmar = {
  game,
  getState: () => ({
    state: game.state,
    money: game.money,
    wanted: game.police.wanted,
    health: game.player.health,
    inCar: !!game.player.inCar,
    mission: game.missions.active ? game.missions.active.def.id : null,
    objective: game.missions.objectiveText(),
    // When driving, the player object stays where the player got in — report
    // the car's position so this state is truthful while in a car.
    player: game.player.inCar
      ? { x: game.player.inCar.x, z: game.player.inCar.z }
      : { x: game.player.x, z: game.player.z },
    cars: game.cars.length,
    peds: game.peds.length,
    policeCars: game.police.cars.length,
    enemies: game.combat.enemies.length,
    vipers: game.gangs ? game.gangs.alive : 0,
    gulls: game.gangs ? game.gangs.gullAlive : 0,
    gangAggro: game.combat.gangAggro,
    gullAggro: game.combat.gullAggro,
    lights: game.trafficLights ? game.trafficLights.summary() : null,
  }),
};
