"use client";

import { STEPS, blockedReason, stepIndex, stepState, type FlowEnv, type FlowState, type StepId } from "@/lib/flow";

/** The seven steps as a clickable progress strip. Steps that cannot be opened yet are disabled and say why. */
export function Stepper({ state, env, onGo }: { state: FlowState; env: FlowEnv; onGo: (s: StepId) => void }) {
  const cur = stepIndex(state.step);
  return (
    <nav aria-label="Upload steps" className="stepper">
      <p className="stepper-compact" aria-hidden="true">
        Step {cur + 1} of {STEPS.length}: <strong>{STEPS[cur].label}</strong>
      </p>
      <ol>
        {STEPS.map((s, i) => {
          const st = stepState(s.id, state, env);
          const why = st === "locked" ? blockedReason(s.id, state, env) : null;
          const lockedWhileRunning = state.running && s.id !== "upload";
          return (
            <li key={s.id} className={`step ${st}`}>
              <button
                type="button"
                aria-current={st === "current" ? "step" : undefined}
                disabled={st === "locked" || (lockedWhileRunning && st !== "current")}
                title={why ?? undefined}
                aria-label={`${i + 1}. ${s.label}${st === "done" ? " (completed)" : st === "locked" ? ` (not available yet${why ? `: ${why}` : ""})` : ""}`}
                onClick={() => onGo(s.id)}
              >
                <span className="step-n" aria-hidden="true">
                  {st === "done" ? "✓" : i + 1}
                </span>
                <span className="step-l">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
