import { mentionsBot } from './chat.js';
import { humansOnline, abortCurrentAction } from './state.js';
import { isHostile } from './actions/util.js';

const MOB_CLOSE_DISTANCE = 6;
const MOB_REPORT_COOLDOWN_MS = 30_000;
const DAMAGE_WAKE_COOLDOWN_MS = 10_000;
const LOW_HEALTH = 8;

// Turns game events into chat-log lines, interrupts and brain wakes.
export function attachEvents(ctx) {
  const { bot, state, chat, brain, modes } = ctx;
  const timers = [];

  const isAddressed = (username, message, whisper) =>
    whisper ||
    mentionsBot(message, bot.username) ||
    humansOnline(bot).length === 1 ||
    state.focus?.by === username;

  const onChat = (username, message, whisper) => {
    if (username === bot.username) return;
    chat.add(username, message, { whisper });
    if (isAddressed(username, message, whisper)) {
      modes.noteActivity();
      // a chat message works as an interrupt for long actions
      abortCurrentAction(state, `${username} said: ${message}`);
    }
    brain.wake(`${username} chatted`, 'chat');
  };

  bot.on('chat', (username, message) => onChat(username, message, false));
  bot.on('whisper', (username, message) => onChat(username, message, true));

  bot.on('playerJoined', (player) => {
    if (player.username === bot.username) return;
    chat.add(null, `${player.username} joined the game`, { system: true });
    if (state.mode === 'asleep') state.mode = 'normal';
    brain.wake(`${player.username} joined`);
  });

  bot.on('playerLeft', (player) => {
    if (player.username === bot.username) return;
    chat.add(null, `${player.username} left the game`, { system: true });
    brain.wake(`${player.username} left`);
  });

  let lastHealth = bot.health;
  let lastDamageWake = 0;
  bot.on('health', () => {
    const took = lastHealth - bot.health;
    lastHealth = bot.health;
    if (took <= 0) return;
    if (bot.health <= LOW_HEALTH) abortCurrentAction(state, `health is low (${Math.round(bot.health)}/20)`);
    if (Date.now() - lastDamageWake > DAMAGE_WAKE_COOLDOWN_MS) {
      lastDamageWake = Date.now();
      brain.wake(`you took ${took.toFixed(0)} damage (health ${Math.round(bot.health)}/20)`);
    }
  });

  bot.on('death', () => {
    chat.add(null, 'You died and respawned.', { system: true });
    brain.wake('you died');
  });

  const reportedMobs = new Map();
  timers.push(
    setInterval(() => {
      if (!bot.entity || state.mode === 'asleep') return;
      const mob = bot.nearestEntity(
        (e) => isHostile(e) && e.position.distanceTo(bot.entity.position) <= MOB_CLOSE_DISTANCE,
      );
      if (!mob) return;
      const last = reportedMobs.get(mob.id) ?? 0;
      if (Date.now() - last < MOB_REPORT_COOLDOWN_MS) return;
      reportedMobs.set(mob.id, Date.now());
      brain.wake(`a ${mob.name} is close (${mob.position.distanceTo(bot.entity.position).toFixed(0)}m)`);
    }, 2000),
  );

  return () => timers.forEach(clearInterval);
}
