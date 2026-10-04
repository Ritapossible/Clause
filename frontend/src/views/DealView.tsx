import { useCallback, useEffect, useState } from "react";
import { href, useApp } from "../state";
import { readBond, readDeal, write, type Deal, type Line } from "../chain/clause";
import { NETWORKS } from "../chain/networks";
import { digestOfUrl, isSha256Hex } from "../lib/digest";
import { duration, sameAddr, ago } from "../lib/format";
import { useNow, useTx } from "../hooks";
import { Addr, Badge, Empty, Gen, Spinner, TxLine, explainError } from "../components/ui";
import { Owed, total } from "./Deals";

export function DealView({ id }: { id: number }) {
  const { client, clause, me } = useApp();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [err, setErr] = useState("");
  const local = useNow(1000);

  const load = useCallback(async () => {
    if (!clause) return;
    try {
      setDeal(await readDeal(client, clause, id));
      setReadAt(Date.now() / 1000);
      setErr("");
    } catch (e) {
      setErr("No deal with this number on this network.");
      console.warn(e);
    }
  }, [client, clause, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <Empty>{err} <a href={href({ name: "deals" })}>All deals</a></Empty>;
  if (!deal) return <Spinner />;
  // The contract's clock, advanced by how long ago it was read.
  const now = deal.now + (local - readAt);
  const isBuyer = sameAddr(me, deal.buyer);
  const isSeller = sameAddr(me, deal.seller);
  const expired = deal.lines.some(
    (l) =>
      (l.state === "funded" && !deal.delivery && now > deal.deliver_by) ||
      (l.state === "in_review" && now > (l.review_until ?? Infinity)) ||
      (l.state === "disputed" && now > (l.dispute?.rule_by ?? Infinity)) ||
      (l.state === "failed" && now > (l.redeliver_by ?? Infinity)),
  );

  return (
    <>
      <a href={href({ name: "deals" })} className="small">← All deals</a>
      <h1 className="page-title" style={{ marginTop: 8 }}>Deal #{deal.id}</h1>
      <p className="lede" style={{ marginBottom: 14 }}>
        <Gen atto={total(deal)} /> in {deal.lines.length} {deal.lines.length === 1 ? "clause" : "clauses"}, each paid on its own.
      </p>
      <div className="card">
        <dl className="kv">
          <dt>Buyer</dt><dd><Addr value={deal.buyer} label={isBuyer ? "you" : undefined} /></dd>
          <dt>Seller</dt><dd><Addr value={deal.seller} label={isSeller ? "you" : undefined} /></dd>
          <dt>Spec pinned</dt><dd className="mono small" style={{ overflowWrap: "anywhere" }}>sha256 {deal.spec_digest}</dd>
          <dt>Funded</dt><dd>{ago(deal.created_at, now)}</dd>
          <dt>Delivery</dt>
          <dd>
            {deal.delivery ? (
              <>
                <a href={deal.delivery.uri} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{deal.delivery.uri}</a>
                <div className="mono small muted" style={{ overflowWrap: "anywhere" }}>sha256 {deal.delivery.digest}</div>
                <div className="small muted">{deal.deliveries > 1 ? `redelivered (${deal.deliveries} deliveries), ` : ""}{ago(deal.delivery.at, now)}</div>
              </>
            ) : now > deal.deliver_by ? (
              "None by the deadline - the buyer is refunded"
            ) : (
              `Waiting - the seller has ${duration(deal.deliver_by - now)}`
            )}
          </dd>
        </dl>
        {expired && <Settle deal={deal} onDone={load} />}
      </div>

      {isSeller && <Deliver deal={deal} now={now} onDone={load} />}

      {deal.lines.map((l) => (
        <LineCard key={l.id} deal={deal} line={l} now={now} isBuyer={isBuyer} onDone={load} />
      ))}

      {deal.refused && deal.refused.length > 0 && (
        <div className="card">
          <h3>Refused disputes</h3>
          <p className="sub">No jury ran for these. Each bond was credited back to the buyer.</p>
          {deal.refused.map((r, i) => (
            <div key={i} className="notice small">
              Cited <b className="mono">{r.cited}</b> {ago(r.at, now)}: {r.reason}
            </div>
          ))}
        </div>
      )}
      {(isBuyer || isSeller) && <Owed />}
    </>
  );
}

function Settle({ deal, onDone }: { deal: Deal; onDone: () => Promise<void> }) {
  const { client, clause, network, pollMs, canSign } = useApp();
  const tx = useTx();
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row">
        <button className="btn" disabled={!canSign || tx.pending} onClick={() => tx.run((h) => write(client, clause, "settle", [deal.id], pollMs, h), onDone)}>
          {tx.pending ? <Spinner /> : null} Apply the deadlines that have passed
        </button>
        <span className="hint">Anyone may. No jury runs: every deadline resolves by arithmetic.</span>
      </div>
      <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome} successText="Settled." />
      {tx.err && <div className="notice bad">{tx.err}</div>}
    </div>
  );
}

function Deliver({ deal, now, onDone }: { deal: Deal; now: number; onDone: () => Promise<void> }) {
  const { client, clause, network, pollMs, canSign } = useApp();
  const [uri, setUri] = useState("");
  const [digest, setDigest] = useState("");
  const [hashing, setHashing] = useState(false);
  const [note, setNote] = useState("");
  const tx = useTx();
  const first = !deal.delivery && now <= deal.deliver_by;
  const failed = deal.lines.filter((l) => l.state === "failed" && now <= (l.redeliver_by ?? 0));
  if (!first && failed.length === 0) return null;
  return (
    <div className="card">
      <h3>{first ? "Deliver the work" : "Redeliver"}</h3>
      <p className="sub">
        {first
          ? "One URL for the whole deal, pinned by its sha256. Keep it available: validators fetch it and check the digest themselves, and work that is not at its digest cannot meet a clause."
          : `The jury found ${failed.map((l) => l.id).join(", ")} unmet. A redelivery reopens only ${failed.length === 1 ? "that clause" : "those clauses"} for review.`}
      </p>
      <input placeholder="https://… the delivered work" value={uri} onChange={(e) => setUri(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <input className="mono" placeholder="sha256 hex" value={digest} onChange={(e) => setDigest(e.target.value)} style={{ flex: "1 1 260px" }} />
        <button className="btn" disabled={!uri || hashing} onClick={async () => {
          setHashing(true);
          setNote("");
          try {
            const r = await digestOfUrl(uri);
            setDigest(r.digest);
            setNote(`${r.bytes} bytes hashed in your browser.`);
          } catch (e) {
            setNote(explainError(e));
          } finally {
            setHashing(false);
          }
        }}>{hashing ? <Spinner /> : null} Compute digest</button>
      </div>
      {note && <p className="small muted">{note}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!canSign || tx.pending || !uri || !isSha256Hex(digest)}
          onClick={() => tx.run((h) => write(client, clause, "deliver", [deal.id, uri.trim(), digest.trim().toLowerCase()], pollMs, h), onDone)}>
          {tx.pending ? <Spinner /> : null} {first ? "Deliver" : "Redeliver"}
        </button>
      </div>
      <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome} refusalHint="The contract refused the delivery." />
      {tx.err && <div className="notice bad">{tx.err}</div>}
    </div>
  );
}

function LineCard({ deal, line, now, isBuyer, onDone }: { deal: Deal; line: Line; now: number; isBuyer: boolean; onDone: () => Promise<void> }) {
  const { client, clause, network, pollMs, canSign } = useApp();
  const [text, setText] = useState("");
  const [bond, setBond] = useState<bigint | null>(null);
  const tx = useTx();
  useEffect(() => {
    readBond(client, clause, deal.id, line.id).then(setBond).catch(() => setBond(null));
  }, [client, clause, deal.id, line.id]);
  const canDispute = isBuyer && line.state === "in_review" && now <= (line.review_until ?? 0);
  const canRule = line.state === "disputed" && now <= (line.dispute?.rule_by ?? 0);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>
          <span className="mono">{line.id}</span> · <Gen atto={line.amount} />
        </h3>
        <Badge kind={line.state} />
      </div>
      <p style={{ margin: "10px 0 4px" }}>{line.criterion}</p>
      <div className="notice small" style={{ margin: "6px 0 10px" }}>
        <b>Acceptance test:</b> {line.test}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {line.state === "funded" && "Waiting for the delivery."}
        {line.state === "in_review" && `Open for review for ${duration((line.review_until ?? 0) - now)}; with no dispute it pays the seller.`}
        {line.state === "disputed" &&
          (canRule ? `Disputed. Anyone may convene the jury for ${duration((line.dispute?.rule_by ?? 0) - now)}; after that it pays the seller and the bond goes back.` : "Disputed, and the ruling deadline has passed: settling pays the seller and returns the bond.")}
        {line.state === "failed" &&
          ((line.redeliver_by ?? 0) > now
            ? `Judged unmet. The seller may redeliver for ${duration((line.redeliver_by ?? 0) - now)}; after that the buyer is refunded.`
            : "Judged unmet. The redelivery window has closed; settling the deal refunds the buyer.")}
        {line.state === "released" && (line.lapsed ? "Paid to the seller: no ruling landed by the deadline; the bond went back." : "Paid to the seller.")}
        {line.state === "refunded" && "Refunded to the buyer."}
      </p>
      {line.verdict && (
        <div className="notice" style={{ marginTop: 10 }}>
          Jury: <Badge kind={line.verdict} /> <span className="small">({line.reason}, {line.confidence}% · work {line.artifact})</span>
        </div>
      )}
      {line.dispute && (
        <p className="small" style={{ marginTop: 10 }}>
          Dispute by the buyer, bond <Gen atto={line.dispute.bond} />. Their note, kept for people and <b>never shown to the jury</b>: “{line.dispute.text || "(none)"}”
        </p>
      )}

      {canDispute && (
        <div style={{ marginTop: 12 }}>
          <textarea rows={2} placeholder="Your note (people see it; the jury does not - it reads only the clause and the work)" value={text}
            onChange={(e) => setText(e.target.value)} style={{ width: "100%" }} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!canSign || tx.pending || bond === null}
              onClick={() => tx.run((h) => write(client, clause, "dispute", [deal.id, line.id, text], pollMs, h, bond ?? 0n), onDone)}>
              {tx.pending ? <Spinner /> : null} Dispute "{line.id}" with a bond of {bond === null ? "…" : <Gen atto={bond} />}
            </button>
            <span className="hint">Back if the clause is unmet or undetermined; paid to the seller if it is met.</span>
          </div>
        </div>
      )}
      {canRule && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!canSign || tx.pending}
            onClick={() => tx.run((h) => write(client, clause, "rule", [deal.id, line.id], pollMs, h), onDone)}>
            {tx.pending ? <Spinner /> : null} Convene the jury
          </button>
          <span className="hint">Validators fetch the work, check its digest, and each answer: does it fail this clause as written?</span>
        </div>
      )}
      <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome} refusalHint="The contract refused." />
      {tx.err && <div className="notice bad">{tx.err}</div>}
      <p className="small muted" style={{ marginTop: 8 }}>
        On {NETWORKS[network].short}. Times are the contract's clock.
      </p>
    </div>
  );
}
