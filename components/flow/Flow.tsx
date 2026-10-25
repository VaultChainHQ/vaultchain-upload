"use client";

import { useEffect, useRef } from "react";
import { STEPS, blockedReason, flowStore, initialStep, stepIndex, type FlowEnv, type StepId } from "@/lib/flow";
import { useAccount, useBalance } from "@/lib/hooks";
import { Stepper } from "./Stepper";
import { useFlow } from "./useFlow";
import { ProfileStep } from "./ProfileStep";
import { FundsPanel } from "./FundsStep";
import { FilesStep } from "./FilesStep";
import { OptionsStep } from "./OptionsStep";
import { ReviewStep } from "./ReviewStep";
import { UploadStep } from "./UploadStep";
import { DoneStep } from "./DoneStep";

const INTRO: Record<StepId, string> = {
  profile: "A profile is your identity here. It holds the key that signs your uploads and unlocks your private files. It stays in this browser, protected by your passphrase.",
  funds: "",
  files: "",
  options: "",
  review: "Check everything once more. Nothing is signed or paid until you press Upload.",
  upload: "",
  done: "",
};

const TITLES: Record<StepId, string> = {
  profile: "Create or unlock your profile",
  funds: "Get some test funds",
  files: "Choose your files",
  options: "Pick your options",
  review: "Review and confirm",
  upload: "Uploading",
  done: "All done",
};

/** The seven-step upload guide. State lives in a module-level store, so it survives moving to other pages and back. */
export function Flow() {
  const state = useFlow();
  const { profile, unlocked, mounted } = useAccount();
  const bal = useBalance(profile?.entry.address, 4000);
  const env: FlowEnv = { unlocked: !!unlocked, balance: bal.data };
  const heading = useRef<HTMLHeadingElement>(null);
  const advancedFor = useRef<unknown>(null);
  const first = useRef(true);

  const go = (step: StepId) => flowStore().dispatch({ type: "goto", step });
  const next = () => go(STEPS[Math.min(STEPS.length - 1, stepIndex(state.step) + 1)].id);
  const back = () => go(STEPS[Math.max(0, stepIndex(state.step) - 1)].id);

  // Returning users and people who just unlocked skip straight to the first step that still needs them.
  useEffect(() => {
    if (!mounted || !unlocked || state.step !== "profile" || state.running) return;
    if (advancedFor.current === unlocked) return;
    if (bal.data === undefined && !bal.error) return;
    advancedFor.current = unlocked;
    go(state.items.length ? "options" : initialStep(env));
  });

  // If the session locks while on a step that needs a key, go back to the profile step.
  useEffect(() => {
    if (mounted && !unlocked && !state.running && blockedReason(state.step, state, env)?.includes("profile")) go("profile");
  });

  // Move focus to the step heading when the step changes (not on first paint), so keyboard and screen reader users follow along.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [state.step]);

  return (
    <div className="flow">
      <Stepper state={state} env={env} onGo={go} />
      <section className="panel" aria-labelledby="step-h">
        <h2 id="step-h" ref={heading} tabIndex={-1}>
          {TITLES[state.step]}
        </h2>
        {INTRO[state.step] ? <p className="muted">{INTRO[state.step]}</p> : null}
        {state.step === "profile" ? <ProfileStep onNext={next} /> : null}
        {state.step === "funds" ? <FundsPanel onContinue={next} /> : null}
        {state.step === "files" ? <FilesStep state={state} onNext={next} /> : null}
        {state.step === "options" ? <OptionsStep state={state} onNext={next} onBack={back} /> : null}
        {state.step === "review" ? <ReviewStep state={state} onBack={back} onFunds={() => go("funds")} /> : null}
        {state.step === "upload" ? <UploadStep state={state} /> : null}
        {state.step === "done" ? <DoneStep state={state} /> : null}
      </section>
    </div>
  );
}
