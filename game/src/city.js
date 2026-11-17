// SOLMAR BAY — the city itself. A procedural coastal city: a street grid, a beach and
// ocean to the east, a downtown of towers, parks and plazas, streetlights and palms.
// All textures are drawn on canvas at runtime; no image files. Original layout and names.
import * as THREE from 'three';
import { BUILDING_COLORS, makeCanvas, makeRng } from './util.js';

export const BLOCK = 44;      // building block size (m)
export const ROAD = 14;       // road width (m)
export const PITCH = BLOCK + ROAD; // 58 m between street centrelines
export const GRID = 3;        // streets at -3..3 in each direction
export const HALF = GRID * PITCH + ROAD / 2; // ~181 m half-extent of the road grid
export const BEACH_X = HALF + 26; // sand strip east of the grid
export const SEA_X = BEACH_X + 34; // ocean starts here

export const DISTRICTS = [
  { name: 'Downtown', x: 0, z: 0 },
  { name: 'Marina District', x: 150, z: -120 },
  { name: 'Old Town', x: -140, z: 100 },
  { name: 'Palm Row', x: 120, z: 140 },
  { name: 'The Docks', x: -150, z: -140 },
];

export const LANDMARKS = [
  { name: 'Solmar Tower', x: 0, z: -29, w: 26, d: 26, h: 88, color: 0x6f87b8 },
  { name: 'Bay Bank', x: 58, z: 29, w: 24, d: 20, h: 22, color: 0xd8c9a3 },
  { name: 'Marina Hotel', x: 174, z: -116, w: 22, d: 18, h: 40, color: 0xe0b48c },
  { name: 'The Rookery Garage', x: -58, z: 87, w: 24, d: 18, h: 12, color: 0x9aa98f },
  { name: 'Pier 9', x: 232, z: -58, w: 10, d: 60, h: 0.6, color: 0x8a6f4d },
];

/** Street centrelines: streets[i] = coordinate of the i-th street. */
export function streetCoord(i) { return (i - GRID) * PITCH; }

/** Draw the ground texture: roads, sidewalks, lane dashes, crosswalks, park, beach. */
function groundTexture(rng) {
  const S = 1024;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const worldToPx = (v) => ((v + HALF + 40) / (2 * (HALF + 40))) * S;
  const scale = S / (2 * (HALF + 40));
  // Base: sidewalk grey.
  g.fillStyle = '#9a9a92';
  g.fillRect(0, 0, S, S);
  // Beach sand on the east.
  g.fillStyle = '#e3cf9e';
  g.fillRect(worldToPx(BEACH_X - 4), 0, S - worldToPx(BEACH_X - 4), S);
  // Park block (south-west) and plaza (centre-north).
  g.fillStyle = '#6fae62';
  g.fillRect(worldToPx(-PITCH - BLOCK / 2), worldToPx(PITCH - BLOCK / 2), BLOCK * scale, BLOCK * scale);
  g.fillStyle = '#b8a88a';
  g.fillRect(worldToPx(-BLOCK / 2), worldToPx(-PITCH - BLOCK / 2), BLOCK * scale, BLOCK * scale);
  // Roads: dark asphalt.
  g.fillStyle = '#3c3f45';
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    g.fillRect(worldToPx(-HALF), worldToPx(p - ROAD / 2), (2 * HALF) * scale, ROAD * scale);
    g.fillRect(worldToPx(p - ROAD / 2), worldToPx(-HALF), ROAD * scale, (2 * HALF) * scale);
  }
  // Lane dashes (yellow centre line + white lane lines).
  g.fillStyle = '#e8c832';
  g.strokeStyle = '#e8c832';
  g.lineWidth = 2;
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    g.setLineDash([14, 18]);
    g.beginPath(); g.moveTo(worldToPx(-HALF), worldToPx(p)); g.lineTo(worldToPx(HALF), worldToPx(p)); g.stroke();
    g.beginPath(); g.moveTo(worldToPx(p), worldToPx(-HALF)); g.lineTo(worldToPx(p), worldToPx(HALF)); g.stroke();
  }
  g.setLineDash([]);
  // Crosswalk stripes at every intersection.
  g.fillStyle = 'rgba(240,240,230,0.85)';
  for (let i = 0; i <= GRID * 2; i += 1) {
    for (let j = 0; j <= GRID * 2; j += 1) {
      const x = streetCoord(i), z = streetCoord(j);
      for (let k = -2; k <= 2; k += 1) {
        g.fillRect(worldToPx(x + k * 2.2 - 0.7), worldToPx(z - ROAD / 2 + 1), 1.4 * scale, 2.2 * scale);
        g.fillRect(worldToPx(x + k * 2.2 - 0.7), worldToPx(z + ROAD / 2 - 3.2), 1.4 * scale, 2.2 * scale);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Facade texture: lit windows on a coloured wall. */
function facadeTexture(baseColor, rng) {
  const c = makeCanvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 256);
  for (let y = 12; y < 244; y += 18) {
    for (let x = 10; x < 118; x += 18) {
      const lit = rng.chance(0.45);
      g.fillStyle = lit ? '#ffe9a8' : '#2c3440';
      g.fillRect(x, y, 11, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build the city into the scene. Returns collision and navigation data. */
export function buildCity(scene, seed = 1) {
  const rng = makeRng(seed);
  const colliders = [];
  const buildings = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // Sky, fog, sun.
  scene.background = new THREE.Color(0x8fc3e8);
  scene.fog = new THREE.Fog(0x9fc8e8, 260, 700);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1c8, 2.1);
  sun.position.set(120, 180, 60);
  scene.add(sun);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * (HALF + 40), 2 * (HALF + 40)),
    new THREE.MeshLambertMaterial({ map: groundTexture(rng) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, 0, 0);
  group.add(ground);

  // Ocean to the east.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 2 * (HALF + 40)),
    new THREE.MeshLambertMaterial({ color: 0x2e7fa8 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(SEA_X + 180, -0.3, 0);
  group.add(sea);

  // Clouds: flat white ellipsoids drifting high up.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 12; i += 1) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cloudMat);
    cloud.scale.set(rng.range(18, 42), rng.range(4, 7), rng.range(10, 18));
    cloud.position.set(rng.range(-320, 320), rng.range(95, 135), rng.range(-320, 320));
    group.add(cloud);
  }

  // Buildings: one InstancedMesh per facade texture variant is overkill; use per-building
  // meshes for landmarks and an InstancedMesh for the generic blocks.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const facadeMats = BUILDING_COLORS.slice(0, 6).map((col) => new THREE.MeshLambertMaterial({ map: facadeTexture(col, rng) }));
  const instances = [];
  const isPark = (bx, bz) => bx === -1 && bz === 1;
  const isPlaza = (bx, bz) => bx === 0 && bz === -1;
  const landmarkAt = (x, z) => LANDMARKS.some((l) => Math.abs(l.x - x) < l.w && Math.abs(l.z - z) < l.d);

  for (let bx = -GRID; bx <= GRID; bx += 1) {
    for (let bz = -GRID; bz <= GRID; bz += 1) {
      if (isPark(bx, bz) || isPlaza(bx, bz)) continue;
      const cx = streetCoord(bx + GRID) + ROAD / 2 + BLOCK / 2;
      const cz = streetCoord(bz + GRID) + ROAD / 2 + BLOCK / 2;
      const downtown = Math.abs(bx) <= 1 && Math.abs(bz) <= 1;
      const count = rng.int(1, 3);
      for (let k = 0; k < count; k += 1) {
        const w = rng.range(12, 20);
        const d = rng.range(12, 20);
        const x = cx + rng.range(-BLOCK / 2 + w / 2 + 2, BLOCK / 2 - w / 2 - 2);
        const z = cz + rng.range(-BLOCK / 2 + d / 2 + 2, BLOCK / 2 - d / 2 - 2);
        if (landmarkAt(x, z)) continue;
        const h = downtown ? rng.range(28, 62) : rng.range(8, 26);
        instances.push({ x, z, w, d, h, mat: rng.int(0, facadeMats.length - 1) });
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        buildings.push({ x, z, w, d, h });
      }
    }
  }
  const instanced = new THREE.InstancedMesh(boxGeo, facadeMats, instances.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  instances.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    instanced.setMatrixAt(i, m4);
    instanced.setColorAt(i, new THREE.Color(0xffffff));
  });
  // InstancedMesh with a material array is not supported; use one material and tint via
  // instance colour instead — rebuild with a single white facade material.
  instanced.material = new THREE.MeshLambertMaterial({ map: facadeTexture(0xcfc4ae, rng) });
  instanced.instanceMatrix.needsUpdate = true;
  group.add(instanced);

  // Landmark buildings (distinct meshes, taller, named).
  for (const lm of LANDMARKS) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(lm.w, lm.h, lm.d),
      new THREE.MeshLambertMaterial({ color: lm.color, map: facadeTexture(lm.color, rng) }),
    );
    mesh.position.set(lm.x, lm.h / 2, lm.z);
    group.add(mesh);
    if (lm.h > 6) colliders.push({ minX: lm.x - lm.w / 2, maxX: lm.x + lm.w / 2, minZ: lm.z - lm.d / 2, maxZ: lm.z + lm.d / 2 });
    buildings.push({ x: lm.x, z: lm.z, w: lm.w, d: lm.d, h: lm.h, name: lm.name });
  }

  // Park trees + plaza benches.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a });
  const treeGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 6);
  const leafGeo = new THREE.SphereGeometry(2.4, 8, 6);
  const parkCx = streetCoord(GRID - 1) + ROAD / 2 + BLOCK / 2;
  const parkCz = streetCoord(GRID + 1) + ROAD / 2 + BLOCK / 2;
  for (let i = 0; i < 14; i += 1) {
    const tx = parkCx + rng.range(-18, 18);
    const tz = parkCz + rng.range(-18, 18);
    const trunk = new THREE.Mesh(treeGeo, trunkMat);
    trunk.position.set(tx, 1.5, tz);
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.set(tx, 4.4, tz);
    group.add(trunk); group.add(leaves);
    colliders.push({ minX: tx - 0.6, maxX: tx + 0.6, minZ: tz - 0.6, maxZ: tz + 0.6 });
  }

  // Streetlights along every street (instanced poles + lamps).
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const lampGeo = new THREE.SphereGeometry(0.45, 8, 6);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffdf8a });
  const poles = [];
  const lamps = [];
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    for (let t = -HALF + 20; t < HALF; t += 36) {
      poles.push([p + ROAD / 2 + 0.8, t]);
      lamps.push([p + ROAD / 2 + 0.8, t]);
      poles.push([p - ROAD / 2 - 0.8, t + 18]);
      lamps.push([p - ROAD / 2 - 0.8, t + 18]);
    }
  }
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
  poles.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
    poleMesh.setMatrixAt(i, m4);
  });
  lamps.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 7, z), q, new THREE.Vector3(1, 1, 1));
    lampMesh.setMatrixAt(i, m4);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  lampMesh.instanceMatrix.needsUpdate = true;
  group.add(poleMesh); group.add(lampMesh);

  // Palm trees along the beach front.
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x7a5a34 });
  const palmLeaf = new THREE.MeshLambertMaterial({ color: 0x2f9e4f });
  for (let z = -HALF; z < HALF; z += 22) {
    const px = BEACH_X + 6 + rng.range(-2, 2);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 6), palmMat);
    trunk.position.set(px, 3, z);
    trunk.rotation.z = rng.range(-0.12, 0.12);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), palmLeaf);
    crown.scale.y = 0.5;
    crown.position.set(px, 6.4, z);
    group.add(trunk); group.add(crown);
  }

  // The Solmar lighthouse at the tip of Pier 9: the landmark you steer home by.
  // Striped tower, gallery deck, and a lamp that glows over the bay.
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xc23b2e });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 24, 12), lightMat);
  tower.position.set(232, 12, -88);
  group.add(tower);
  // Bands are sized a touch wider than the tower at their height (the tower
  // tapers from 3.2 m at the base to 2.2 m at the top), so they read as stripes.
  for (const [y, r] of [[6, 3.05], [14, 2.72], [22, 2.38]]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.06, r + 0.06, 3.4, 12), bandMat);
    band.position.set(232, y, -88);
    group.add(band);
  }
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1, 12), new THREE.MeshLambertMaterial({ color: 0x22242a }));
  gallery.position.set(232, 24.5, -88);
  group.add(gallery);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffdf8a }),
  );
  lamp.position.set(232, 26.5, -88);
  group.add(lamp);
  colliders.push({ minX: 232 - 3.2, maxX: 232 + 3.2, minZ: -88 - 3.2, maxZ: -88 + 3.2 });
  buildings.push({ x: 232, z: -88, w: 6.4, d: 6.4, h: 27, name: 'Solmar Lighthouse' });

  // Road network for traffic + pedestrians: streets as axis-aligned lines.
  const streets = [];
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    streets.push({ axis: 'x', at: p, from: -HALF, to: HALF }); // runs east-west at z=p
    streets.push({ axis: 'z', at: p, from: -HALF, to: HALF }); // runs north-south at x=p
  }
  return { colliders, buildings, streets, group, bounds: { half: HALF, beachX: BEACH_X, seaX: SEA_X } };
}

/** Resolve a circle (x, z, radius) against building AABBs. Returns corrected [x, z]. */
export function collideCircle(colliders, x, z, radius) {
  for (let i = 0; i < colliders.length; i += 1) {
    const b = colliders[i];
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * radius;
        z = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pushL = x - b.minX + radius;
        const pushR = b.maxX - x + radius;
        const pushT = z - b.minZ + radius;
        const pushB = b.maxZ - z + radius;
        const m = Math.min(pushL, pushR, pushT, pushB);
        if (m === pushL) x = b.minX - radius;
        else if (m === pushR) x = b.maxX + radius;
        else if (m === pushT) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
    }
  }
  return [x, z];
}

/** Is a point on a road (within the asphalt)? */
export function onRoad(x, z) {
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    if (Math.abs(z - p) < ROAD / 2 - 0.5) return true;
    if (Math.abs(x - p) < ROAD / 2 - 0.5) return true;
  }
  return false;
}

/** Nearest point on the road grid to (x, z), snapped to a lane centre. */
export function nearestRoadPoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i <= GRID * 2; i += 1) {
    const p = streetCoord(i);
    const d1 = Math.abs(z - p);
    if (d1 < bestD) { bestD = d1; best = { x, z: p, axis: 'x' }; }
    const d2 = Math.abs(x - p);
    if (d2 < bestD) { bestD = d2; best = { x: p, z, axis: 'z' }; }
  }
  return best;
}
