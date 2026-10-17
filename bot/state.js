// Shared state between the bot, the mode manager and the bridge.
export function createState(config) {
  return {
    config,
    mode: 'asleep', // 'asleep' | 'normal' | 'focus'
    opMode: { enabled: false, by: null },
    // { by, startedAt, lastActivity, stillGoingAskedAt }
    focus: null,
    // { name, controller } while a game action is running
    action: null,
  };
}

export function humansOnline(bot) {
  return Object.keys(bot.players).filter((name) => name !== bot.username);
}

export function abortCurrentAction(state, reason) {
  if (state.action && !state.action.controller.signal.aborted) {
    state.action.controller.abort(new Error(reason));
  }
}
