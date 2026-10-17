import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameServer } from '../bridge/tools.js';
import { createState } from '../bot/state.js';
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
