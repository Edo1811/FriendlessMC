import { playerEntity } from '../actions/util.js';

const rad = (deg) => (deg * Math.PI) / 180;

// Mineflayer yaw: 0 = north, counter-clockwise; pitch: up is positive.
export const PANORAMA = [['north', 0], ['east', -Math.PI / 2], ['south', Math.PI], ['west', Math.PI / 2]];

function directionName(yaw) {
  const deg = (((180 - (yaw * 180) / Math.PI) % 360) + 360) % 360; // back to F3 degrees
  return ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'][Math.round(deg / 45) % 8];
}

// Which camera angles to render for the screenshot tool.
export function screenshotViews(bot, { panorama, player, yaw, pitch }) {
  const lookPitch = pitch === undefined ? -0.12 : rad(-pitch);
  if (panorama) return PANORAMA.map(([label, y]) => ({ label: `looking ${label}`, yaw: y, pitch: lookPitch }));

  if (player) {
    const target = playerEntity(bot, player);
    if (!target) throw new Error(`${player} isn't close enough for me to see them.`);
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
    const to = target.position.offset(0, (target.height ?? 1.8) * 0.6, 0);
    const dx = to.x - eye.x;
    const dz = to.z - eye.z;
    const y = Math.atan2(-dx, -dz);
    const p = Math.atan2(to.y - eye.y, Math.hypot(dx, dz));
    return [{ label: `looking at ${player}`, yaw: y, pitch: p }];
  }

  const y = yaw === undefined ? bot.entity.yaw : rad(180 - yaw);
  const p = pitch === undefined ? bot.entity.pitch : lookPitch;
  return [{ label: `looking ${directionName(y)}`, yaw: y, pitch: p }];
}
