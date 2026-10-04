import { useState, useEffect } from "react";
import type { TxOutcome } from "./chain/clause";
import { explainError } from "./components/ui";

/** Seconds since the epoch, ticking. For countdowns only - the contract's own
 *  clock is authoritative. */
export function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

/** A transaction in flight, with its outcome. */
export function useTx() {
  const [pending, setPending] = useState(false);
  const [hash, setHash] = useState<string>();
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);
  const [err, setErr] = useState("");
  const run = async (fn: (onHash: (h: string) => void) => Promise<TxOutcome>, after?: (o: TxOutcome) => Promise<void> | void) => {
    setPending(true);
    setHash(undefined);
    setOutcome(null);
    setErr("");
    try {
      const o = await fn(setHash);
      setOutcome(o);
      await after?.(o);
    } catch (e) {
      setErr(explainError(e));
    } finally {
      setPending(false);
    }
  };
  return { pending, hash, outcome, err, run };
}
