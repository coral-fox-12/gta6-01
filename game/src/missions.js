// Missions and story for SOLMAR BAY.
// Rook Marlowe, a wheelman who swore he was out, comes home to Solmar Bay because his
// sister Lena owes fixer Vera Kross $40,000. Four jobs to pay it off. All original.
import * as THREE from 'three';
import { money } from './util.js';

export const MISSIONS = [
  {
    id: 'wheels-up',
    title: '1 — Wheels Up',
    intro: 'Vera Kross: "Welcome home, Rook. You owe me forty grand. First job\'s easy — get wheels. Any wheels. Then bring them to the Marina."',
    reward: 500,
    steps: [
      { id: 'steal', text: 'Steal a car (walk up to one and press E)', type: 'steal-car' },
      { id: 'drive', text: 'Drive to the Marina marker', type: 'goto', x: 174, z: -116, radius: 10 },
    ],
  },
  {
    id: 'the-drop',
    title: '2 — The Drop',
    intro: 'Marla at Pier 9 has a package for you. Pick it up on foot, then deliver it to the Rookery Garage in Old Town. No cops. No noise.',
    reward: 800,
    steps: [
      { id: 'pickup', text: 'Meet Marla at Pier 9 (get out and walk to her)', type: 'goto', x: 232, z: -58, radius: 6, onFoot: true },
      { id: 'deliver', text: 'Deliver the package to the Rookery Garage', type: 'goto', x: -58, z: 87, radius: 9 },
    ],
  },
  {
    id: 'heat-wave',
    title: '3 — Heat Wave',
    intro: 'Vera: "The SBPD impounded my courier\'s car. Take it back from the lot on Palm Row — and yes, they will notice. Lose them."',
    reward: 1200,
    steps: [
      { id: 'take', text: 'Steal the marked car from the Palm Row lot', type: 'steal-marked', x: 116, z: 145, radius: 8 },
      { id: 'lose', text: 'Lose the heat — get your wanted level to zero', type: 'lose-wanted' },
    ],
  },
  {
    id: 'the-big-score',
    title: '4 — The Big Score',
    intro: 'Vera: "Last one. Bay Bank, Meridian Avenue. The vault crew is armed — so are you. Grab the cash, get out, lose the heat. Then we\'re even."',
    reward: 3000,
    steps: [
      { id: 'bank', text: 'Go to Bay Bank on Meridian Avenue', type: 'goto', x: 58, z: 29, radius: 12 },
      { id: 'fight', text: 'Take down the bank guards (4)', type: 'defeat', count: 4 },
      { id: 'grab', text: 'Grab the cash from the vault marker', type: 'goto', x: 58, z: 29, radius: 5, onFoot: true },
      { id: 'escape', text: 'Escape — lose the heat', type: 'lose-wanted' },
    ],
  },
];

export class MissionManager {
  constructor(scene) {
    this.scene = scene;
    this.index = 0; // next mission to run
    this.active = null; // {def, stepIdx, ...}
    this.completed = [];
    this.marker = null;
    this.markerRing = null;
    this.beacon = null;
    this.buildMarker();
  }

  buildMarker() {
    // A glowing column + ring marking the current objective on the ground.
    const geo = new THREE.CylinderGeometry(1.6, 1.6, 60, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd23e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = 30;
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    const ringGeo = new THREE.RingGeometry(2.2, 3.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    this.markerRing = new THREE.Mesh(ringGeo, ringMat);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerRing.position.y = 0.06;
    this.markerRing.visible = false;
    this.scene.add(this.markerRing);
  }

  get currentDef() { return MISSIONS[this.index] || null; }
  get isDone() { return this.index >= MISSIONS.length; }

  /** Start the next mission. Returns the mission def. */
  startNext() {
    const def = this.currentDef;
    if (!def) return null;
    this.active = { def, stepIdx: 0, defeated: 0, startedAt: performance.now() };
    this.showMarkerForStep();
    return def;
  }

  currentStep() {
    if (!this.active) return null;
    return this.active.def.steps[this.active.stepIdx];
  }

  objectiveText() {
    if (this.isDone) return 'All jobs done — Solmar Bay is yours, Rook.';
    if (!this.active) return 'Drive to the yellow marker to start: ' + this.currentDef.title;
    const step = this.currentStep();
    return step ? step.text : '';
  }

  showMarkerForStep() {
    const step = this.currentStep();
    if (!step || step.x === undefined) {
      this.beacon.visible = false;
      this.markerRing.visible = false;
      this.marker = null;
      return;
    }
    this.marker = { x: step.x, z: step.z, radius: step.radius || 8 };
    this.beacon.position.set(step.x, 30, step.z);
    this.markerRing.position.set(step.x, 0.06, step.z);
    this.beacon.visible = true;
    this.markerRing.visible = true;
  }

  advance() {
    if (!this.active) return null;
    this.active.stepIdx += 1;
    if (this.active.stepIdx >= this.active.def.steps.length) {
      const done = this.active.def;
      this.completed.push(done.id);
      this.index += 1;
      this.active = null;
      this.beacon.visible = false;
      this.markerRing.visible = false;
      this.marker = null;
      return { type: 'mission-complete', def: done };
    }
    this.showMarkerForStep();
    return { type: 'step', step: this.currentStep() };
  }

  /** Per-frame mission logic. `ctx` carries the world state. Returns events. */
  update(dt, ctx) {
    const events = [];
    if (!this.active) {
      // Idle: if the player reaches the start marker, the next mission begins.
      const def = this.currentDef;
      if (def) {
        const start = def.steps[0];
        const sx = start.x !== undefined ? start.x : ctx.spawnX;
        const sz = start.z !== undefined ? start.z : ctx.spawnZ;
        this.marker = { x: sx, z: sz, radius: 10 };
        this.beacon.position.set(sx, 30, sz);
        this.markerRing.position.set(sx, 0.06, sz);
        this.beacon.visible = true;
        this.markerRing.visible = true;
        const d = Math.hypot(ctx.px - sx, ctx.pz - sz);
        if (d < 10) {
          const started = this.startNext();
          events.push({ type: 'mission-start', def: started });
        }
      }
      return events;
    }
    const step = this.currentStep();
    if (!step) return events;
    const px = ctx.px, pz = ctx.pz;
    if (step.type === 'steal-car') {
      if (ctx.inCar) events.push(...this.completeStep('You\'ve got wheels.'));
    } else if (step.type === 'steal-marked') {
      if (ctx.inCar && ctx.inCar.marked) events.push(...this.completeStep('That\'s Vera\'s car. Move!'));
    } else if (step.type === 'goto') {
      const d = Math.hypot(px - step.x, pz - step.z);
      if (d < step.radius && (!step.onFoot || !ctx.inCar)) {
        events.push(...this.completeStep());
      }
    } else if (step.type === 'defeat') {
      if (this.active.defeated >= step.count) events.push(...this.completeStep('Guards down.'));
    } else if (step.type === 'lose-wanted') {
      if (ctx.wanted === 0) events.push(...this.completeStep('Clean. Vera will hear about this.'));
    }
    return events;
  }

  completeStep(note) {
    const result = this.advance();
    const out = [];
    if (result?.type === 'mission-complete') {
      out.push({ type: 'mission-complete', def: result.def, reward: result.def.reward });
      if (note) out.push({ type: 'note', text: note });
    } else if (result?.type === 'step') {
      out.push({ type: 'step', step: result.step });
      if (note) out.push({ type: 'note', text: note });
    }
    return out;
  }

  onEnemyDown() {
    if (!this.active) return;
    const step = this.currentStep();
    if (step?.type === 'defeat') this.active.defeated += 1;
  }

  /** Pulse the marker ring so it is easy to spot. */
  animateMarker(t) {
    if (!this.markerRing.visible) return;
    const s = 1 + Math.sin(t * 3) * 0.12;
    this.markerRing.scale.set(s, s, 1);
    this.beacon.material.opacity = 0.22 + Math.sin(t * 3) * 0.08;
  }

  /** Save/load: which mission is next + completed list. */
  serialize() { return { index: this.index, completed: this.completed }; }
  restore(data) {
    if (!data) return;
    this.index = data.index || 0;
    this.completed = data.completed || [];
    this.active = null;
  }
}

/** Short story text for the start screen. */
export const STORY_BLURB = 'Rook Marlowe swore he was out. Then his sister Lena borrowed $40,000 from Vera Kross — the fixer who owns Solmar Bay after dark. Four jobs. One week. Pay it off, or the Bay keeps them both.';
