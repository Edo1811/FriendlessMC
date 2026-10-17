// Op mode: every command except the ones that take over the server, plus the hard limit
// against anything that crashes or lags.

export const BLOCKED_COMMANDS = new Set([
  'op', 'deop', 'stop', 'restart', 'reload', 'rl', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'kick',
  'whitelist', 'save-off', 'forceload', 'debug', 'perf', 'jfr', 'spark', 'timings',
  'transfer', 'lp', 'luckperms', 'pex', 'permissions', 'plugman', 'sudo',
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

// "minecraft:op" / "bukkit:kick" are the same commands with a namespace
const commandName = (word) => word?.toLowerCase().replace(/^[a-z0-9_.-]+:/, '') ?? '';

// `/execute ... run <command>` runs another command, which has to pass the same checks
const nestedCommand = (command) => command.match(/\brun\s+(.+)$/i)?.[1] ?? null;

// Returns null if the command is OK, or a reason it's refused.
export function checkOpCommand(raw, limiter, now = Date.now(), botName = 'Claude') {
  const command = raw.trim().replace(/^\//, '');
  const name = commandName(command.split(/\s+/)[0]);

  if (!name) return 'Empty command.';
  if (BLOCKED_COMMANDS.has(name)) return `/${name} is off-limits, even in op mode.`;
  const inner = nestedCommand(command);
  if (inner) {
    const problem = checkOpCommand(inner, limiter, now, botName);
    if (problem) return problem;
  }
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

  if (name === 'gamemode' || name === 'defaultgamemode') {
    // Claude can change its own game mode; other players' modes are their own business
    const target = command.split(/\s+/)[2];
    if (name === 'defaultgamemode' || (target && target !== '@s' && target.toLowerCase() !== botName.toLowerCase())) {
      return "Op mode only lets you change your own game mode.";
    }
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
  // anything the server says in this window except player chat counts as feedback
  const onMessage = (msg, position) => {
    if (position !== 'chat' && !/^(\[Not Secure\] )?<[^>]+> /.test(msg)) feedback.push(msg);
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
