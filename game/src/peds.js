// Pedestrians for SOLMAR BAY: ordinary Solmar citizens strolling the sidewalks,
// who flee from gunfire and crime. Original characters, generated looks.
import * as THREE from 'three';
import { clamp, dist2d, makeRng } from './util.js';
import { collideCircle, streetCoord, PITCH, GRID, HALF, ROAD } from './city.js';

const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b98a, 0x6b4423, 0xd9a077];
const SHIRTS = [0xc23b2e, 0x2e6fc2, 0xe8c832, 0x2fb573, 0x7a4fc2, 0xe07b2e, 0x3aa7a3, 0xf2f2f2, 0x22242a];
const PANTS = [0x2c3a4a, 0x4a3a2c, 0x22242a, 0x5a5a5a, 0x3a4a2e];
const NAMES = [
  'Marla', 'Tomas', 'Priya', 'Jonas', 'Alicia', 'Ken', 'Rosa', 'Felix', 'Ines',
  'Marco', 'Lena', 'Omar', 'Sofia', 'Dmitri', 'Hana', 'Pablo', 'Nina', 'Ezra',
];

export class Ped {
  constructor(scene, x, z, rng) {
    this.scene = scene;
    this.x = x; this.z = z;
    this.heading = rng.range(0, Math.PI * 2);
    this.speed = rng.range(1.2, 2.2);
    this.name = rng.pick(NAMES);
    this.state = 'walk'; // walk | flee | down | dead
    this.fleeTimer = 0;
    this.downTimer = 0;
    this.walkPhase = rng.range(0, Math.PI * 2);
    this.targetHeading = this.heading;
    const skin = new THREE.MeshLambertMaterial({ color: rng.pick(SKINS) });
    const shirt = new THREE.MeshLambertMaterial({ color: rng.pick(SHIRTS) });
    const pants = new THREE.MeshLambertMaterial({ color: rng.pick(PANTS) });
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
    head.position.y = 1.62;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), shirt);
    body.position.y = 1.12;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.2), pants);
    legL.position.set(-0.14, 0.42, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.2), pants);
    legR.position.set(0.14, 0.42, 0);
    g.add(head, body, legL, legR);
    g.position.set(x, 0, z);
    this.mesh = g;
    this.legL = legL;
    this.legR = legR;
    this.body = body;
    scene.add(g);
  }

  /** Flee from a point (gunshot, crash, crime). */
  fleeFrom(x, z) {
    if (this.state === 'down') return;
    this.state = 'flee';
    this.fleeTimer = 5;
    const dx = this.x - x;
    const dz = this.z - z;
    this.targetHeading = Math.atan2(dx, dz);
  }

  knockDown() {
    if (this.state === 'down') return;
    this.state = 'down';
    this.downTimer = 6;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.25;
  }

  update(dt, colliders, rng, danger, cars = null) {
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) {
        this.state = 'walk';
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
        // Get up and walk away.
        this.targetHeading = rng.range(0, Math.PI * 2);
      }
      return;
    }
    if (danger && this.state !== 'flee') {
      const d = dist2d(this.x, this.z, danger.x, danger.z);
      if (d < 18) this.fleeFrom(danger.x, danger.z);
    }
    // Dodge a fast car bearing down: a pedestrian standing in the road dives
    // out of the way instead of waiting to be run over.
    if (cars && this.state !== 'flee') {
      for (const c of cars) {
        if (Math.abs(c.speed || 0) > 6 && dist2d(this.x, this.z, c.x, c.z) < 7) {
          this.fleeFrom(c.x, c.z);
          break;
        }
      }
    }
    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) this.state = 'walk';
    }
    const speed = this.state === 'flee' ? 5.2 : this.speed;
    // Steer toward target heading, pick a new one at intersections or randomly.
    let dh = this.targetHeading - this.heading;
    dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading += clamp(dh, -1, 1) * 3 * dt;
    if (rng.chance(dt * 0.08)) this.targetHeading = rng.range(0, Math.PI * 2);
    const nx = this.x + Math.sin(this.heading) * speed * dt;
    const nz = this.z + Math.cos(this.heading) * speed * dt;
    const [cx, cz] = collideCircle(colliders, nx, nz, 0.5);
    if (cx !== nx || cz !== nz) {
      // Bumped into a building: turn around.
      this.targetHeading = this.heading + Math.PI + rng.range(-0.6, 0.6);
    }
    this.x = cx; this.z = cz;
    // Keep pedestrians on sidewalks: if they wander onto a road, steer back to the kerb.
    this.mesh.position.set(this.x, this.mesh.position.y, this.z);
    this.mesh.rotation.y = this.heading;
    this.walkPhase += dt * speed * 3.2;
    const swing = this.state === 'walk' || this.state === 'flee' ? Math.sin(this.walkPhase) * 0.45 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
  }

  remove() { this.scene.remove(this.mesh); }
}

/** Spawn a crowd of pedestrians on the sidewalks. */
export function spawnPeds(scene, count, seed, colliders) {
  const rng = makeRng(seed + 313);
  const peds = [];
  const streets = [];
  for (let i = 0; i <= GRID * 2; i += 1) streets.push(streetCoord(i));
  let guard = 0;
  while (peds.length < count && guard < count * 20) {
    guard += 1;
    const street = rng.pick(streets);
    const along = rng.range(-HALF + 10, HALF - 10);
    const side = rng.chance(0.5) ? 1 : -1;
    const horizontal = rng.chance(0.5);
    const x = horizontal ? along : street + side * (ROAD / 2 + 2.5);
    const z = horizontal ? street + side * (ROAD / 2 + 2.5) : along;
    if (collideCircle(colliders, x, z, 0.6)[0] !== x) continue;
    if (peds.some((p) => dist2d(p.x, p.z, x, z) < 3)) continue;
    peds.push(new Ped(scene, x, z, rng));
  }
  return peds;
}
