import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../lib/config.js';

const isWindows = process.platform === 'win32';

function run(cmd, args) {
  // npm-installed CLIs are .cmd files on Windows, which need a shell
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: isWindows, timeout: 15_000 });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() };
}

export function checkJava(javaPath = 'java') {
  const { ok, out } = run(javaPath, ['-version']);
  if (!ok) return { ok: false, detail: 'Java not found.' };
  const match = out.match(/version "(\d+)(?:\.(\d+))?/);
  let major = match ? Number(match[1]) : 0;
  if (major === 1 && match[2]) major = Number(match[2]); // old "1.8" style
  return {
    ok: major >= 21,
    major,
    detail: major >= 21 ? `Java ${major}` : `Java ${major} is too old, the server needs Java 21 or newer.`,
  };
}

export function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 20, detail: `Node.js ${process.versions.node}` };
}

export function checkClaudeCli() {
  const { ok, out } = run('claude', ['--version']);
  return { ok, detail: ok ? `Claude Code ${out.split('\n')[0]}` : 'Claude Code CLI not found.' };
}

export function claudeAuthStatus() {
  const { out } = run('claude', ['auth', 'status', '--json']);
  try {
    const status = JSON.parse(out.slice(out.indexOf('{')));
    return { loggedIn: Boolean(status.loggedIn), method: status.authMethod ?? null };
  } catch {
    return { loggedIn: false, method: null };
  }
}

// Opens a console window where Edo signs in with the normal Claude account.
export function openClaudeLogin() {
  if (isWindows) {
    spawn('cmd.exe', ['/c', 'start', 'Claude login', 'cmd', '/k', 'claude auth login --claudeai'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn('claude', ['auth', 'login', '--claudeai'], { stdio: 'inherit' });
  }
}

export function openBrowser(url) {
  const [cmd, args] = isWindows
    ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// "Start Claude server" on the desktop. Runs start.js with this same node.exe.
export function createDesktopShortcut() {
  if (!isWindows) throw new Error('Desktop shortcuts are only set up on Windows. Run `npm start` instead.');
  const script = path.join(os.tmpdir(), `friendless-shortcut-${Date.now()}.ps1`);
  const esc = (s) => s.replace(/'/g, "''");
  fs.writeFileSync(
    script,
    [
      `$desktop = [Environment]::GetFolderPath('Desktop')`,
      `$shell = New-Object -ComObject WScript.Shell`,
      `$link = $shell.CreateShortcut((Join-Path $desktop 'Start Claude server.lnk'))`,
      `$link.TargetPath = '${esc(process.execPath)}'`,
      `$link.Arguments = '"${esc(path.join(ROOT, 'start.js'))}"'`,
      `$link.WorkingDirectory = '${esc(ROOT)}'`,
      `$link.Description = 'Starts the Minecraft server and Claude'`,
      `$link.Save()`,
      `Write-Output (Join-Path $desktop 'Start Claude server.lnk')`,
    ].join('\r\n'),
  );
  try {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8',
    });
    if (res.status !== 0) throw new Error(res.stderr || 'PowerShell failed');
    return res.stdout.trim();
  } finally {
    fs.rmSync(script, { force: true });
  }
}
