"use client";

import { short } from "@/lib/format";
import { Gate } from "../Gate";
import { Avatar } from "../ui";

/** Step 1 is the shared Gate: create / import / unlock. Once unlocked we show who you are and carry on. */
export function ProfileStep({ onNext }: { onNext: () => void }) {
  return (
    <Gate>
      {({ profile }) => (
        <div className="stack">
          <p className="callout good" role="status">
            <Avatar name={profile.entry.name} color={profile.entry.color} size={28} /> You are signed in as <strong>{profile.entry.name}</strong> <span className="mono muted">{short(profile.entry.address, 10, 6)}</span>.
          </p>
          <div className="row step-actions">
            <button type="button" className="btn primary" onClick={onNext} autoFocus>
              Continue
            </button>
          </div>
        </div>
      )}
    </Gate>
  );
}
