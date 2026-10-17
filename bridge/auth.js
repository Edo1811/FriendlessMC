// Environment for the Claude process. With 'subscription' the SDK uses the `claude auth login`
// session; with 'apiKey' we pass the key and make sure no stray login token overrides it.
export function claudeEnv(config) {
  const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'friendlessmc/1.0.0' };
  if (config.auth === 'apiKey' && config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
  } else {
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}
