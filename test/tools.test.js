import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameServer } from '../bridge/tools.js';
import { createState, abortCurrentAction } from '../bot/state.js';
import { ChatLog } from '../bot/chat.js';
import { sleep } from '../bot/actions/util.js';

function setup() {
  const bot = new EventEmitter();
  bot.username = 'Claude';
  bot.entity = {};
  bot.said = [];
  bot.chat = (m) => {
    bot.said.push(m);
    if (m.startsWith('/')) setTimeout(() => bot.emit('messagestr', 'Changed the block', 'system'), 10);
  };
  const config = { ops: ['Edo'] };
  const ctx = { bot, config, state: createState(config), chat: new ChatLog() };
  const { server } = createGameServer(ctx);
  return { ctx, bot, tools: server.instance._registeredTools };
}

async function call(tools, name, args = {}) {
  const res = await tools[name].handler(args, {});
  return res.content[0].text;
}

test('the tool server registers every tool', () => {
  const { tools } = setup();
  for (const name of ['say', 'mine', 'op_command', 'set_op_mode', 'start_focus', 'memory_forget']) {
    assert.ok(tools[name], `missing ${name}`);
  }
});

test('op mode: only an op who actually spoke can unlock it', async () => {
  const { ctx, tools } = setup();
  assert.match(await call(tools, 'set_op_mode', { enabled: true, requested_by: 'Luca' }), /not an op/);
  assert.match(await call(tools, 'set_op_mode', { enabled: true, requested_by: 'Edo' }), /hasn't said anything/);
  ctx.chat.add('Edo', 'claude unlock op mode');
  assert.match(await call(tools, 'set_op_mode', { enabled: true, requested_by: 'Edo' }), /Op mode on/);
  assert.equal(ctx.state.opMode.enabled, true);
});

test('op_command is refused while op mode is off, announced when on', async () => {
  const { ctx, bot, tools } = setup();
  assert.match(await call(tools, 'op_command', { command: 'time set day', announcement: 'making it day' }), /Op mode is off/);
  ctx.state.opMode = { enabled: true, by: 'Edo' };
  const out = await call(tools, 'op_command', { command: 'setblock 0 64 0 stone', announcement: 'placing a block' });
  assert.deepEqual(bot.said, ['using op powers: placing a block', '/setblock 0 64 0 stone']);
  assert.match(out, /Changed the block/);
  assert.match(await call(tools, 'op_command', { command: 'op Luca', announcement: 'oops' }), /Refused/);
});

test('tool results carry unread chat', async () => {
  const { ctx, tools } = setup();
  ctx.chat.add('Edo', 'hey');
  const out = await call(tools, 'say', { message: 'hi' });
  assert.match(out, /\[New chat\]\n<Edo> hey/);
  assert.doesNotMatch(await call(tools, 'say', { message: 'hi again' }), /New chat/);
});

test('a long action is interrupted and only one runs at a time', async () => {
  const { ctx, tools } = setup();
  const waiting = call(tools, 'wait', { seconds: 5 });
  await sleep(20);
  assert.match(await call(tools, 'wait', { seconds: 1 }), /Already doing "wait"/);
  ctx.state.action.controller.abort(new Error('Edo said: claude come here'));
  assert.match(await waiting, /Interrupted: Edo said: claude come here/);
  assert.equal(ctx.state.action, null);
});

function followSetup() {
  const s = setup();
  const { bot, ctx } = s;
  const vec3 = (x, y, z) => ({ x, y, z, clone() { return vec3(x, y, z); }, offset(a, b, c) { return vec3(x + a, y + b, z + c); },
    distanceTo(o) { return Math.hypot(o.x - x, o.y - y, o.z - z); } });
  bot.entity = { position: vec3(0, 64, 0), yaw: 0 };
  bot.players = { Claude: { username: 'Claude', entity: bot.entity }, Edo: { username: 'Edo', entity: { position: vec3(20, 64, 0) } } };
  bot.goals = [];
  bot.pathfinder = { setGoal: (g) => bot.goals.push(g), isMoving: () => false, stop() {} };
  bot.pvp = { target: null, stop() {} };
  bot.clearControlStates = () => {};
  bot.stopDigging = () => {};
  Object.assign(bot, {
    entities: {}, health: 20, food: 20, time: { timeOfDay: 3000 }, isRaining: false, heldItem: null,
    game: { dimension: 'overworld' }, inventory: { items: () => [] }, blockAt: () => ({ name: 'grass_block' }),
  });
  const wakes = [];
  ctx.brain = { wake: (r) => wakes.push(r) };
  lastFollowState = ctx.state;
  return { ...s, wakes, vec3 };
}

// a failed assertion must not leave a follow timer running
let lastFollowState = null;
afterEach(() => lastFollowState?.background?.stop());

test('follow runs in the background and walks toward the player', async () => {
  const { ctx, bot, tools } = followSetup();
  assert.match(await call(tools, 'follow', { player: 'edo' }), /Now following Edo/);
  assert.equal(ctx.state.action, null, 'the action slot is free, so Claude can keep talking');
  assert.ok(bot.goals.at(-1), 'a path goal was set');
  assert.equal(bot.goals.at(-1).x, 20);
  assert.match(await call(tools, 'status'), /following Edo in the background/);
  ctx.state.background.stop();
});

test('chat does not cancel following; stop and other movement do', async () => {
  const { ctx, tools } = followSetup();
  await call(tools, 'follow', { player: 'Edo' });
  abortCurrentAction(ctx.state, 'Edo said: lol');
  assert.ok(ctx.state.background, 'still following after chat');
  await call(tools, 'stop');
  assert.equal(ctx.state.background, null);

  await call(tools, 'follow', { player: 'Edo' });
  await call(tools, 'go_to', { x: 1, y: 64, z: 1 }).catch(() => {});
  assert.equal(ctx.state.background, null, 'go_to ended the follow');
});

test('follow ends by itself when the player leaves, and Claude is told', async () => {
  const { ctx, bot, tools, wakes } = followSetup();
  await call(tools, 'follow', { player: 'Edo' });
  delete bot.players.Edo;
  await sleep(500);
  assert.equal(ctx.state.background, null);
  assert.match(wakes.at(-1), /stopped following: Edo left the game/);
});

test('follow refuses players who are offline or out of sight', async () => {
  const { bot, tools } = followSetup();
  assert.match(await call(tools, 'follow', { player: 'Luca' }), /isn't online/);
  bot.players.Edo.entity = null;
  assert.match(await call(tools, 'follow', { player: 'Edo' }), /can't see Edo/);
});

test('every action takes an optional say, said before acting', async () => {
  const { bot, tools } = setup();
  assert.ok(tools.go_to.inputSchema.shape.say, 'go_to has say');
  assert.ok(tools.mine.inputSchema.shape.say, 'mine has say');
  assert.equal(tools.status.inputSchema?.shape?.say, undefined, 'quick tools do not');
  await call(tools, 'wait', { seconds: 1, say: 'one sec!' });
  assert.equal(bot.said[0], 'one sec!');
});

test('screenshot explains when vision is off', async () => {
  const { tools } = setup();
  assert.match(await call(tools, 'screenshot', {}), /turned off/);
});
