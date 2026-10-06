import type { Client } from "./wallet";
import { parseLossless } from "../lib/money";

// Every call the app makes to the Clause contract, and how a transaction's
// outcome is read. The contract address comes from deploy/deployments.json
// (networks.ts); nothing here is configured by hand.

type Addr = `0x${string}`;

export type LineState = "funded" | "in_review" | "disputed" | "failed" | "released" | "refunded";
/** "unavailable": the work could not be fetched in 3 jury rounds - a neutral refund. */
export type Verdict = "unmet" | "met" | "undetermined" | "unavailable";

export interface Line {
  id: string;
  criterion: string;
  test: string;
  amount: string;
  state: LineState;
  review_until?: number;
  redeliver_by?: number;
  dispute?: { bond: string; text: string; opened_at: number; rule_by: number; locate?: string; round?: string };
  verdict?: Verdict;
  reason?: string;
  confidence?: number;
  artifact?: Artifact;
  decided_at?: number;
  ruled_at?: number;
  lapsed?: boolean;
  /** Jury rounds that could not fetch the work, noted by the escrow. */
  unread?: number;
  /** Refunded because nobody could read the work. */
  unavailable?: boolean;
}

/** What fetching the delivery found. A definite answer from the server is held
 *  against the seller; no answer is recorded and never pays the seller. */
export type Artifact = "verified" | "changed" | "missing" | "unread";

/** A ruling as the jury contract recorded it, before the escrow applies it. */
export interface Ruling {
  round?: string;
  verdict?: Verdict;
  reason?: string;
  confidence?: number;
  artifact?: Artifact;
  located?: boolean;
  at?: number;
  /** Rounds in this dispute that could not fetch the work (3 = unavailable). */
  unread?: number;
}

export interface Deal {
  id: number;
  buyer: string;
  seller: string;
  created_at: number;
  spec_digest: string;
  timing: { delivery_seconds: number; review_seconds: number; redelivery_seconds: number; ruling_seconds: number };
  deliver_by: number;
  delivery: { uri: string; digest: string; at: number } | null;
  deliveries: number;
  lines: Line[];
  refused?: { cited: string; reason: string; at: number }[];
  /** The contract's clock when this was read. */
  now: number;
}

export interface Status {
  release: string;
  jury?: string;
  appeal_seconds?: number;
  deals: number;
  held: string;
  owed: string;
  balance: string;
  bond_floor: string;
}

export interface TxOutcome {
  hash: string;
  consensus: string;
  leaderStatus: string;
  /** Validators agreed with the leader. */
  agreed: boolean;
  /** Agreed, and the leader's execution returned normally: state changed. */
  applied: boolean;
  /** Agreed that the contract refused. A network success, and a refusal. */
  refused: boolean;
  address?: string;
}

export async function readStatus(c: Client, clause: string): Promise<Status> {
  return parseLossless<Status>(await c.readContract({ address: clause as Addr, functionName: "status", args: [] }));
}

export async function readDeal(c: Client, clause: string, id: number): Promise<Deal> {
  return parseLossless<Deal>(await c.readContract({ address: clause as Addr, functionName: "get_deal", args: [id] }));
}

export async function readRuling(c: Client, jury: string, escrow: string, id: number, clauseId: string): Promise<Ruling> {
  return parseLossless<Ruling>(await c.readContract({ address: jury as Addr, functionName: "ruling_of", args: [escrow, id, clauseId] }));
}

export async function readOwed(c: Client, clause: string, who: string): Promise<bigint> {
  return BigInt(String(await c.readContract({ address: clause as Addr, functionName: "owed_to", args: [who] })));
}

export async function readBond(c: Client, clause: string, id: number, clauseId: string): Promise<bigint> {
  return BigInt(String(await c.readContract({ address: clause as Addr, functionName: "bond_for", args: [id, clauseId] })));
}

export async function readRefusal(c: Client, clause: string, who: string): Promise<{ reason?: string; at?: number; returned?: string }> {
  return parseLossless(await c.readContract({ address: clause as Addr, functionName: "refusal_of", args: [who] }));
}

/**
 * Two receipt shapes exist in the wild, and they spell the same facts
 * differently:
 *
 *   Studio (older gateway)   result_name: MAJORITY_AGREE
 *                            consensus_data.leader_receipt[0].result.status: return
 *   Bradbury (SDK 1.1.8)     resultName: AGREE
 *                            txExecutionResultName: FINISHED_WITH_RETURN
 *
 * Both are read here, so nothing else in the app has to know. Left unhandled,
 * every Bradbury transaction would read as "no consensus".
 */
function interpret(hash: string, receipt: unknown): TxOutcome {
  const r = receipt as {
    result_name?: string;
    resultName?: string;
    txExecutionResultName?: string;
    data?: { contract_address?: string };
    txDataDecoded?: { contractAddress?: string };
    consensus_data?: { leader_receipt?: { result?: { status?: string } }[] };
  };
  const consensus = r?.result_name ?? r?.resultName ?? "UNKNOWN";
  const exec = r?.txExecutionResultName ?? "";
  const leaderStatus =
    r?.consensus_data?.leader_receipt?.[0]?.result?.status ??
    (/RETURN/.test(exec) ? "return" : /ERROR|ROLLBACK/.test(exec) ? "contract_error" : exec || "unknown");
  const agreed = /AGREE/.test(consensus) && !/DISAGREE/.test(consensus);
  return {
    hash,
    consensus,
    leaderStatus,
    agreed,
    applied: agreed && leaderStatus === "return",
    refused: agreed && leaderStatus === "contract_error",
    address: r?.data?.contract_address ?? r?.txDataDecoded?.contractAddress,
  };
}

async function settle(c: Client, hash: string, pollMs: number): Promise<TxOutcome> {
  // Clause binds on acceptance, not finality, so ACCEPTED is what the UI waits
  // for. If a gateway returns a receipt without a consensus result yet, fall
  // through to finality rather than guessing.
  const accepted = await c.waitForTransactionReceipt({
    hash: hash as never,
    status: "ACCEPTED" as never,
    interval: pollMs,
    retries: 400,
  });
  let current = interpret(hash, accepted);
  // On Bradbury a receipt can arrive while its round is still IDLE (no votes)
  // for a transaction that reaches AGREE seconds later. Poll the transaction
  // until the round is decided rather than reporting "no consensus".
  const undecided = (o: TxOutcome) => o.consensus === "UNKNOWN" || o.consensus === "IDLE";
  for (let i = 0; i < 120 && undecided(current); i++) {
    await new Promise((r) => setTimeout(r, Math.max(pollMs, 3000)));
    current = interpret(hash, await c.getTransaction({ hash: hash as never }).catch(() => accepted));
  }
  if (!undecided(current)) return current;
  const finalised = await c.waitForTransactionReceipt({
    hash: hash as never,
    status: "FINALIZED" as never,
    interval: pollMs,
    retries: 400,
  });
  return interpret(hash, finalised);
}

export async function write(
  c: Client,
  guard: string,
  functionName: string,
  args: unknown[],
  pollMs: number,
  onHash?: (hash: string) => void,
  value: bigint = 0n,
): Promise<TxOutcome> {
  const hash = (await c.writeContract({
    address: guard as Addr,
    functionName,
    args: args as never,
    value,
  })) as string;
  onHash?.(hash);
  return settle(c, hash, pollMs);
}

