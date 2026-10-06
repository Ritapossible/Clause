import { useCallback, useEffect, useState } from "react";
import { DealScope, appDealId, href, useApp } from "../state";
import { NETWORKS } from "../chain/networks";
import { readDeal, readOwed, readRefusal, readStatus, write, type Deal, type Status } from "../chain/clause";
import { sameAddr, ago } from "../lib/format";
import { useTx } from "../hooks";
import { Addr, Badge, Empty, Gen, Spinner, TxLine } from "../components/ui";

const SHOW = 40;

export function lineSummary(d: Deal) {
  const n = d.lines.length;
  const by = (s: string) => d.lines.filter((l) => l.state === s).length;
  if (by("released") + by("refunded") === n) return "closed";
  if (by("disputed")) return "disputed";
  if (!d.delivery) return "funded";
  if (by("failed")) return "failed";
  return "in_review";
}

export function total(d: Deal): bigint {
  return d.lines.reduce((a, l) => a + BigInt(l.amount), 0n);
}

export function Deals() {
  const { client, clause, network, me } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  // Each deal with the number the app shows it under (see state.dealHome).
  const [deals, setDeals] = useState<{ d: Deal; n: number }[] | null>(null);
  const [mine, setMine] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!clause) return;
    setLoading(true);
    setErr("");
    try {
      const s = await readStatus(client, clause);
      setStatus(s);
      const ids = Array.from({ length: Math.min(SHOW, s.deals) }, (_, i) => s.deals - 1 - i);
      const current = await Promise.all(ids.map(async (i) => ({ d: await readDeal(client, clause, i), n: appDealId(network, i) })));
      // Then the previous release's deals, under the numbers they always had.
      const p = NETWORKS[network].previous;
      const more = p ? Array.from({ length: Math.min(SHOW - current.length, p.deals) }, (_, i) => p.deals - 1 - i) : [];
      const earlier = p ? await Promise.all(more.map(async (i) => ({ d: await readDeal(client, p.clause, i), n: i }))) : [];
      setDeals([...current, ...earlier]);
    } catch (e) {
      setErr("Could not read the contract. The network may be busy - try again.");
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [client, clause, network]);
  useEffect(() => {
    setDeals(null);
    void reload();
  }, [reload]);

  if (!clause) return <Empty>Clause is not deployed on {NETWORKS[network].label} in this build.</Empty>;
  const rows = (deals ?? []).filter(({ d }) => !mine || sameAddr(d.buyer, me) || sameAddr(d.seller, me));
  const previous = NETWORKS[network].previous;

  return (
    <>
      <div className="row page-head" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Deals</h1>
          <p className="lede" style={{ marginBottom: 16 }}>
            Every escrow on the Clause contract, newest first. Each clause is paid on its own: undisputed clauses pay when
            their review window closes; a disputed one goes to the jury, which only reads the clause as written.
          </p>
        </div>
        <button className="btn" onClick={() => void reload()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <Owed />
      {previous && (
        <DealScope id={0}>
          <Owed earlier={previous.release} />
        </DealScope>
      )}
      {status && (
        <p className="small muted" style={{ margin: "14px 0" }}>
          Contract <Addr value={clause} /> · {status.deals} deals · <Gen atto={status.held} /> held in escrow ·{" "}
          <Gen atto={status.owed} /> owed, waiting to be withdrawn
          {previous && <> · deals #0-{previous.deals - 1} are on the earlier release ({previous.release}, <Addr value={previous.clause} />)</>}
        </p>
      )}
      <div className="filters" role="group" aria-label="Filter">
        <button className="chip" aria-pressed={!mine} onClick={() => setMine(false)}>All</button>
        <button className="chip" aria-pressed={mine} onClick={() => setMine(true)} disabled={!me}>Mine</button>
      </div>
      {err && <div className="notice bad">{err}</div>}
      {deals === null && !err && <Spinner />}
      {deals && rows.length === 0 && (
        <Empty>
          {mine ? "No deals with this wallet as buyer or seller." : "No deals yet."}{" "}
          <a href={href({ name: "new" })}>Fund the first one.</a>
        </Empty>
      )}
      {rows.length > 0 && (
        <div className="table-wrap stack-wrap">
          <table className="table stack">
            <thead>
              <tr>
                <th>#</th>
                <th className="num">Escrow</th>
                <th>Clauses</th>
                <th>Buyer</th>
                <th>Seller</th>
                <th>State</th>
                <th>Funded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, n }) => (
                <tr key={n} className="click" tabIndex={0}
                  onClick={() => (window.location.hash = href({ name: "deal", id: n }))}
                  onKeyDown={(e) => e.key === "Enter" && (window.location.hash = href({ name: "deal", id: n }))}>
                  <td className="mono card-head" data-label="Deal #">{n}</td>
                  <td className="num" data-label="Escrow"><Gen atto={total(d)} /></td>
                  <td data-label="Clauses" className="mono small">{d.lines.map((l) => l.id).join(", ")}</td>
                  <td data-label="Buyer" onClick={(e) => e.stopPropagation()}><Addr value={d.buyer} label={sameAddr(d.buyer, me) ? "you" : undefined} /></td>
                  <td data-label="Seller" onClick={(e) => e.stopPropagation()}><Addr value={d.seller} label={sameAddr(d.seller, me) ? "you" : undefined} /></td>
                  <td data-label="State"><Badge kind={lineSummary(d) === "closed" ? "released" : lineSummary(d)}>{lineSummary(d) === "closed" ? "Closed" : undefined}</Badge></td>
                  <td className="small muted" data-label="Funded">{ago(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** What the connected wallet is owed, with a withdraw button, and why its
 *  last payable call was refused, if it was. */
/** What the escrow in scope owes the signer. ``earlier`` names a previous
 *  release: then the card shows only when something is owed there. */
export function Owed({ earlier = "" }: { earlier?: string }) {
  const { client, clause, me, network, pollMs, canSign } = useApp();
  const [owed, setOwed] = useState<bigint | null>(null);
  const [refusal, setRefusal] = useState<{ reason?: string; at?: number; returned?: string }>({});
  const tx = useTx();
  const load = useCallback(async () => {
    if (!me || !clause) return;
    setOwed(await readOwed(client, clause, me).catch(() => null));
    setRefusal(await readRefusal(client, clause, me).catch(() => ({})));
  }, [client, clause, me]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!me) return null;
  if (earlier && !owed && !refusal.reason) return null;
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0 }}>Owed to you{earlier ? ` on the earlier release (${earlier})` : ""}</h3>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Rulings and deadlines credit what each party is owed; withdrawing sends it to your wallet.
          </p>
        </div>
        <div className="row">
          <strong style={{ fontSize: 22 }}>{owed === null ? "…" : <Gen atto={owed} />}</strong>
          <button className="btn primary" disabled={!canSign || tx.pending || !owed}
            onClick={() => tx.run((h) => write(client, clause, "withdraw", [], pollMs, h), load)}>
            {tx.pending ? <Spinner /> : null} Withdraw
          </button>
        </div>
      </div>
      {refusal.reason && (
        <div className="notice warn small" style={{ marginTop: 10 }}>
          Your last {BigInt(refusal.returned ?? "0") > 0n ? <>payment of <Gen atto={refusal.returned ?? "0"} /></> : "call"} was refused and
          credited back: {refusal.reason}
        </div>
      )}
      <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome}
        successText="Sent. Your wallet is credited when the transaction finalises." />
      {tx.err && <div className="notice bad">{tx.err}</div>}
    </div>
  );
}
