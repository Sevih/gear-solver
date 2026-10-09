/**
 * Onboarding "done" flag arbitration — the Settings modal doubles as the
 * setup wizard and reports `onReady` on EVERY successful Setup probe, which
 * runs each time the modal opens. "Reset onboarding prompt" promises the
 * wizard on the NEXT launch; without a gate, simply reopening Settings in the
 * same session re-probes, sees ready, and silently re-sets the flag.
 *
 * Rule: once reset in this session, ready probes no longer mark onboarding
 * done until the app relaunches (where the wizard auto-opens and a ready
 * probe marks it done again, as on a fresh install).
 */
export interface OnboardingGate {
  /** The user asked for the wizard on next launch. */
  reset(): void;
  /** May a ready probe mark onboarding done right now? */
  acceptsReady(): boolean;
}

export function createOnboardingGate(): OnboardingGate {
  let resetThisSession = false;
  return {
    reset() { resetThisSession = true; },
    acceptsReady() { return !resetThisSession; },
  };
}
