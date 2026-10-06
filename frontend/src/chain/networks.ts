import { studionet, testnetBradbury } from "genlayer-js/chains";
import deployments from "../../../deploy/deployments.json";

export type NetworkId = "studio" | "bradbury";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  short: string;
  chain: typeof studionet;
  rpc: string;
  explorer: string;
  /** Studio has a faucet method on its RPC; the testnet has none. */
  faucet: boolean;
  pollMs: number;
  /** The Clause escrow on this network (deploy/deployments.json). */
  clause?: string;
  /** The jury contract the escrow reads rulings from. */
  jury?: string;
  /** How long a ruling waits before the escrow can apply it. */
  appealSeconds: number;
  /** The release before this one. Its deals keep their numbers in the app
   *  (0 to deals-1); the current escrow's deal n is shown as deals + n. */
  previous?: { release: string; clause: string; jury: string; appealSeconds: number; deals: number };
}

type Previous = { release: string; clause: string; jury: string; appeal_seconds: number; deals: number };
const prev = (p?: Previous) =>
  p ? { release: p.release, clause: p.clause, jury: p.jury, appealSeconds: Number(p.appeal_seconds), deals: Number(p.deals) } : undefined;

const d = deployments as Record<string, { clause?: string; jury?: string; appeal_seconds?: number; previous?: Previous }>;
const explorerOf = (c: typeof studionet) => (c.blockExplorers?.default.url ?? "").replace(/\/$/, "");

// Chain config comes from genlayer-js 1.1.8. Older releases pointed the testnet
// at a plain-HTTP raw IP and a retired consensus contract. Bradbury shares
// chain id 4221 with Asimov but routes through a different consensus contract,
// so it is named explicitly and never inferred from the chain id.
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  studio: {
    id: "studio",
    label: "GenLayer Studio",
    short: "Studio",
    chain: studionet,
    rpc: studionet.rpcUrls.default.http[0],
    // genlayer-js still names a retired Studio explorer (genlayer-explorer.vercel.app).
    explorer: "https://explorer-studio.genlayer.com",
    faucet: true,
    pollMs: 2500,
    clause: d.studio?.clause,
    jury: d.studio?.jury,
    appealSeconds: Number(d.studio?.appeal_seconds ?? 0),
    previous: prev(d.studio?.previous),
  },
  bradbury: {
    id: "bradbury",
    label: "GenLayer Bradbury testnet",
    short: "Bradbury",
    chain: testnetBradbury as typeof studionet,
    rpc: testnetBradbury.rpcUrls.default.http[0],
    explorer: explorerOf(testnetBradbury as typeof studionet),
    faucet: false,
    pollMs: 4000,
    clause: d.bradbury?.clause,
    jury: d.bradbury?.jury,
    appealSeconds: Number(d.bradbury?.appeal_seconds ?? 0),
    previous: prev(d.bradbury?.previous),
  },
};
