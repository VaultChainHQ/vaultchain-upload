"use client";
import { useSyncExternalStore } from "react";
import { INITIAL_FLOW, flowStore, type FlowState } from "@/lib/flow";

export function useFlow(): FlowState {
  const s = flowStore();
  return useSyncExternalStore(s.subscribe, s.get, () => INITIAL_FLOW);
}
