// Roaming gangs for SOLMAR BAY: The Vipers, the second hostile faction after
// the SBPD. Purple jackets and bandanas, turf in the Docks (and a pair watching
// Old Town). They patrol their streets on foot and turn hostile when the player
// walks into their turf — or when the player shoots one of their own, at which
// point the whole gang comes looking. Wiped patrols come back after a while,
// as long as the player is not standing in the turf.
import { dist2d, makeRng } from './util.js';
import { streetCoord, GRID } from './city.js';

export const GANG_NAME = 'The Vipers';
export const GANG_TURF = { x: -140, z: -140, r: 60, name: 'The Docks' };

/** Two waypoints up and down the street the viper stands on, so the patrol
 *  walks the road instead of cutting through building blocks. */
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
    this.respawnTimer = 0;
    this.spawnPatrols();
  }

  spawnPatrols() {
    // Docks crew (4) walks the turf; an Old Town pair (2) watches the Rookery.
    const docks = [[-128, -116], [-104, -116], [-116, -152], [-116, -128]];
    docks.forEach(([x, z], i) => this.spawnViper(x, z, 'Viper ' + (i + 1), patrolAlong(x, z)));
    const oldTown = [[-128, 116], [-104, 116]];
    oldTown.forEach(([x, z], i) => this.spawnViper(x, z, 'Viper ' + (i + 5), patrolAlong(x, z)));
  }

  spawnViper(x, z, name, patrol) {
    const e = this.combat.spawnEnemy(x, z, name, 60, {
      faction: 'viper', jacket: 0x7a2e8f, bandana: 0x7a2e8f, patrol,
    });
    this.members.push(e);
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
  }

  /** Fresh patrols after a New Game, a load, or being busted/flatlined:
   *  clearEnemies already removed the old members from the scene. */
  reset() {
    for (const e of this.members) this.combat.removeEnemy(e);
    this.members = [];
    this.respawnTimer = 0;
    this.combat.gangAggro = false;
    this.spawnPatrols();
  }

  get alive() { return this.members.length; }
  inTurf(x, z) { return dist2d(x, z, GANG_TURF.x, GANG_TURF.z) < GANG_TURF.r; }
}
