"use client";

import { Suspense } from "react";
import { Gate } from "../Gate";
import { Skeleton } from "../ui";
import { Library } from "./Library";

export function LibraryView() {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Gate needKey={false}>{({ profile, unlocked }) => <Library profile={profile} unlocked={unlocked} />}</Gate>
    </Suspense>
  );
}
