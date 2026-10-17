import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkFileAccess, fileToolHook } from '../bridge/files.js';
import { SERVER_DIR, CONFIG_FILE, MEMORY_FILE, CLAUDE_DIR } from '../lib/config.js';

const allowed = (tool, input, opMode = false) => assert.equal(checkFileAccess(tool, input, { opMode }), null, JSON.stringify(input));
const denied = (tool, input, opMode = false) => assert.notEqual(checkFileAccess(tool, input, { opMode }), null, JSON.stringify(input));
const inServer = (...p) => path.join(SERVER_DIR, ...p);

test('reading anything in the server folder is fine', () => {
  allowed('Read', { file_path: inServer('server.properties') });
  allowed('Read', { file_path: inServer('plugins', 'SkinsRestorer', 'config.yml') });
  allowed('Read', { file_path: 'logs/latest.log' });
  allowed('Glob', { pattern: '**/*.yml' });
  allowed('Grep', { pattern: 'online-mode', glob: '*.properties' });
  allowed('Read', { file_path: MEMORY_FILE });
});

test('nothing outside the server folder, not even by sneaky paths', () => {
  denied('Read', { file_path: path.join(SERVER_DIR, '..', 'start.js') });
  denied('Read', { file_path: '../package.json' });
  denied('Read', { file_path: path.parse(SERVER_DIR).root + 'Windows/win.ini' });
  denied('Glob', { pattern: '../../**' });
  denied('Glob', { pattern: '**/*', path: path.dirname(SERVER_DIR) });
  denied('Grep', { pattern: 'password', glob: '../**' });
  denied('Read', { file_path: CONFIG_FILE });
});

test('writing needs op mode', () => {
  denied('Write', { file_path: inServer('server.properties'), content: 'x' });
  allowed('Write', { file_path: inServer('server.properties'), content: 'x' }, true);
  allowed('Edit', { file_path: inServer('plugins', 'X', 'config.yml'), old_string: 'a', new_string: 'b' }, true);
});

test('even in op mode: no .claude rules/permissions, no programs', () => {
  denied('Edit', { file_path: path.join(CLAUDE_DIR, 'settings.json') }, true);
  denied('Write', { file_path: path.join(CLAUDE_DIR, 'settings.local.json') }, true);
  denied('Write', { file_path: path.join(CLAUDE_DIR, 'CLAUDE.md') }, true);
  allowed('Edit', { file_path: MEMORY_FILE }, true);
  denied('Write', { file_path: inServer('plugins', 'evil.jar') }, true);
  denied('Write', { file_path: inServer('run.bat') }, true);
  denied('Bash', { command: 'dir' }, true);
});

test('the hook answers allow/deny for the SDK', async () => {
  const state = { opMode: { enabled: false } };
  const hook = fileToolHook(() => state).hooks[0];
  const ask = (tool_name, tool_input) => hook({ tool_name, tool_input }).then((r) => r.hookSpecificOutput.permissionDecision);
  assert.equal(await ask('Read', { file_path: inServer('ops.json') }), 'allow');
  assert.equal(await ask('Write', { file_path: inServer('ops.json'), content: '[]' }), 'deny');
  state.opMode.enabled = true;
  assert.equal(await ask('Write', { file_path: inServer('ops.json'), content: '[]' }), 'allow');
});
