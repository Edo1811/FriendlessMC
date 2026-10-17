import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SERVER_DIR, CLAUDE_DIR, PENDING_EDITS_FILE } from '../lib/config.js';
import { claudeEnv } from './auth.js';

// File edits can only happen while the server is stopped (a running server overwrites its files),
// so in-game requests are queued here and applied by start.js before the next server start.

export function readPendingEdits() {
  if (!fs.existsSync(PENDING_EDITS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PENDING_EDITS_FILE, 'utf8'));
}

export function queueFileEdit(description, requestedBy) {
  const edits = readPendingEdits();
  edits.push({ description, requestedBy, time: new Date().toISOString() });
  fs.writeFileSync(PENDING_EDITS_FILE, JSON.stringify(edits, null, 2));
  return edits.length;
}

const EDIT_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);

// Only text files inside the server folder, never Claude's own config, the jar, or world region data.
export function isEditablePath(filePath) {
  const resolved = path.resolve(SERVER_DIR, filePath);
  const rel = path.relative(SERVER_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (resolved.startsWith(CLAUDE_DIR)) return false;
  if (/\.(jar|mca|dat|dat_old|mcr|nbt|zip|exe|bat|cmd|ps1)$/i.test(resolved)) return false;
  return true;
}

export async function applyPendingEdits(config, log = console.log) {
  const edits = readPendingEdits();
  if (!edits.length) return;

  log(`[claude] Applying ${edits.length} queued file edit(s) before starting the server...`);
  const request = edits.map((e, i) => `${i + 1}. (asked by ${e.requestedBy}) ${e.description}`).join('\n');

  const result = query({
    prompt:
      `You are Claude, the in-game player on this Minecraft server. While playing, ops asked for these ` +
      `changes that need editing server files. The server is stopped right now, so it's safe.\n\n${request}\n\n` +
      `Make the edits in this folder. Only touch text config files. Never create anything that crashes or ` +
      `lags the server or players' games. If a request is unsafe or impossible, skip it. ` +
      `End with a one-line summary per request.`,
    options: {
      cwd: SERVER_DIR,
      model: config.model,
      settingSources: [],
      tools: [...EDIT_TOOLS],
      permissionMode: 'default',
      maxTurns: 40,
      env: claudeEnv(config),
      canUseTool: async (toolName, input) => {
        if (!EDIT_TOOLS.has(toolName)) return { behavior: 'deny', message: 'Only file tools are allowed.' };
        const target = input.file_path ?? input.path ?? SERVER_DIR;
        if (toolName !== 'Glob' && toolName !== 'Grep' && !isEditablePath(target)) {
          return { behavior: 'deny', message: `Not allowed to touch ${target}.` };
        }
        return { behavior: 'allow', updatedInput: input };
      },
    },
  });

  for await (const msg of result) {
    if (msg.type === 'result') {
      log(`[claude] File edits done: ${msg.subtype === 'success' ? msg.result : msg.subtype}`);
    }
  }
  fs.renameSync(PENDING_EDITS_FILE, path.join(CLAUDE_DIR, `applied-edits-${Date.now()}.json`));
}
