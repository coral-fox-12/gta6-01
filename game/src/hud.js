// HUD for SOLMAR BAY: health, money, wanted stars, clock, objective text, messages,
// and a live 2D minimap (roads, player arrow, cars, police, mission marker).
import { money } from './util.js';
import { streetCoord, PITCH, GRID, HALF } from './city.js';

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['health-fill', 'health-num', 'money', 'stars', 'clock', 'objective', 'message', 'speed', 'zone', 'wanted-label', 'minimap', 'crosshair', 'damage-flash', 'banner', 'banner-title', 'banner-sub']) {
      this.el[id] = document.getElementById(id);
    }
    this.map = this.el.minimap;
    this.mapCtx = this.map.getContext('2d');
    this.messageTimer = 0;
    this.bannerTimer = 0;
    this.clockMinutes = 9 * 60 + 12; // 09:12 in the morning
  }

  /** One update per frame with the live world state. */
  update(dt, state) {
    const { player, police, missions, speedKmh, zone } = state;
    this.el['health-fill'].style.width = Math.max(0, player.health) + '%';
    this.el['health-num'].textContent = Math.ceil(player.health);
    this.el.money.textContent = money(state.money);
    const stars = '★'.repeat(police.wanted) + '☆'.repeat(5 - police.wanted);
    this.el.stars.textContent = stars;
    this.el.stars.className = police.wanted > 0 ? 'wanted-hot' : '';
    this.el['wanted-label'].textContent = police.wanted > 0 ? 'WANTED' : '';
    this.el.speed.textContent = player.inCar ? Math.round(speedKmh) + ' km/h' : '';
    this.el.zone.textContent = zone || '';
    // In-game clock: 1 real second = 1 game minute.
    this.clockMinutes += dt;
    const hh = Math.floor(this.clockMinutes / 60) % 24;
    const mm = Math.floor(this.clockMinutes % 60);
    this.el.clock.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    this.el.objective.textContent = missions.objectiveText();
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.el.message.textContent = '';
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('hidden');
    }
    this.drawMinimap(state);
  }

  showMessage(text, seconds = 4) {
    this.el.message.textContent = text;
    this.messageTimer = seconds;
  }

  /** Clear the message bar (used by the ?shot= staging so the cover frame
   *  shows the game, not a transient toast duplicating the objective). */
  clearMessage() {
    this.el.message.textContent = '';
    this.messageTimer = 0;
  }

  showBanner(title, sub, seconds = 3.5) {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub || '';
    this.el.banner.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  flashDamage() {
    const el = this.el['damage-flash'];
    el.style.opacity = '0.55';
    setTimeout(() => { el.style.opacity = '0'; }, 120);
  }

  setCrosshairVisible(v) {
    this.el.crosshair.style.display = v ? 'block' : 'none';
  }

  drawMinimap(state) {
    const ctx = this.mapCtx;
    const S = this.map.width;
    const { player, cars, police, missions, enemies } = state;
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    const world = (v) => ((v + HALF + 30) / (2 * (HALF + 30))) * S;
    ctx.clearRect(0, 0, S, S);
    // Water + sand east edge.
    ctx.fillStyle = '#2e7fa8';
    ctx.fillRect(world(207), 0, S - world(207), S);
    ctx.fillStyle = '#e3cf9e';
    ctx.fillRect(world(181), 0, world(207) - world(181), S);
    // Land.
    ctx.fillStyle = '#5a5f57';
    ctx.fillRect(0, 0, world(181), S);
    // Roads.
    ctx.strokeStyle = '#3c3f45';
    ctx.lineWidth = 7;
    for (let i = 0; i <= GRID * 2; i += 1) {
      const p = world(streetCoord(i));
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    }
    // Park.
    ctx.fillStyle = '#6fae62';
    const parkX = world(-PITCH - 22);
    const parkZ = world(PITCH - 22);
    ctx.fillRect(parkX, parkZ, 44 * (S / (2 * (HALF + 30))), 44 * (S / (2 * (HALF + 30))));
    // Mission marker: pulsing yellow diamond.
    if (missions.marker) {
      const mx = world(missions.marker.x);
      const mz = world(missions.marker.z);
      const pulse = 6 + Math.sin(performance.now() / 240) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.moveTo(mx, mz - pulse);
      ctx.lineTo(mx + pulse, mz);
      ctx.lineTo(mx, mz + pulse);
      ctx.lineTo(mx - pulse, mz);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Enemies: red dots for guards and Rats, purple dots for Vipers, teal
    // dots for Gull Kings.
    for (const e of enemies) {
      if (e.state === 'down') continue;
      ctx.fillStyle = e.faction === 'viper' ? '#b04fe0' : e.faction === 'gull' ? '#14b8a6' : '#ff4040';
      ctx.beginPath(); ctx.arc(world(e.x), world(e.z), 3, 0, Math.PI * 2); ctx.fill();
    }
    // Traffic cars (white dots).
    ctx.fillStyle = '#e8e8e8';
    for (const c of cars) {
      if (c.role === 'police' || c.role === 'player') continue;
      ctx.beginPath(); ctx.arc(world(c.x), world(c.z), 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // Police (flashing blue dots).
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.fillStyle = flash ? '#3050ff' : '#ff2020';
    for (const c of police.cars) {
      ctx.beginPath(); ctx.arc(world(c.x), world(c.z), 3.4, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of police.cops) {
      ctx.beginPath(); ctx.arc(world(c.x), world(c.z), 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow (rotates with heading).
    const heading = player.inCar ? player.inCar.heading : player.heading;
    const ax = world(px);
    const az = world(pz);
    ctx.save();
    ctx.translate(ax, az);
    // Arrow points up (0,-8); rotate so it matches the heading on the map
    // (map x = east, map y = south, heading 0 faces -z i.e. north).
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // North tick.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', S - 14, 14);
  }
}
