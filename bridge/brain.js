import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SERVER_DIR, INSTRUCTIONS_FILE } from '../lib/config.js';
import { ChatLog } from '../bot/chat.js';
import { status } from '../bot/actions/perception.js';
import { AsyncQueue } from './asyncQueue.js';
import { createGameServer, SERVER_NAME } from './tools.js';
import { claudeEnv } from './auth.js';
import { FILE_TOOLS, fileToolHook } from './files.js';

const DEBOUNCE_MS = 500;
const ERROR_BACKOFF_MS = 60_000;

const BASE_PROMPT = `You are Claude, made by Anthropic, playing Minecraft as a normal player called "Claude".
You act through the minecraft tools, and can read the server's files (and write them in op mode)
with the file tools. Text you write outside a tool call is never seen by players;
use the say tool to talk. Each message you get describes what just happened in the game.
When you have nothing more to do, just end your turn: you'll be woken up when something happens.`;

// Claude only thinks when something happens. Wakes are coalesced into one turn,
// and chat that already reached Claude through tool results doesn't wake it again.
export class Brain {
  constructor(ctx, log = console.log) {
    this.ctx = ctx;
    this.log = log;
    this.busy = false;
    this.reasons = [];
    this.timer = null;
    this.lastThought = Date.now();
    this.backoffUntil = 0;
    this.stopped = false;
  }

  start() {
    const { server, toolNames } = createGameServer(this.ctx);
    const instructions = fs.existsSync(INSTRUCTIONS_FILE) ? fs.readFileSync(INSTRUCTIONS_FILE, 'utf8') : '';
    const config = this.ctx.config;

    this.queue = new AsyncQueue();
    this.session = query({
      prompt: this.queue,
      options: {
        cwd: SERVER_DIR,
        model: config.model,
        effort: config.effort,
        systemPrompt: `${BASE_PROMPT}\n\n${instructions}`,
        // only .claude/settings.json (denies everything outside the game). CLAUDE.md is already in
        // the system prompt, so it's excluded from auto-loading to avoid sending it twice.
        settingSources: ['project'],
        settings: { claudeMdExcludes: ['**/CLAUDE.md'] },
        // Claude Code's file tools, for the server folder only (checked by the hook)
        tools: FILE_TOOLS,
        hooks: { PreToolUse: [fileToolHook(() => this.ctx.state)] },
        mcpServers: { [SERVER_NAME]: server },
        allowedTools: toolNames,
        permissionMode: 'dontAsk',
        env: claudeEnv(config),
        stderr: (data) => this.log(`[claude stderr] ${data.trim()}`),
      },
    });
    this.consume();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.queue?.close();
  }

  // kind 'chat' wakes are skipped if the chat was already delivered during the last turn.
  wake(reason, kind = 'event') {
    this.reasons.push({ reason, kind });
    this.schedule();
  }

  schedule(delay = DEBOUNCE_MS) {
    if (this.busy || this.stopped || this.timer) return;
    const wait = Math.max(delay, this.backoffUntil - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.think();
    }, wait);
  }

  think() {
    const { bot, state, chat } = this.ctx;
    if (this.busy || !bot?.entity || state.mode === 'asleep') {
      this.reasons = [];
      return;
    }
    let reasons = this.reasons;
    this.reasons = [];
    if (!chat.hasUnread()) reasons = reasons.filter((r) => r.kind !== 'chat');
    if (!reasons.length && state.mode !== 'focus') return;

    const unread = chat.takeUnread();
    const parts = [];
    parts.push(`[What happened] ${reasons.length ? reasons.map((r) => r.reason).join('; ') : 'focus mode: your move'}`);
    if (unread.length) parts.push(`[New chat]\n${ChatLog.format(unread)}`);
    parts.push(`[Status]\n${status(bot, state)}`);

    this.busy = true;
    this.lastThought = Date.now();
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: parts.join('\n\n') },
      parent_tool_use_id: null,
    });
  }

  async consume() {
    try {
      for await (const msg of this.session) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text.trim()) this.log(`[claude thinks] ${block.text.trim()}`);
            if (block.type === 'tool_use') this.log(`[claude] ${block.name.replace(`mcp__${SERVER_NAME}__`, '')} ${JSON.stringify(block.input)}`);
          }
        } else if (msg.type === 'result') {
          this.busy = false;
          if (msg.subtype !== 'success' || msg.is_error) this.onError(msg.subtype, msg.errors?.join('; ') ?? msg.result);
          else this.backoffUntil = 0;
          this.afterTurn();
        }
      }
    } catch (err) {
      this.busy = false;
      this.onError('crash', err.message);
      if (!this.stopped) setTimeout(() => this.start(), ERROR_BACKOFF_MS);
    }
  }

  afterTurn() {
    const { state } = this.ctx;
    if (state.mode === 'focus') this.schedule(500);
    else if (this.reasons.length) this.schedule();
  }

  onError(kind, detail) {
    this.log(`[claude error] ${kind}: ${detail ?? ''}`);
    const firstFailure = this.backoffUntil === 0;
    this.backoffUntil = Date.now() + ERROR_BACKOFF_MS;
    if (firstFailure && this.ctx.bot?.entity) {
      this.ctx.bot.chat("My brain isn't responding right now (maybe out of usage). I'll try again in a minute.");
    }
  }
}
