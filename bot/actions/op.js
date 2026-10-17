// Op mode: the commands Claude may use, plus the hard limit against anything that crashes or lags.

export const ALLOWED_COMMANDS = new Set([
  'fill', 'setblock', 'clone', 'tp', 'teleport', 'summon', 'give', 'time', 'weather', 'gamerule',
]);

// Items/blocks/NBT that are the usual ingredients of crash or lag tricks.
const BANNED_PATTERNS = [
  /command_block/i,
  /structure_block/i,
  /jigsaw/i,
  /written_book|writable_book/i,
  /\bpages\b/i,
  /Passengers/i,
  /BlockEntityTag|block_entity_data/i,
  /\bspawner\b|trial_spawner/i,
  /falling_block/i,
];

const GAMERULE_LIMITS = {
  randomtickspeed: 30,
  maxentitycramming: 100,
  spawnchunkradius: 10,
  maxcommandchainlength: 65536,
};

const MAX_COMMAND_LENGTH = 256; // chat packets can't carry more anyway
const MAX_NBT_LENGTH = 200;
const SUMMONS_PER_MINUTE = 10;

export function createOpLimiter() {
  return { summons: [] };
}

// Returns null if the command is OK, or a reason it's refused.
export function checkOpCommand(raw, limiter, now = Date.now()) {
  const command = raw.trim().replace(/^\//, '');
  const name = command.split(/\s+/)[0]?.toLowerCase();

  if (!ALLOWED_COMMANDS.has(name)) return `/${name} isn't one of the op-mode commands.`;
  if (command.length > MAX_COMMAND_LENGTH) return `Command is too long (max ${MAX_COMMAND_LENGTH} chars).`;
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(command)) return `Blocked by the no-crash/no-lag rule (${pattern.source}).`;
  }
  const nbt = command.match(/[{[].*[}\]]/s)?.[0] ?? '';
  if (nbt.length > MAX_NBT_LENGTH) return `Too much NBT/component data (max ${MAX_NBT_LENGTH} chars).`;

  if (name === 'gamerule') {
    const [, rule, value] = command.split(/\s+/);
    const limit = GAMERULE_LIMITS[rule?.toLowerCase()];
    if (limit !== undefined && value !== undefined && Number(value) > limit) {
      return `${rule} above ${limit} would lag the server.`;
    }
  }

  if (name === 'give') {
    const count = Number(command.split(/\s+/)[3] ?? 1);
    if (count > 64 * 36) return 'That is more than a full inventory.';
  }

  if (name === 'summon') {
    limiter.summons = limiter.summons.filter((t) => now - t < 60_000);
    if (limiter.summons.length >= SUMMONS_PER_MINUTE) {
      return `Max ${SUMMONS_PER_MINUTE} summons per minute, to avoid lag.`;
    }
    limiter.summons.push(now);
  }

  return null;
}

// Sends a command and collects the server's feedback for a moment.
export async function runCommand(bot, command, waitMs = 1200) {
  const feedback = [];
  const onMessage = (msg, position) => {
    // some servers send player chat as system messages too; that isn't command feedback
    if ((position === 'system' || position === 'game_info') && !/^<[^>]+> /.test(msg)) feedback.push(msg);
  };
  bot.on('messagestr', onMessage);
  try {
    bot.chat(`/${command.trim().replace(/^\//, '')}`);
    await new Promise((r) => setTimeout(r, waitMs));
  } finally {
    bot.removeListener('messagestr', onMessage);
  }
  return feedback.length ? feedback.join('\n') : '(no feedback from the server)';
}
