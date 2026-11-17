// Combat for SOLMAR BAY: hitscan shooting with a visible tracer and muzzle flash,
// armed enemy NPCs who shoot back, melee punches, and cash drops.
import * as THREE from 'three';
import { clamp, dist2d, makeRng } from './util.js';
import { collideCircle } from './city.js';

export class Combat {
  constructor(scene, sound) {
    this.scene = scene;
    this.sound = sound;
    this.enemies = [];
    this.tracers = [];
    this.pickups = [];
    this.ammo = Infinity; // Rook's pistol never runs dry in this build.
    this.fireCooldown = 0;
    this.rng = makeRng(4242);
    this.gangAggro = false; // shooting one Viper turns the whole gang hostile
    this.gullAggro = false; // shooting one Gull King turns the whole gang hostile
    // Muzzle flash: a small additive sprite at the gun.
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flashMat);
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTimer = 0;
  }

  /**
   * Spawn an armed enemy at (x, z) with a name and health.
   * `opts.faction`: 'guard' (bank crew, brown suit) | 'rat' (Harbor Rats) |
   * 'viper' (The Vipers gang, purple jacket + bandana) | 'gull' (The Gull
   * Kings, teal jacket + gold bandana). `opts.patrol` is a list of [x, z]
   * waypoints the enemy walks between while guarding.
   */
  spawnEnemy(x, z, name, health = 60, opts = {}) {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a077 });
    const suit = new THREE.MeshLambertMaterial({ color: opts.jacket ?? 0x3a2c22 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
    head.position.y = 1.62;
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    shades.position.set(0, 1.64, 0.2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.3), suit);
    body.position.y = 1.12;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), suit);
    legL.position.set(-0.14, 0.42, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), suit);
    legR.position.set(0.14, 0.42, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    gun.position.set(0.32, 1.25, 0.3);
    g.add(head, shades, body, legL, legR, gun);
    if (opts.bandana) {
      // A bandana across the lower face: the gang's calling card.
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.08), new THREE.MeshLambertMaterial({ color: opts.bandana }));
      band.position.set(0, 1.52, 0.2);
      g.add(band);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    const enemy = {
      mesh: g, x, z, name, health, maxHealth: health,
      heading: this.rng.range(0, Math.PI * 2),
      shootTimer: this.rng.range(0.5, 1.5),
      state: 'guard', // guard | attack | down
      faction: opts.faction || 'guard',
      patrol: opts.patrol || null,
      patrolIdx: 0,
      patrolWait: 0,
      legL, legR, gun,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  removeEnemy(enemy) {
    this.scene.remove(enemy.mesh);
    this.enemies = this.enemies.filter((e) => e !== enemy);
  }

  clearEnemies() {
    for (const e of [...this.enemies]) this.removeEnemy(e);
  }

  /** Player fires a hitscan shot from the camera toward the crosshair. */
  playerShoot(origin, dir, colliders, peds, player) {
    if (this.fireCooldown > 0) return null;
    this.fireCooldown = 0.22;
    this.sound.gunshot();
    this.flash.position.copy(origin).addScaledVector(dir, 1.2);
    this.flash.visible = true;
    this.flash.material.opacity = 0.95;
    this.flashTimer = 0.06;
    // Find the closest hit among enemies, peds and buildings.
    const ray = new THREE.Raycaster(origin, dir, 0.1, 120);
    let best = { dist: 120, target: null, point: origin.clone().addScaledVector(dir, 120) };
    const test = (obj, kind, ref) => {
      const hits = ray.intersectObject(obj, true);
      if (hits.length > 0 && hits[0].distance < best.dist) {
        best = { dist: hits[0].distance, target: { kind, ref }, point: hits[0].point };
      }
    };
    for (const e of this.enemies) if (e.state !== 'down') test(e.mesh, 'enemy', e);
    for (const p of peds) if (p.state !== 'down') test(p.mesh, 'ped', p);
    // Buildings: raycast against their AABBs (approximate with a box test).
    for (const b of colliders) {
      const t = rayBox(origin, dir, b);
      if (t !== null && t < best.dist) {
        best = { dist: t, target: { kind: 'wall' }, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    this.addTracer(origin, best.point);
    if (best.target?.kind === 'enemy') {
      const e = best.target.ref;
      e.health -= 34;
      if (e.faction === 'viper') this.gangAggro = true; // the gang remembers
      if (e.faction === 'gull') this.gullAggro = true; // the gang remembers
      if (e.health <= 0) {
        e.state = 'down';
        e.mesh.rotation.x = -Math.PI / 2;
        e.mesh.position.y = 0.25;
        this.dropCash(e.x, e.z, 50);
      }
    } else if (best.target?.kind === 'ped') {
      best.target.ref.knockDown();
      return { type: 'hit-ped', ped: best.target.ref };
    }
    if (best.target?.kind === 'enemy') return { type: 'hit-enemy', enemy: best.target.ref };
    return { type: 'shot', hitWall: best.target?.kind === 'wall' };
  }

  /** Melee punch: hits the nearest enemy or ped within 2.2 m in front. */
  punch(player, peds) {
    this.sound.punch();
    const px = player.x, pz = player.z;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let best = null; let bestD = 2.2;
    const consider = (x, z, ref, kind) => {
      const d = dist2d(px, pz, x, z);
      const dot = ((x - px) * fx + (z - pz) * fz) / (d || 1);
      if (d < bestD && dot > 0.3) { best = { ref, kind }; bestD = d; }
    };
    for (const e of this.enemies) if (e.state !== 'down') consider(e.x, e.z, e, 'enemy');
    for (const p of peds) if (p.state !== 'down') consider(p.x, p.z, p, 'ped');
    if (!best) return null;
    if (best.kind === 'enemy') {
      best.ref.health -= 25;
      if (best.ref.faction === 'viper') this.gangAggro = true; // the gang remembers
      if (best.ref.faction === 'gull') this.gullAggro = true; // the gang remembers
      if (best.ref.health <= 0) {
        best.ref.state = 'down';
        best.ref.mesh.rotation.x = -Math.PI / 2;
        best.ref.mesh.position.y = 0.25;
        this.dropCash(best.ref.x, best.ref.z, 50);
      }
      return { type: 'hit-enemy', enemy: best.ref };
    }
    best.ref.knockDown();
    return { type: 'hit-ped', ped: best.ref };
  }

  /** Enemy AI: guards hold position (or walk a patrol), attackers chase and
   *  shoot at the player. A Viper or Gull King whose gang is aggro hunts from
   *  twice as far. */
  updateEnemies(dt, player, colliders) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    // The gang cools off once every member of it is down.
    if (this.gangAggro && !this.enemies.some((e) => e.faction === 'viper' && e.state !== 'down')) {
      this.gangAggro = false;
    }
    if (this.gullAggro && !this.enemies.some((e) => e.faction === 'gull' && e.state !== 'down')) {
      this.gullAggro = false;
    }
    for (const e of this.enemies) {
      if (e.state === 'down') continue;
      const d = dist2d(e.x, e.z, px, pz);
      // A gang member whose gang is aggro hunts from twice as far away.
      const aggroRange = ((e.faction === 'viper' && this.gangAggro) || (e.faction === 'gull' && this.gullAggro)) ? 60 : 26;
      if (d < aggroRange) {
        e.state = 'attack';
        const target = Math.atan2(px - e.x, pz - e.z);
        let dh = target - e.heading;
        dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        e.heading += clamp(dh, -1, 1) * 5 * dt;
        e.mesh.rotation.y = e.heading;
        if (d > 9) {
          const nx = e.x + Math.sin(e.heading) * 3.4 * dt;
          const nz = e.z + Math.cos(e.heading) * 3.4 * dt;
          const [cx, cz] = collideCircle(colliders, nx, nz, 0.5);
          e.x = cx; e.z = cz;
          e.mesh.position.set(e.x, 0, e.z);
        }
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && d < 24) {
          e.shootTimer = this.rng.range(0.9, 1.8);
          this.enemyShoot(e, player, px, pz, d);
        }
      } else {
        e.state = 'guard';
        // Patrol: walk the waypoints instead of standing still.
        if (e.patrol && e.patrol.length > 0) {
          if (e.patrolWait > 0) {
            e.patrolWait -= dt;
          } else {
            const [wx, wz] = e.patrol[e.patrolIdx];
            const wd = dist2d(e.x, e.z, wx, wz);
            if (wd < 2) {
              e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
              e.patrolWait = 1.5;
            } else {
              const th = Math.atan2(wx - e.x, wz - e.z);
              let dh = th - e.heading;
              dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
              e.heading += clamp(dh, -1, 1) * 4 * dt;
              e.mesh.rotation.y = e.heading;
              const nx = e.x + Math.sin(e.heading) * 2.4 * dt;
              const nz = e.z + Math.cos(e.heading) * 2.4 * dt;
              const [cx, cz] = collideCircle(colliders, nx, nz, 0.5);
              e.x = cx; e.z = cz;
              e.mesh.position.set(e.x, 0, e.z);
            }
          }
        }
      }
    }
    // Tracers fade.
    for (const t of [...this.tracers]) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        this.tracers = this.tracers.filter((x) => x !== t);
      }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash.visible = false;
    }
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    // Pickups: spin and bob; collect when the player walks over.
    for (const pk of [...this.pickups]) {
      pk.mesh.rotation.y += dt * 3;
      pk.mesh.position.y = 0.5 + Math.sin(performance.now() / 300 + pk.phase) * 0.12;
      const pd = dist2d(px, pz, pk.x, pk.z);
      if (pd < 1.6 && !player.inCar) {
        this.scene.remove(pk.mesh);
        this.pickups = this.pickups.filter((x) => x !== pk);
        this.sound.cash();
        pk.onCollect(pk.value);
      }
    }
  }

  enemyShoot(e, player, px, pz, dist) {
    this.sound.enemyShot();
    const from = new THREE.Vector3(e.x, 1.35, e.z);
    const spread = 0.09 + dist * 0.004;
    const dir = new THREE.Vector3(
      (px - e.x) / dist + (this.rng.next() - 0.5) * spread * 2,
      (1.2 - 1.35) / dist,
      (pz - e.z) / dist + (this.rng.next() - 0.5) * spread * 2,
    ).normalize();
    const end = from.clone().addScaledVector(dir, Math.min(dist + 4, 40));
    this.addTracer(from, end);
    // Hit chance falls with distance — and with the target's speed, so a fast
    // drive-by is harder to punish than standing still in the open.
    const targetSpeed = player.inCar ? Math.abs(player.inCar.speed) : 0;
    const hitChance = clamp(0.42 - dist * 0.012 - targetSpeed * 0.008, 0.06, 0.42);
    if (this.rng.next() < hitChance) {
      player.takeDamage(this.rng.range(7, 13), performance.now() / 1000);
      return true;
    }
    return false;
  }

  addTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.12 });
  }

  dropCash(x, z, value) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x2fae5f, emissive: 0x0a5a28 }),
    );
    mesh.position.set(x, 0.5, z);
    this.scene.add(mesh);
    this.pickups.push({
      mesh, x, z, value, phase: this.rng.range(0, 6),
      onCollect: (v) => { /* wired by main.js via onCash */ if (this.onCash) this.onCash(v); },
    });
  }

  clearPickups() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
  }
}

/** Ray vs AABB (y from 0..80). Returns distance or null. */
function rayBox(origin, dir, b) {
  let tmin = 0;
  let tmax = 200;
  const axes = [
    [origin.x, dir.x, b.minX, b.maxX],
    [origin.y, dir.y, 0, 80],
    [origin.z, dir.z, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
