// Vehicles for SOLMAR BAY: car meshes built from boxes, arcade driving physics,
// parked cars to steal, and traffic that follows the street grid.
import * as THREE from 'three';
import { CAR_COLORS, CAR_NAMES, clamp, dist2d, makeRng } from './util.js';
import { collideCircle, nearestRoadPoint, streetCoord, PITCH, GRID, HALF, ROAD } from './city.js';

export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 2.0;

/** Build a car mesh group. `police` gives black-and-white livery + light bar. */
export function buildCarMesh(color, police = false, taxi = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14161c });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc4d8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, 0.75, CAR_LENGTH), paint);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH - 0.3, 0.65, CAR_LENGTH * 0.5), glass);
  cabin.position.set(0, 1.2, -0.25);
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH - 0.25, 0.1, CAR_LENGTH * 0.48), paint);
  roof.position.set(0, 1.55, -0.25);
  group.add(roof);
  // Headlights + taillights.
  const lightGeo = new THREE.BoxGeometry(0.35, 0.16, 0.08);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xddc860 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xc02020, emissive: 0x800808 });
  for (const sx of [-0.65, 0.65]) {
    const h = new THREE.Mesh(lightGeo, headMat);
    h.position.set(sx, 0.62, CAR_LENGTH / 2 + 0.02);
    group.add(h);
    const t = new THREE.Mesh(lightGeo, tailMat);
    t.position.set(sx, 0.62, -CAR_LENGTH / 2 - 0.02);
    group.add(t);
  }
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(wx, 0.38, wz);
    group.add(w);
    wheels.push(w);
  }
  let lightBar = null;
  if (police) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0xaa0000 }));
    red.position.x = -0.28;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshLambertMaterial({ color: 0x2040ff, emissive: 0x0000aa }));
    blue.position.x = 0.28;
    bar.add(red); bar.add(blue);
    bar.position.set(0, 1.68, -0.25);
    group.add(bar);
    lightBar = bar;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 1.6), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    door.position.set(-CAR_WIDTH / 2 - 0.01, 0.6, 0);
    group.add(door);
  }
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), new THREE.MeshLambertMaterial({ color: 0xf2c200, emissive: 0x8a7000 }));
    sign.position.set(0, 1.68, -0.25);
    group.add(sign);
  }
  group.userData.wheels = wheels;
  group.userData.lightBar = lightBar;
  return group;
}

/** One car in the world: physics state + mesh + role. */
export class Car {
  constructor(scene, x, z, heading, color, opts = {}) {
    this.scene = scene;
    this.x = x; this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.color = color;
    this.name = opts.name || 'Car';
    this.role = opts.role || 'parked'; // parked | traffic | player | police
    this.police = !!opts.police;
    this.taxi = !!opts.taxi;
    this.driver = opts.driver || null; // 'player' | 'ai' | null
    this.mesh = buildCarMesh(color, this.police, this.taxi);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    // Traffic AI state.
    this.routeAxis = 'x';
    this.routeAt = z;
    this.routeDir = 1;
    this.routeFrom = -HALF;
    this.routeTo = HALF;
    this.stopped = 0;
    this.brakeLight = 0;
  }

  get forwardX() { return Math.sin(this.heading); }
  get forwardZ() { return Math.cos(this.heading); }

  /** Arcade driving step. `input` = {throttle, brake, steer} in [-1,1]. */
  drive(dt, input, colliders, otherCars) {
    const maxSpeed = this.police ? 34 : 30;
    const accel = 14;
    const brakePower = 26;
    if (input.throttle > 0) this.speed += accel * input.throttle * dt;
    if (input.throttle < 0) this.speed += accel * 0.6 * input.throttle * dt; // reverse
    if (input.brake > 0) {
      const s = Math.sign(this.speed);
      this.speed -= s * brakePower * dt;
      if (Math.sign(this.speed) !== s) this.speed = 0;
    }
    // Drag + rolling resistance.
    this.speed -= this.speed * 0.55 * dt;
    this.speed = clamp(this.speed, -10, maxSpeed);
    // Steering: stronger at low speed, none when stopped.
    const steerTarget = clamp(input.steer, -1, 1);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const speedFactor = clamp(Math.abs(this.speed) / 8, 0, 1);
    this.heading += this.steer * 1.9 * speedFactor * Math.sign(this.speed || 1) * dt;
    const nx = this.x + this.forwardX * this.speed * dt;
    const nz = this.z + this.forwardZ * this.speed * dt;
    const [cx0, cz0] = collideCircle(colliders, nx, nz, 1.9);
    let cx = cx0, cz = cz0;
    const hitWall = (cx !== nx || cz !== nz);
    if (hitWall) {
      if (Math.abs(this.speed) > 6) this.speed *= -0.25;
      else this.speed *= 0.5;
    }
    // Soft car-car collision: push apart, lose speed. (Accumulate the push
    // into cx/cz — writing it to this.x here used to be overwritten by the
    // final assignment below, so cars overlapped instead of shoving apart.)
    for (const other of otherCars) {
      if (other === this) continue;
      const d = dist2d(cx, cz, other.x, other.z);
      if (d < 3.4 && d > 0.001) {
        const push = (3.4 - d) / 2;
        const ux = (cx - other.x) / d;
        const uz = (cz - other.z) / d;
        cx += ux * push;
        cz += uz * push;
        this.speed *= 0.7;
        other.speed *= 0.7;
      }
    }
    this.x = cx; this.z = cz;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Spin wheels + lean the body a touch.
    const spin = (this.speed * dt) / 0.38;
    for (const w of this.mesh.userData.wheels) w.rotation.x += spin;
    this.mesh.rotation.z = -this.steer * 0.04 * speedFactor;
    return hitWall;
  }

  /** Traffic AI: follow a street, stop for cars ahead, turn at intersections.
   *  `lights` (optional TrafficLights) makes the car stop at a red light
   *  instead of rolling through the crossing. */
  updateTraffic(dt, colliders, allCars, rng, lights = null) {
    if (this.stopped > 0) {
      this.stopped -= dt;
      this.drive(dt, { throttle: 0, brake: 1, steer: 0 }, colliders, allCars);
      return;
    }
    // Pick a new route when reaching the end.
    const along = this.routeAxis === 'x' ? this.x : this.z;
    const end = this.routeDir > 0 ? this.routeTo : this.routeFrom;
    if ((this.routeDir > 0 && along > end - 4) || (this.routeDir < 0 && along < end + 4)) {
      this.chooseRoute(rng);
    }
    // Target heading along the route.
    const targetHeading = this.routeAxis === 'x'
      ? (this.routeDir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (this.routeDir > 0 ? 0 : Math.PI);
    let steer = clamp(((targetHeading - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1, 1) * 1.4;
    // Lane offset: keep to the right of the road centre.
    const lateral = this.routeAxis === 'x' ? (this.z - this.routeAt) : (this.x - this.routeAt);
    steer -= clamp(lateral * 0.25, -0.6, 0.6) * this.routeDir;
    // Look ahead for a slow/stopped car; brake if too close.
    let brake = 0;
    let throttle = 0.55;
    for (const other of allCars) {
      if (other === this) continue;
      const dx = other.x - this.x;
      const dz = other.z - this.z;
      const ahead = dx * this.forwardX + dz * this.forwardZ;
      const side = Math.abs(dx * this.forwardZ - dz * this.forwardX);
      if (ahead > 0 && ahead < 12 && side < 2.6) { brake = 1; throttle = 0; break; }
    }
    // Stop at a red (or yellow) light: brake while the stop line is 8–16 m
    // ahead; inside the crossing already, keep rolling through.
    if (lights) {
      const ahead = lights.lightAhead(this.x, this.z, this.routeAxis, this.routeDir);
      if (ahead && ahead.dist >= 8 && ahead.dist < 16 && ahead.phase !== 'green') {
        brake = 1;
        throttle = 0;
      }
    }
    this.drive(dt, { throttle, brake, steer: clamp(steer, -1, 1) }, colliders, allCars);
    // Cap traffic speed.
    if (this.speed > 11) this.speed = 11;
  }

  chooseRoute(rng) {
    // At an intersection, pick a street and a direction; prefer continuing straight.
    const streets = [];
    for (let i = 0; i <= GRID * 2; i += 1) streets.push(streetCoord(i));
    const at = this.routeAxis === 'x' ? this.z : this.x;
    const cross = streets.reduce((best, s) => (Math.abs(s - at) < Math.abs(best - at) ? s : best), streets[0]);
    const lane = 3.2;
    if (rng.chance(0.55)) {
      // Continue on the same street, possibly flipping direction.
      this.routeAxis = this.routeAxis;
      if (rng.chance(0.3)) this.routeDir *= -1;
      this.routeAt = cross + (this.routeDir > 0 ? lane : -lane) * (this.routeAxis === 'x' ? 1 : -1);
    } else {
      // Turn onto the crossing street.
      const oldAxis = this.routeAxis;
      this.routeAxis = oldAxis === 'x' ? 'z' : 'x';
      this.routeDir = rng.chance(0.5) ? 1 : -1;
      this.routeAt = cross + (this.routeDir > 0 ? lane : -lane) * (this.routeAxis === 'x' ? 1 : -1);
      this.routeFrom = -HALF;
      this.routeTo = HALF;
    }
    // Snap the car onto its lane so it does not drift through blocks.
    if (this.routeAxis === 'x') this.z = this.routeAt;
    else this.x = this.routeAt;
  }

  remove() {
    this.scene.remove(this.mesh);
  }
}

/** Spawn parked cars along roads and a few traffic cars. */
export function spawnCars(scene, seed, colliders) {
  const rng = makeRng(seed + 77);
  const cars = [];
  const streets = [];
  for (let i = 0; i <= GRID * 2; i += 1) streets.push(streetCoord(i));
  // Parked cars: along the kerb of random streets.
  let parked = 0;
  let guard = 0;
  while (parked < 16 && guard < 200) {
    guard += 1;
    const street = rng.pick(streets);
    const along = rng.range(-HALF + 16, HALF - 16);
    const horizontal = rng.chance(0.5);
    const x = horizontal ? along : street + (rng.chance(0.5) ? 5.2 : -5.2);
    const z = horizontal ? street + (rng.chance(0.5) ? 5.2 : -5.2) : along;
    const heading = horizontal ? (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (rng.chance(0.5) ? 0 : Math.PI);
    if (cars.some((c) => dist2d(c.x, c.z, x, z) < 9)) continue;
    if (collideCircle(colliders, x, z, 2.2)[0] !== x) continue;
    const color = rng.pick(CAR_COLORS);
    const car = new Car(scene, x, z, heading, color, { role: 'parked', name: rng.pick(CAR_NAMES), taxi: rng.chance(0.12) });
    cars.push(car);
    parked += 1;
  }
  // Traffic cars: on the roads, already moving.
  for (let i = 0; i < 10; i += 1) {
    const street = rng.pick(streets);
    const along = rng.range(-HALF + 20, HALF - 20);
    const horizontal = rng.chance(0.5);
    const lane = 3.2;
    const x = horizontal ? along : street + lane;
    const z = horizontal ? street + lane : along;
    const heading = horizontal ? Math.PI / 2 : 0;
    const color = rng.pick(CAR_COLORS);
    const car = new Car(scene, x, z, heading, color, { role: 'traffic', name: rng.pick(CAR_NAMES), taxi: rng.chance(0.15) });
    car.routeAxis = horizontal ? 'x' : 'z';
    car.routeAt = horizontal ? z : x;
    car.routeDir = 1;
    car.speed = rng.range(6, 10);
    cars.push(car);
  }
  return cars;
}
