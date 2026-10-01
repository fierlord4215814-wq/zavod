export type LoginThrottleState = {
  failedLoginCount: number;
  failedLoginStage: number;
  lockedUntil: Date | null;
};

export function isLoginLocked(state: LoginThrottleState, now: Date) {
  return Boolean(state.lockedUntil && state.lockedUntil.getTime() > now.getTime());
}

export function nextFailedPasswordState(state: LoginThrottleState, now: Date): LoginThrottleState {
  if (isLoginLocked(state, now)) return state;
  const count = state.failedLoginCount + 1;
  if (count < 3) return { failedLoginCount: count, failedLoginStage: state.failedLoginStage, lockedUntil: null };
  const stage = Math.min(2, state.failedLoginStage + 1);
  return {
    failedLoginCount: 0,
    failedLoginStage: stage,
    lockedUntil: new Date(now.getTime() + (stage === 1 ? 10 : 60) * 60 * 1000),
  };
}
