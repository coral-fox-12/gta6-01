// Screenshot scenes for SOLMAR BAY (?shot=start|drive|chase|street).
// Each one plays the real game forward from a fresh world — the same code a player
// runs — and poses it so the frame shows the city, the HUD and the systems at work.
// No staged art: these are real renders of the live game.
import { dist2d } from './util.js';

/**
 * Stage a scene. `api` is the live game interface main.js provides:
 * showTitle(), startGame(), teleportPlayer(x,z), putPlayerInCar(car),
 * nearestCarTo(x,z), setWanted(n), startMission(i), setAutopilot(on),
 * spawnPoliceChase(), getState().
 * Returns the screen the shot should show.
 */
export function stageShot(name, api) {
  if (name === 'start') {
    api.showTitle();
    return 'title';
  }
  api.startGame();
  if (name === 'chase') {
    // Rook mid-getaway: 3 stars, SBPD interceptors on his tail, mission 3 live.
    api.startMission(2);
    const car = api.nearestCarTo(0, 0);
    api.putPlayerInCar(car);
    api.setWanted(3);
    api.spawnPoliceChase();
    api.setAutopilot(true);
    // Stage ON a road: (0,-40) was inside a building block, so the car wedged
    // against the facade and never got moving. z=-58 is a street centreline.
    api.teleportCar(0, -58, Math.PI / 2);
    api.clearMessage();
    return 'play';
  }
  if (name === 'street') {
    // On foot in Downtown with the mission marker ahead, traffic and peds around.
    api.startMission(0);
    // (-20,20) was inside a building block; (-24,0) is on the z=0 street.
    api.teleportPlayer(-24, 0);
    api.setAutopilot(false);
    api.clearMessage();
    return 'play';
  }
  // Default: 'drive' — cruising toward the Marina in a stolen car, mission 1 live.
  // z=-58 is a street; heading +x runs it east past the Marina toward Pier 9
  // and the sea, so the frame has a vista instead of a building face.
  api.startMission(0);
  const car = api.nearestCarTo(150, -100);
  api.putPlayerInCar(car);
  api.setAutopilot(true);
  api.teleportCar(140, -58, Math.PI / 2);
  api.clearMessage();
  return 'play';
  api.setAutopilot(true);
  return 'play';
}

/** Steer an autopilot car along the road grid (used by the drive/chase shots). */
export function autopilotInput(game, dt) {
  const car = game.player.inCar;
  if (!car) return { throttle: 0, brake: 0, steer: 0 };
  // Stay on the nearest road centreline: pick the street we are closest to.
  const streets = [];
  for (let i = -3; i <= 3; i += 1) streets.push(i * 58);
  let best = streets[0];
  let bestD = Infinity;
  let axis = 'x';
  for (const s of streets) {
    const dz = Math.abs(car.z - s);
    if (dz < bestD) { bestD = dz; best = s; axis = 'x'; }
    const dx = Math.abs(car.x - s);
    if (dx < bestD) { bestD = dx; best = s; axis = 'z'; }
  }
  // Desired heading: along the road, in the direction we are already facing.
  // Steer toward a point 14 m ahead on the current lane centre.
  let lookX, lookZ;
  if (axis === 'x') {
    const lane = best + (Math.sin(car.heading) > 0 ? 3.2 : -3.2);
    lookX = car.x + Math.sin(car.heading) * 14;
    lookZ = lane;
  } else {
    const lane = best + (Math.cos(car.heading) > 0 ? 3.2 : -3.2);
    lookX = lane;
    lookZ = car.z + Math.cos(car.heading) * 14;
  }
  const desired = Math.atan2(lookX - car.x, lookZ - car.z);
  let dh = desired - car.heading;
  dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const steer = Math.max(-1, Math.min(1, dh * 1.8));
  // Slow down for the car ahead.
  let throttle = 0.8;
  let brake = 0;
  for (const other of game.cars) {
    if (other === car) continue;
    const d = dist2d(car.x, car.z, other.x, other.z);
    const ahead = (other.x - car.x) * Math.sin(car.heading) + (other.z - car.z) * Math.cos(car.heading);
    if (ahead > 0 && ahead < 14 && d < 4) { throttle = 0; brake = 1; break; }
  }
  // Stop at a red (or yellow) light, same rule as the traffic AI: brake while
  // the stop line is 8–15 m ahead; already inside the crossing, roll through.
  if (game.trafficLights) {
    const dir = axis === 'x'
      ? (Math.sin(car.heading) > 0 ? 1 : -1)
      : (Math.cos(car.heading) > 0 ? 1 : -1);
    const light = game.trafficLights.lightAhead(car.x, car.z, axis, dir);
    if (light && light.dist >= 8 && light.dist < 15 && light.phase !== 'green') {
      throttle = 0;
      brake = 1;
    }
  }
  return { throttle, brake, steer };
}
