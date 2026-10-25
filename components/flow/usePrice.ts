"use client";
import { fetchPricePerGb } from "@/lib/params";
import { usePoll } from "@/lib/hooks";

/** Storage price per GiB per 1,000 blocks. Uses the devnet default until the node answers. */
export function usePrice(): { price: bigint | undefined; live: boolean } {
  const q = usePoll("price", () => fetchPricePerGb(), 0);
  return { price: q.data?.price, live: !!q.data?.live };
}
