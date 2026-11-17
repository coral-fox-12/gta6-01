// Traffic lights for SOLMAR BAY: a light at each major intersection in the
// central grid. North-south and east-west take turns on a 20 s cycle, staggered
// so neighbouring intersections are never in sync. Traffic cars stop on red;
// pedestrians wait at the kerb while their road is green for cars.
import * as THREE from 'three';
import { streetCoord } from './city.js';

export const LIGHT_CYCLE = 20; // seconds: 8 green + 2 yellow per axis
export const LIGHT_GRID = 2; // lights at street indices -2..2 (5 x 5 = 25 lights)

// Shared lamp materials: one per colour, swapped onto the lamp meshes as the
// cycle turns. Emissive so the lamps read at a distance and in screenshots.
const LAMP_MATS = {
  red: new THREE.MeshLambertMaterial({ color: 0xc02020, emissive: 0xaa0000 }),
  yellow: new THREE.MeshLambertMaterial({ color: 0xe8c832, emissive: 0x8a7000 }),
  green: new THREE.MeshLambertMaterial({ color: 0x2fae5f, emissive: 0x0a6a30 }),
};

export class TrafficLights {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.lights = [];
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 6.4, 8);
    poleGeo.translate(0, 3.2, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
    const housingGeo = new THREE.BoxGeometry(0.7, 1.9, 0.5);
    const housingMat = new THREE.MeshLambertMaterial({ color: 0x1a1d22 });
    const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
    for (let i = -LIGHT_GRID; i <= LIGHT_GRID; i += 1) {
      for (let j = -LIGHT_GRID; j <= LIGHT_GRID; j += 1) {
        const x = streetCoord(i + 3);
        const z = streetCoord(j + 3);
        // Pole on the north-east corner of the intersection, clear of the road.
        const group = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        group.add(pole);
        const housing = new THREE.Mesh(housingGeo, housingMat);
        housing.position.set(0, 6.2, 0);
        group.add(housing);
        // Two lamps on the housing: one faces north-south traffic, one faces
        // east-west, so each direction sees its own signal.
        const lampNS = new THREE.Mesh(lampGeo, LAMP_MATS.green);
        lampNS.position.set(0, 6.6, 0.28);
        group.add(lampNS);
        const lampEW = new THREE.Mesh(lampGeo, LAMP_MATS.red);
        lampEW.position.set(0, 5.9, 0.28);
        group.add(lampEW);
        group.position.set(x + 8.4, 0, z + 8.4);
        scene.add(group);
        // Stagger the cycle by (i + j) so the grid ripples instead of flipping
        // all at once — and so a driver does not hit red at every crossing.
        this.lights.push({ x, z, i, j, offset: ((i + j) * 2.5 + LIGHT_CYCLE) % LIGHT_CYCLE, lampNS, lampEW });
      }
    }
  }

  /** Phase of one axis at one light: 'green' | 'yellow' | 'red'. */
  phaseOf(light, axis, t) {
    const tt = (t + light.offset) % LIGHT_CYCLE;
    // NS green [0,8), NS yellow [8,10), EW green [10,18), EW yellow [18,20).
    if (axis === 'z') return tt < 8 ? 'green' : tt < 10 ? 'yellow' : 'red';
    return tt < 10 ? 'red' : tt < 18 ? 'green' : 'yellow';
  }

  /** Phase for an axis at the nearest light to (x, z). 'green' where no light is near. */
  phaseAt(x, z, axis) {
    let best = null;
    let bestD = Infinity;
    for (const l of this.lights) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < bestD) { bestD = d; best = l; }
    }
    if (!best || bestD > 42) return 'green';
    return this.phaseOf(best, axis, this.time);
  }

  /**
   * The next intersection ahead of a car travelling along `axis` ('x' or 'z')
   * in direction `dir` (+1 / -1). Returns { dist, phase } or null when no
   * light is within 20 m ahead. `dist` is measured to the intersection centre.
   */
  lightAhead(x, z, axis, dir) {
    const along = axis === 'x' ? x : z;
    let best = null;
    let bestDist = Infinity;
    for (const l of this.lights) {
      const coord = axis === 'x' ? l.x : l.z;
      const d = (coord - along) * dir;
      if (d > 2 && d < bestDist) { bestDist = d; best = l; }
    }
    if (!best || bestDist > 20) return null;
    return { dist: bestDist, phase: this.phaseOf(best, axis, this.time) };
  }

  /** Advance the cycle and repaint the lamps. */
  update(dt) {
    this.time += dt;
    for (const l of this.lights) {
      l.lampNS.material = LAMP_MATS[this.phaseOf(l, 'z', this.time)];
      l.lampEW.material = LAMP_MATS[this.phaseOf(l, 'x', this.time)];
    }
  }

  /** Counts of each colour across the grid (for the HUD/debug + play tests). */
  summary() {
    let green = 0, yellow = 0, red = 0;
    for (const l of this.lights) {
      for (const axis of ['z', 'x']) {
        const p = this.phaseOf(l, axis, this.time);
        if (p === 'green') green += 1;
        else if (p === 'yellow') yellow += 1;
        else red += 1;
      }
    }
    return { lights: this.lights.length, green, yellow, red };
  }
}
