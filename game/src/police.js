// Solmar Bay Police Department: the wanted system, police cars and foot cops.
// Crimes raise heat; the SBPD chases, rams and arrests. Lose them to cool off.
import * as THREE from 'three';
import { Car } from './vehicles.js';
import { clamp, dist2d, makeRng } from './util.js';
import { collideCircle, HALF } from './city.js';

export const MAX_WANTED = 5;

export class Police {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.wanted = 0;
    this.heat = 0; // 0..100 within the current star level
    this.cars = [];
    this.cops = [];
    this.hiddenTimer = 0;
    this.lastSeenTimer = 0;
    this.arrestTimer = 0;
    this.busted = false;
    this.rng = makeRng(99);
    this.sirenOn = false;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /** Add wanted stars for a crime. Returns the new level. */
  addCrime(stars, reason) {
    const before = this.wanted;
    this.wanted = clamp(this.wanted + stars, 0, MAX_WANTED);
    this.heat = 40;
    this.lastSeenTimer = 0;
    if (this.wanted > before) this.syncForce();
    return { before, after: this.wanted, reason };
  }

  setWanted(level) {
    this.wanted = clamp(level, 0, MAX_WANTED);
    this.heat = 60;
    this.syncForce();
  }

  /** Spawn/despawn police units to match the wanted level. */
  syncForce() {
    const wantCars = this.wanted >= 2 ? Math.min(3, this.wanted - 1) : 0;
    const wantCops = this.wanted >= 1 ? Math.min(4, this.wanted + 1) : 0;
    while (this.cars.length < wantCars) this.spawnCar();
    while (this.cars.length > wantCars) this.cars.pop().remove();
    while (this.cops.length < wantCops) this.spawnCop();
    while (this.cops.length > wantCops) this.cops.pop().remove();
  }

  spawnPointNear(px, pz, minD, maxD) {
    for (let i = 0; i < 12; i += 1) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(minD, maxD);
      const x = clamp(px + Math.sin(a) * d, -HALF, HALF);
      const z = clamp(pz + Math.cos(a) * d, -HALF, HALF);
      if (collideCircle(this.colliders, x, z, 2)[0] === x) return { x, z };
    }
    return { x: clamp(px + 40, -HALF, HALF), z: pz };
  }

  spawnCar() {
    const p = this.playerPos || { x: 0, z: 0 };
    const spot = this.spawnPointNear(p.x, p.z, 45, 70);
    const car = new Car(this.scene, spot.x, spot.z, this.rng.range(0, Math.PI * 2), 0x1a1d24, {
      role: 'police', police: true, name: 'SBPD Interceptor',
    });
    car.speed = 8;
    this.cars.push(car);
  }

  spawnCop() {
    const p = this.playerPos || { x: 0, z: 0 };
    const spot = this.spawnPointNear(p.x, p.z, 18, 30);
    const cop = new Cop(this.scene, spot.x, spot.z, this.rng);
    this.cops.push(cop);
  }

  /** Per-frame update. `player` is the Player, `cars` all cars. Returns events. */
  update(dt, player, cars, now) {
    this.playerPos = { x: player.inCar ? player.inCar.x : player.x, z: player.inCar ? player.inCar.z : player.z };
    const px = this.playerPos.x;
    const pz = this.playerPos.z;
    const events = [];
    // How close is the nearest unit? If none can see the player, heat cools.
    let nearest = Infinity;
    for (const c of this.cars) nearest = Math.min(nearest, dist2d(c.x, c.z, px, pz));
    for (const c of this.cops) nearest = Math.min(nearest, dist2d(c.x, c.z, px, pz));
    const seen = nearest < 70 || this.wanted === 0;
    if (this.wanted > 0) {
      if (seen) {
        this.lastSeenTimer = 0;
        this.hiddenTimer = 0;
      } else {
        this.lastSeenTimer += dt;
        this.hiddenTimer += dt;
        // Lose a star after being unseen long enough (faster at low wanted).
        const need = 8 + this.wanted * 4;
        if (this.hiddenTimer > need) {
          this.wanted -= 1;
          this.hiddenTimer = 0;
          this.syncForce();
          events.push({ type: 'wanted-down', level: this.wanted });
        }
      }
    }
    this.sirenOn = this.wanted > 0 && nearest < 90;
    // Police cars pursue and ram.
    for (const car of this.cars) {
      this.pursueCar(car, dt, px, pz, cars, player);
      const d = dist2d(car.x, car.z, px, pz);
      if (d < 3.2 && player.inCar) {
        // Ram: shove the player's car and slow it.
        const ux = (px - car.x) / (d || 1);
        const uz = (pz - car.z) / (d || 1);
        player.inCar.x += ux * 1.6;
        player.inCar.z += uz * 1.6;
        player.inCar.speed *= 0.55;
        events.push({ type: 'ram' });
      }
    }
    // Foot cops chase; arrest on contact when the player is on foot and slow.
    for (const cop of this.cops) {
      cop.update(dt, px, pz, this.colliders);
      const d = dist2d(cop.x, cop.z, px, pz);
      if (!player.inCar && d < 1.6) {
        this.arrestTimer += dt;
        if (this.arrestTimer > 1.2) {
          this.busted = true;
          events.push({ type: 'busted' });
        }
      } else {
        this.arrestTimer = Math.max(0, this.arrestTimer - dt * 2);
      }
    }
    return events;
  }

  /** Simple pursuit steering for a police car. */
  pursueCar(car, dt, px, pz, allCars, player) {
    const dx = px - car.x;
    const dz = pz - car.z;
    const dist = Math.hypot(dx, dz);
    const targetHeading = Math.atan2(dx, dz);
    let dh = targetHeading - car.heading;
    dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steer = clamp(dh * 1.6, -1, 1);
    // Ease off when very close so it rams instead of orbiting.
    const throttle = dist > 6 ? 1 : 0.7;
    const brake = dist < 2.5 ? 1 : 0;
    car.drive(dt, { throttle, brake, steer }, this.colliders, allCars);
    // Police are a bit faster than traffic.
    if (car.speed > 30) car.speed = 30;
    // Flash the light bar.
    if (car.mesh.userData.lightBar) {
      car.mesh.userData.lightBar.visible = Math.floor(performance.now() / 220) % 2 === 0;
    }
  }

  clearAll() {
    for (const c of this.cars) c.remove();
    for (const c of this.cops) c.remove();
    this.cars = [];
    this.cops = [];
    this.wanted = 0;
    this.heat = 0;
    this.busted = false;
    this.arrestTimer = 0;
  }

  reset() { this.clearAll(); }
}

/** A foot cop: runs at the player, baton ready. */
class Cop {
  constructor(scene, x, z, rng) {
    this.scene = scene;
    this.x = x; this.z = z;
    this.heading = 0;
    this.speed = rng.range(5.2, 6.2);
    this.walkPhase = rng.range(0, Math.PI * 2);
    const navy = new THREE.MeshLambertMaterial({ color: 0x1d2a4a });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
    head.position.y = 1.62;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 10), navy);
    cap.position.y = 1.78;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.66, 0.3), navy);
    body.position.y = 1.12;
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), new THREE.MeshLambertMaterial({ color: 0xe8c832 }));
    badge.position.set(0.14, 1.3, 0.16);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), navy);
    legL.position.set(-0.14, 0.42, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), navy);
    legR.position.set(0.14, 0.42, 0);
    g.add(head, cap, body, badge, legL, legR);
    g.position.set(x, 0, z);
    this.mesh = g;
    this.legL = legL; this.legR = legR;
    scene.add(g);
  }

  update(dt, px, pz, colliders) {
    const dx = px - this.x;
    const dz = pz - this.z;
    const target = Math.atan2(dx, dz);
    let dh = target - this.heading;
    dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading += clamp(dh, -1, 1) * 4 * dt;
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const [cx, cz] = collideCircle(colliders, nx, nz, 0.5);
    this.x = cx; this.z = cz;
    this.walkPhase += dt * this.speed * 2.6;
    this.legL.rotation.x = Math.sin(this.walkPhase) * 0.7;
    this.legR.rotation.x = -Math.sin(this.walkPhase) * 0.7;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  remove() { this.scene.remove(this.mesh); }
}
