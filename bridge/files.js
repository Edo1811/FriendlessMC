import path from 'node:path';
import { SERVER_DIR, CLAUDE_DIR, CONFIG_FILE, MEMORY_FILE } from '../lib/config.js';

// Claude Code's own file tools, limited to the server folder.
export const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const WRITE_TOOLS = new Set(['Write', 'Edit']);

function inside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Decides one file tool call. Returns null when it's fine, or the reason it isn't.
export function checkFileAccess(toolName, input, { opMode }) {
  if (!FILE_TOOLS.includes(toolName)) return `${toolName} isn't available here.`;

  const raw = input.file_path ?? input.path ?? SERVER_DIR;
  const target = path.resolve(SERVER_DIR, String(raw));

  if (!inside(SERVER_DIR, target)) return 'Only files inside the server folder are allowed.';
  // Glob/Grep patterns can point elsewhere too ("../../**", "C:/Users/**")
  // (Grep's `pattern` is a regex over file contents; its `glob` is the path filter)
  const pathPatterns = toolName === 'Glob' ? [input.pattern] : toolName === 'Grep' ? [input.glob] : [];
  for (const pattern of pathPatterns) {
    if (typeof pattern === 'string' && (pattern.includes('..') || (path.isAbsolute(pattern) && !inside(SERVER_DIR, path.resolve(pattern))))) {
      return 'Only files inside the server folder are allowed.';
    }
  }
  // holds the API key, if one is used
  if (target === CONFIG_FILE) return 'friendless.json is off-limits.';

  if (!WRITE_TOOLS.has(toolName)) return null;

  if (!opMode) return 'Writing server files needs op mode. Reading is fine.';
  // Claude's own rules and permissions stay as the owner set them; memory goes through the memory tools
  if (inside(CLAUDE_DIR, target) && target !== MEMORY_FILE) return "Files in .claude can't be changed.";
  if (/\.(jar|exe|bat|cmd|ps1|sh|dll|so)$/i.test(target)) return "Programs and plugin jars can't be written.";
  return null;
}

// PreToolUse hook for the Agent SDK. Runs on every file tool call, even ones Claude Code
// would otherwise allow on its own (like reads in the working directory).
export function fileToolHook(getState) {
  return {
    matcher: FILE_TOOLS.join('|'),
    hooks: [
      async (input) => {
        const problem = checkFileAccess(input.tool_name, input.tool_input ?? {}, { opMode: getState().opMode.enabled });
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: problem ? 'deny' : 'allow',
            permissionDecisionReason: problem ?? 'Inside the server folder.',
          },
        };
      },
    ],
  };
}
