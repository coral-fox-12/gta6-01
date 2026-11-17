// Rook Marlowe, the player: third-person on-foot movement with mouse-look camera,
// jumping, sprinting, and getting in and out of cars.
import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { collideCircle } from './city.js';

const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8.2;
const JUMP_VEL = 8.5;
const GRAVITY = -24;

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.x = 0; this.z = 40;
    this.y = 0;
    this.vy = 0;
    this.heading = Math.PI; // facing north (-z)
    this.camYaw = Math.PI;
    this.camPitch = 0.32;
    this.camDist = 6.5;
    this.health = 100;
    this.maxHealth = 100;
    this.inCar = null;
    this.onGround = true;
    this.moving = false;
    this.walkPhase = 0;
    this.lastDamageAt = -99;
    this.buildMesh();
  }

  buildMesh() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
    const jacket = new THREE.MeshLambertMaterial({ color: 0x2e6f6f });
    const jeans = new THREE.MeshLambertMaterial({ color: 0x2c3a4a });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), skin);
    head.position.y = 1.66;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshLambertMaterial({ color: 0x1a1210 }));
    hair.position.y = 1.72; hair.scale.set(1, 0.7, 1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.68, 0.3), jacket);
    body.position.y = 1.14;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.22), jeans);
    legL.position.set(-0.15, 0.44, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.22), jeans);
    legR.position.set(0.15, 0.44, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), jacket);
    armL.position.set(-0.36, 1.15, 0);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), jacket);
    armR.position.set(0.36, 1.15, 0);
    g.add(head, hair, body, legL, legR, armL, armR);
    this.mesh = g;
    this.legL = legL; this.legR = legR;
    this.armL = armL; this.armR = armR;
    this.body = body;
    this.scene.add(g);
    // Fake blob shadow.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.shadow = shadow;
    this.scene.add(shadow);
  }

  get pos() { return { x: this.x, y: this.y, z: this.z }; }

  /** Mouse look: dx/dy in pixels. */
  look(dx, dy) {
    this.camYaw -= dx * 0.0026;
    this.camPitch = clamp(this.camPitch + dy * 0.0022, -0.12, 1.15);
  }

  /** On-foot step. `keys` is the input state. Returns true if moving. */
  updateOnFoot(dt, keys, colliders) {
    const fwdX = Math.sin(this.camYaw);
    const fwdZ = Math.cos(this.camYaw);
    const rightX = Math.cos(this.camYaw);
    const rightZ = -Math.sin(this.camYaw);
    let mx = 0, mz = 0;
    if (keys.forward) { mx += fwdX; mz += fwdZ; }
    if (keys.back) { mx -= fwdX; mz -= fwdZ; }
    if (keys.left) { mx -= rightX; mz -= rightZ; }
    if (keys.right) { mx += rightX; mz += rightZ; }
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    if (this.moving) {
      mx /= len; mz /= len;
      const speed = keys.sprint ? SPRINT_SPEED : WALK_SPEED;
      const nx = this.x + mx * speed * dt;
      const nz = this.z + mz * speed * dt;
      const [cx, cz] = collideCircle(colliders, nx, nz, 0.5);
      this.x = cx; this.z = cz;
      // Face movement direction.
      const targetHeading = Math.atan2(mx, mz);
      let dh = targetHeading - this.heading;
      dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.heading += dh * Math.min(1, dt * 12);
      this.walkPhase += dt * speed * 2.2;
    }
    // Jump + gravity.
    if (keys.jump && this.onGround) {
      this.vy = JUMP_VEL;
      this.onGround = false;
    }
    if (!this.onGround) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.onGround = true; }
    }
    // Animate legs/arms.
    const swing = this.moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.7;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
    this.shadow.position.set(this.x, 0.02, this.z);
    this.shadow.material.opacity = this.onGround ? 0.28 : 0.15;
  }

  enterCar(car) {
    this.inCar = car;
    car.driver = 'player';
    car.role = 'player';
    this.mesh.visible = false;
    this.shadow.visible = false;
  }

  exitCar() {
    const car = this.inCar;
    if (!car) return;
    car.driver = null;
    car.role = car.police ? 'police' : 'parked';
    car.speed = 0;
    // Step out to the left of the car.
    const sideX = Math.cos(car.heading);
    const sideZ = -Math.sin(car.heading);
    this.x = car.x + sideX * 2.2;
    this.z = car.z + sideZ * 2.2;
    this.y = 0;
    this.inCar = null;
    this.mesh.visible = true;
    this.shadow.visible = true;
    this.mesh.position.set(this.x, 0, this.z);
  }

  takeDamage(amount, now) {
    this.health = Math.max(0, this.health - amount);
    this.lastDamageAt = now;
  }

  /** Slow health regen after 6 s without damage. */
  regen(dt, now) {
    if (this.health > 0 && this.health < this.maxHealth && now - this.lastDamageAt > 6) {
      this.health = Math.min(this.maxHealth, this.health + 4 * dt);
    }
  }

  /** Third-person camera. Returns the camera position + look target. */
  cameraTarget(camera, dt, colliders) {
    let cx, cy, cz, tx, ty, tz;
    if (this.inCar) {
      const car = this.inCar;
      const back = 9.5 + Math.abs(car.speed) * 0.12;
      const height = 3.6 + Math.abs(car.speed) * 0.02;
      const bx = -Math.sin(car.heading);
      const bz = -Math.cos(car.heading);
      tx = car.x + Math.sin(car.heading) * 6;
      tz = car.z + Math.cos(car.heading) * 6;
      ty = 1.4;
      cx = car.x + bx * back;
      cz = car.z + bz * back;
      cy = height;
    } else {
      tx = this.x + Math.sin(this.camYaw) * 4;
      tz = this.z + Math.cos(this.camYaw) * 4;
      ty = 1.6 + this.y;
      const pitch = this.camPitch;
      const dist = this.camDist;
      const dx = -Math.sin(this.camYaw) * Math.cos(pitch);
      const dz = -Math.cos(this.camYaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      // Pull the camera in if a building is in the way.
      let useDist = dist;
      for (let d = dist; d >= 2.4; d -= 0.6) {
        const px = this.x + dx * d;
        const pz = this.z + dz * d;
        const inside = colliders.some((b) => px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ);
        if (!inside) { useDist = d; break; }
        useDist = 2.4;
      }
      cx = this.x + dx * useDist;
      cz = this.z + dz * useDist;
      cy = Math.max(0.6, 1.7 + this.y + dy * useDist);
    }
    // Smooth the camera.
    const k = 1 - Math.exp(-dt * 14);
    camera.position.x += (cx - camera.position.x) * k;
    camera.position.y += (cy - camera.position.y) * k;
    camera.position.z += (cz - camera.position.z) * k;
    camera.lookAt(tx, ty, tz);
  }

  reset(x, z) {
    if (this.inCar) this.exitCar();
    this.x = x; this.z = z; this.y = 0;
    this.health = this.maxHealth;
    this.heading = Math.PI;
    this.camYaw = Math.PI;
    this.mesh.position.set(x, 0, z);
  }
}
