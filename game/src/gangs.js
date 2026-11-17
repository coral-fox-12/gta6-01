// Roaming gangs for SOLMAR BAY: The Vipers and The Gull Kings, the two hostile
// factions after the SBPD. Vipers wear purple jackets and bandanas and hold turf
// in the Docks (and a pair watching Old Town). Gull Kings wear teal jackets and
// gold bandanas and hold the Boardwalk (and a pair watching the Marina). They
// patrol their streets on foot and turn hostile when the player walks into
// their turf — or when the player shoots one of their own, at which point the
// whole gang comes looking. Wiped patrols come back after a while, as long as
// the player is not standing in the turf.
import { dist2d, makeRng } from './util.js';
import { streetCoord, GRID } from './city.js';

export const GANG_NAME = 'The Vipers';
export const GANG_TURF = { x: -140, z: -140, r: 60, name: 'The Docks' };
export const GULL_NAME = 'The Gull Kings';
export const GULL_TURF = { x: 196, z: -16, r: 55, name: 'The Boardwalk' };

/** Two waypoints up and down the street the gang member stands on, so the
 *  patrol walks the road instead of cutting through building blocks. */
function patrolAlong(x, z) {
  const streets = [];
  for (let i = 0; i <= GRID * 2; i += 1) streets.push(streetCoord(i));
  const dz = Math.min(...streets.map((s) => Math.abs(s - z)));
  const dx = Math.min(...streets.map((s) => Math.abs(s - x)));
  if (dz <= dx) return [[x - 18, z], [x + 18, z]]; // on an east-west street
  return [[x, z - 18], [x, z + 18]]; // on a north-south street
}

export class Gangs {
  constructor(scene, combat) {
    this.scene = scene;
    this.combat = combat;
    this.rng = makeRng(777);
    this.members = [];
    this.gulls = [];
    this.respawnTimer = 0;
    this.gullRespawnTimer = 0;
    this.spawnPatrols();
    this.spawnGullPatrols();
  }

  spawnPatrols() {
    // Docks crew (4) walks the turf; an Old Town pair (2) watches the Rookery.
    const docks = [[-128, -116], [-104, -116], [-116, -152], [-116, -128]];
    docks.forEach(([x, z], i) => this.spawnViper(x, z, 'Viper ' + (i + 1), patrolAlong(x, z)));
    const oldTown = [[-128, 116], [-104, 116]];
    oldTown.forEach(([x, z], i) => this.spawnViper(x, z, 'Viper ' + (i + 5), patrolAlong(x, z)));
  }

  spawnGullPatrols() {
    // Boardwalk crew (4) walks the beach front; a Marina pair (2) watches the
    // approach from the Marina District. Pier 9 sits just outside the turf
    // (55 m from its centre), so the Drop pickup is not a war zone.
    const boardwalk = [[196, 0], [196, -116], [174, 0], [174, -58]];
    boardwalk.forEach(([x, z], i) => this.spawnGullKing(x, z, 'Gull King ' + (i + 1), patrolAlong(x, z)));
    const marina = [[116, -116], [116, -58]];
    marina.forEach(([x, z], i) => this.spawnGullKing(x, z, 'Gull King ' + (i + 5), patrolAlong(x, z)));
  }

  spawnViper(x, z, name, patrol) {
    const e = this.combat.spawnEnemy(x, z, name, 60, {
      faction: 'viper', jacket: 0x7a2e8f, bandana: 0x7a2e8f, patrol,
    });
    this.members.push(e);
    return e;
  }

  spawnGullKing(x, z, name, patrol) {
    const e = this.combat.spawnEnemy(x, z, name, 60, {
      faction: 'gull', jacket: 0x0e7c86, bandana: 0xe8c832, patrol,
    });
    this.gulls.push(e);
    return e;
  }

  /** Prune the downed, and bring the patrols back if the turf is clear. */
  update(dt, px, pz) {
    this.members = this.members.filter((e) => e.state !== 'down');
    if (this.members.length === 0) {
      this.respawnTimer += dt;
      if (this.respawnTimer > 45 && dist2d(px, pz, GANG_TURF.x, GANG_TURF.z) > 80) {
        this.spawnPatrols();
        this.combat.gangAggro = false;
        this.respawnTimer = 0;
      }
    } else {
      this.respawnTimer = 0;
    }
    this.gulls = this.gulls.filter((e) => e.state !== 'down');
    if (this.gulls.length === 0) {
      this.gullRespawnTimer += dt;
      if (this.gullRespawnTimer > 45 && dist2d(px, pz, GULL_TURF.x, GULL_TURF.z) > 80) {
        this.spawnGullPatrols();
        this.combat.gullAggro = false;
        this.gullRespawnTimer = 0;
      }
    } else {
      this.gullRespawnTimer = 0;
    }
  }

  /** Fresh patrols after a New Game, a load, or being busted/flatlined:
   *  clearEnemies already removed the old members from the scene. */
  reset() {
    for (const e of this.members) this.combat.removeEnemy(e);
    for (const e of this.gulls) this.combat.removeEnemy(e);
    this.members = [];
    this.gulls = [];
    this.respawnTimer = 0;
    this.gullRespawnTimer = 0;
    this.combat.gangAggro = false;
    this.combat.gullAggro = false;
    this.spawnPatrols();
    this.spawnGullPatrols();
  }

  get alive() { return this.members.length; }
  get gullAlive() { return this.gulls.length; }
  inTurf(x, z) { return dist2d(x, z, GANG_TURF.x, GANG_TURF.z) < GANG_TURF.r; }
  inGullTurf(x, z) { return dist2d(x, z, GULL_TURF.x, GULL_TURF.z) < GULL_TURF.r; }
}
