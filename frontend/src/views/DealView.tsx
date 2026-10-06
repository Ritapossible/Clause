import { useCallback, useEffect, useState } from "react";
import { DealScope, dealHome, href, useApp } from "../state";
import { readBond, readDeal, readRuling, write, type Artifact, type Deal, type Line, type Ruling } from "../chain/clause";
import { NETWORKS } from "../chain/networks";
import { digestOfUrl, isSha256Hex } from "../lib/digest";
import { locateError } from "../lib/spec";
import { duration, sameAddr, ago } from "../lib/format";
import { useNow, useTx } from "../hooks";
import { Addr, Badge, Empty, Gen, Spinner, TxLine, explainError } from "../components/ui";
import { Owed, total } from "./Deals";

/** Deal ``id`` as the app numbers it: on the previous release's escrow for
 *  the numbers that release used, else on the current one. */
export function DealView({ id }: { id: number }) {
  const { network } = useApp();
  const home = dealHome(network, id);
  return (
    <DealScope id={id}>
      <DealPage id={home.local} shown={id} release={home.release} />
    </DealScope>
  );
}

function DealPage({ id, shown, release }: { id: number; shown: number; release: string }) {
  const { client, clause, me, appealSeconds } = useApp();
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
      (l.state === "disputed" && now > (l.dispute?.rule_by ?? Infinity) + appealSeconds) ||
      (l.state === "failed" && now > (l.redeliver_by ?? Infinity)),
  );

  return (
    <>
      <a href={href({ name: "deals" })} className="small">← All deals</a>
      <h1 className="page-title" style={{ marginTop: 8 }}>Deal #{shown}</h1>
      {release && (
        <p className="small muted" style={{ margin: "0 0 10px" }}>
          On the earlier escrow release ({release}, <Addr value={clause} />), where it was opened. Its clocks and rulings run
          there unchanged.
        </p>
      )}
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

const ARTIFACT: Record<Artifact, string> = {
  verified: "work verified against its digest",
  changed: "the work at the URL was changed after delivery",
  missing: "the work was removed from its URL (404)",
  unread: "the work could not be fetched",
};

function LineCard({ deal, line, now, isBuyer, onDone }: { deal: Deal; line: Line; now: number; isBuyer: boolean; onDone: () => Promise<void> }) {
  const { client, clause, jury, appealSeconds, network, pollMs, canSign } = useApp();
  const [text, setText] = useState("");
  const [locate, setLocate] = useState("");
  const [bond, setBond] = useState<bigint | null>(null);
  const [ruling, setRuling] = useState<Ruling | null>(null);
  const tx = useTx();
  useEffect(() => {
    readBond(client, clause, deal.id, line.id).then(setBond).catch(() => setBond(null));
  }, [client, clause, deal.id, line.id]);
  const round = line.dispute?.round;
  // Bumped after this card sends a transaction, so the ruling is read again.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRuling(null);
    if (line.state !== "disputed" || !jury) return;
    (async () => {
      // On Bradbury a read straight after a write can still return the old
      // state (measured), so after convening the jury, look a few times.
      for (let i = 0; i < (tick ? 8 : 1) && live; i++) {
        const r = await readRuling(client, jury, clause, deal.id, line.id).catch(() => null);
        if (r?.round && r.round === round) {
          if (live) setRuling(r);
          return;
        }
        if (tick) await new Promise((res) => setTimeout(res, 4000));
      }
    })();
    return () => {
      live = false;
    };
  }, [client, jury, clause, deal.id, line.id, line.state, round, tick]);
  const ruleBy = line.dispute?.rule_by ?? 0;
  const canDispute = isBuyer && line.state === "in_review" && now <= (line.review_until ?? 0);
  // A round that could not fetch the work is recorded, not a verdict; the jury
  // may be convened again a quarter of the ruling window later (clause_core.unread_gap).
  const unread = ruling?.unread ?? 0;
  const retryFrom = unread > 0 ? (ruling?.at ?? 0) + Math.max(1, Math.floor(deal.timing.ruling_seconds / 4)) : 0;
  const canRule = line.state === "disputed" && !ruling?.verdict && now <= ruleBy;
  const noted = Math.max(line.unread ?? 0, 0);
  const applyFrom = (ruling?.at ?? 0) + appealSeconds;
  const locErr = locateError(locate.trim());
  const reload = async () => {
    await onDone();
    setTick((t) => t + 1);
  };

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
        {line.state === "disputed" && !ruling?.verdict && (unread > 0 || noted > 0) &&
          (now <= ruleBy
            ? `The work could not be fetched in ${Math.max(unread, noted)} of 3 jury rounds. It is never paid for unread: a third unreadable round, or the deadline in ${duration(ruleBy + appealSeconds - now)}, refunds the buyer with the bond.`
            : "The work could not be fetched before the deadline: settling refunds the buyer with the bond. Nothing is paid for work nobody could read.")}
        {line.state === "disputed" && !ruling?.verdict && unread === 0 && noted === 0 &&
          (canRule
            ? `Disputed. The dispute convened the jury; if no ruling shows, anyone may convene it again for ${duration(ruleBy - now)}; with no ruling the clause pays the seller ${duration(ruleBy + appealSeconds - now)} from now and the bond goes back.`
            : now > ruleBy + appealSeconds
              ? "Disputed, and no ruling landed in time: settling pays the seller and returns the bond."
              : `Disputed; no ruling landed by the deadline. The clause pays the seller in ${duration(ruleBy + appealSeconds - now)}.`)}
        {line.state === "failed" &&
          ((line.redeliver_by ?? 0) > now
            ? `Judged unmet. The seller may redeliver for ${duration((line.redeliver_by ?? 0) - now)}; after that the buyer is refunded.`
            : "Judged unmet. The redelivery window has closed; settling the deal refunds the buyer.")}
        {line.state === "released" && (line.lapsed ? "Paid to the seller: no ruling was applied by the deadline; the bond went back." : "Paid to the seller.")}
        {line.state === "refunded" &&
          (line.unavailable
            ? "Refunded to the buyer, with the bond: nobody could fetch the work, so nothing was paid for it."
            : "Refunded to the buyer.")}
      </p>
      {line.verdict && (
        <div className="notice" style={{ marginTop: 10 }}>
          Jury: <Badge kind={line.verdict} /> <span className="small">({line.reason}, {line.confidence}% · {line.artifact ? ARTIFACT[line.artifact] ?? line.artifact : ""})</span>
        </div>
      )}
      {ruling?.verdict && (
        <div className="notice" style={{ marginTop: 10 }}>
          Jury: <Badge kind={ruling.verdict} /> <span className="small">({ruling.reason}, {ruling.confidence}% · {ruling.artifact ? ARTIFACT[ruling.artifact] ?? ruling.artifact : ""})</span>
          <div className="small" style={{ marginTop: 6 }}>
            Recorded by the jury contract. {now >= applyFrom
              ? "Its appeal window has passed: anyone may apply it to the escrow."
              : `The escrow can apply it in ${duration(applyFrom - now)}, after its appeal window.`}
          </div>
        </div>
      )}
      {line.dispute && (
        <p className="small" style={{ marginTop: 10 }}>
          Dispute by the buyer, bond <Gen atto={line.dispute.bond} />
          {line.dispute.locate ? <>, pointing the jury at <span className="mono">{line.dispute.locate}</span></> : null}. Their note, kept for
          people and <b>never shown to the jury</b>: “{line.dispute.text || "(none)"}”
        </p>
      )}

      {canDispute && (
        <div style={{ marginTop: 12 }}>
          <textarea rows={2} placeholder="Your note (people see it; the jury does not - it reads only the clause and the work)" value={text}
            onChange={(e) => setText(e.target.value)} style={{ width: "100%" }} />
          <label className="field" style={{ marginTop: 10 }}>
            Location in the work (optional)
            <input className="mono" placeholder="/items/71  or  bytes:5600-5800" value={locate} onChange={(e) => setLocate(e.target.value)} />
            <span className="hint">
              {locate && locErr
                ? locErr
                : "Where to look, if the problem is deep in the work: the jury reads only the first 4,000 characters, plus the bytes you point at. It sees the bytes, never your pointer or your note."}
            </span>
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!canSign || tx.pending || bond === null || !!locErr}
              onClick={() => tx.run((h) => write(client, clause, "dispute", [deal.id, line.id, text, locate.trim()], pollMs, h, bond ?? 0n), reload)}>
              {tx.pending ? <Spinner /> : null} Dispute "{line.id}" with a bond of {bond === null ? "…" : <Gen atto={bond} />}
            </button>
            <span className="hint">Back if the clause is unmet or undetermined; paid to the seller if it is met.</span>
          </div>
        </div>
      )}
      {unread > 0 && !ruling?.verdict && line.state === "disputed" && unread > noted && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={!canSign || tx.pending}
            onClick={() => tx.run((h) => write(client, clause, "apply_ruling", [deal.id, line.id], pollMs, h), reload)}>
            {tx.pending ? <Spinner /> : null} Record the failed fetch on the escrow
          </button>
          <span className="hint">From then on the deadline refunds the buyer instead of paying the seller. Anyone may do it.</span>
        </div>
      )}
      {canRule && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!canSign || tx.pending || !jury || now < retryFrom}
            onClick={() => tx.run((h) => write(client, jury, "rule", [clause, deal.id, line.id], pollMs, h), reload)}>
            {tx.pending ? <Spinner /> : null} Convene the jury
          </button>
          <span className="hint">
            {now < retryFrom
              ? `The last round could not fetch the work; the jury may try again in ${duration(retryFrom - now)}.`
              : "Validators fetch the work, check its digest, and each answer: does it fail this clause as written?"}
          </span>
        </div>
      )}
      {ruling?.verdict && line.state === "disputed" && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!canSign || tx.pending || now < applyFrom}
            onClick={() => tx.run((h) => write(client, clause, "apply_ruling", [deal.id, line.id], pollMs, h), reload)}>
            {tx.pending ? <Spinner /> : null} Apply the ruling
          </button>
          <span className="hint">The escrow reads the jury contract here, and nowhere else.</span>
        </div>
      )}
      <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome}
        refusalHint="The contract refused." />
      {tx.err && <div className="notice bad">{tx.err}</div>}
      <p className="small muted" style={{ marginTop: 8 }}>
        On {NETWORKS[network].short}. Times are the contract's clock.
      </p>
    </div>
  );
}
