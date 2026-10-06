import { useMemo, useState } from "react";
import { appDealId, href, useApp } from "../state";
import { readRefusal, readStatus, readDeal, write } from "../chain/clause";
import { NETWORKS } from "../chain/networks";
import { specErrors, total, MAX_CLAUSES, type ClauseSpec } from "../lib/spec";
import { formatGen, parseGen } from "../lib/money";
import { duration, sameAddr } from "../lib/format";
import { useTx } from "../hooks";
import { Gen, Spinner, TxLine } from "../components/ui";

interface Row {
  id: string;
  criterion: string;
  test: string;
  amount: string; // GEN, as typed
}

const EXAMPLE: Row[] = [
  { id: "cities", criterion: "A list of African cities for the travel page", test: "The response contains exactly 3 city names", amount: "0.05" },
  { id: "format", criterion: "Machine-readable output", test: 'The deliverable is JSON with a top-level key "cities"', amount: "0.03" },
];

const PRESETS = {
  demo: { label: "Demo - minutes", delivery_seconds: 3600, review_seconds: 300, redelivery_seconds: 1800, ruling_seconds: 1800 },
  standard: { label: "Standard - days", delivery_seconds: 7 * 86400, review_seconds: 3 * 86400, redelivery_seconds: 3 * 86400, ruling_seconds: 2 * 86400 },
};

const EMPTY: Row = { id: "", criterion: "", test: "", amount: "" };

/** The spec as the contract reads it. Amounts are atto-GEN, above 2^53, so
 *  they are written as exact JSON integers - never through Number(). */
export function specJson(clauses: ClauseSpec[]): string {
  return JSON.stringify(clauses.map((c) => ({ ...c, amount: `__BIG__${BigInt(String(c.amount))}` }))).replace(/"__BIG__(\d+)"/g, "$1");
}

export function NewDeal() {
  const { client, clause, network, me, canSign, pollMs } = useApp();
  const [seller, setSeller] = useState("");
  const [rows, setRows] = useState<Row[]>(EXAMPLE);
  const [preset, setPreset] = useState<keyof typeof PRESETS>("demo");
  const [refusal, setRefusal] = useState("");
  const tx = useTx();

  // Bradbury takes minutes per transaction, so its demo review window is longer.
  const { label: _label, ...base } = PRESETS[preset];
  const timing: Record<string, number> = { ...base };
  if (preset === "demo" && network === "bradbury") timing.review_seconds = 1800;

  const parsed = useMemo(() => {
    const clauses: ClauseSpec[] = [];
    const amountErrors: string[] = [];
    rows.forEach((r, i) => {
      let atto = 0n;
      try {
        atto = parseGen(r.amount || "0");
      } catch {
        amountErrors.push(`clause ${i + 1}: enter the amount in GEN, like 0.05`);
      }
      clauses.push({ id: r.id.trim(), criterion: r.criterion, test: r.test, amount: atto });
    });
    return { clauses, amountErrors };
  }, [rows]);
  const sellerOk = /^0x[0-9a-fA-F]{40}$/.test(seller.trim());
  const errors = [
    ...(sellerOk ? [] : ["enter the seller's address"]),
    ...parsed.amountErrors,
    ...specErrors(parsed.clauses, { buyer: me, seller: seller.trim(), timing }),
  ];
  const sum = total(parsed.clauses);
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const fund = () =>
    tx.run(
      (h) =>
        write(client, clause, "create_deal", [
          seller.trim(),
          specJson(parsed.clauses),
          timing.delivery_seconds,
          timing.review_seconds,
          timing.redelivery_seconds,
          timing.ruling_seconds,
        ], pollMs, h, sum),
      async (o) => {
        if (!o.applied) return;
        // The contract refuses without reverting, so check whether it funded.
        const s = await readStatus(client, clause);
        for (let i = s.deals - 1; i >= Math.max(0, s.deals - 5); i--) {
          const d = await readDeal(client, clause, i);
          if (sameAddr(d.buyer, me) && sameAddr(d.seller, seller.trim()) && Date.now() / 1000 - d.created_at < 900) {
            window.location.hash = href({ name: "deal", id: appDealId(network, i) });
            return;
          }
        }
        setRefusal((await readRefusal(client, clause, me)).reason ?? "The contract did not record a deal.");
      },
    );

  return (
    <>
      <h1 className="page-title">Fund a deal</h1>
      <p className="lede">
        Write the spec as clauses. Each clause has an amount and an <b>acceptance test</b> someone could check against the
        work - a number, a quoted value, a structure. A test that leans on taste ("good", "professional") cannot be
        funded, because every delivery could be argued against it afterwards. The spec is pinned when you fund it.
      </p>

      <div className="card">
        <label>
          Seller
          <span className="hint">the address that delivers and is paid</span>
          <input className="mono" placeholder="0x…" value={seller} onChange={(e) => setSeller(e.target.value)} />
        </label>
      </div>

      {rows.map((r, i) => (
        <div className="card" key={i}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Clause {i + 1}</h3>
            {rows.length > 1 && (
              <button className="btn sm ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
            )}
          </div>
          <div className="grid-2">
            <label>
              Clause id <span className="hint">what a dispute cites</span>
              <input className="mono" placeholder="cities" value={r.id} onChange={(e) => set(i, "id", e.target.value)} />
            </label>
            <label>
              Amount (GEN)
              <input className="mono" placeholder="0.05" value={r.amount} onChange={(e) => set(i, "amount", e.target.value)} />
            </label>
          </div>
          <label>
            What is asked
            <input placeholder="A list of African cities for the travel page" value={r.criterion} onChange={(e) => set(i, "criterion", e.target.value)} />
          </label>
          <label>
            Acceptance test <span className="hint">the one sentence the jury checks</span>
            <input placeholder="The response contains exactly 3 city names" value={r.test} onChange={(e) => set(i, "test", e.target.value)} />
          </label>
        </div>
      ))}
      <div className="row" style={{ marginBottom: 18 }}>
        {rows.length < MAX_CLAUSES && <button className="btn" onClick={() => setRows((rs) => [...rs, { ...EMPTY }])}>Add a clause</button>}
        <button className="btn ghost" onClick={() => setRows(EXAMPLE)}>Load the example</button>
      </div>

      <div className="card">
        <h3>Timing</h3>
        <div className="row">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} className="chip" aria-pressed={preset === k} onClick={() => setPreset(k as keyof typeof PRESETS)}>{p.label}</button>
          ))}
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Delivery by</dt><dd>{duration(timing.delivery_seconds)} after funding, or everything is refunded</dd>
          <dt>Review window</dt><dd>{duration(timing.review_seconds)} after delivery to dispute a clause; then it pays</dd>
          <dt>Ruling deadline</dt><dd>{duration(timing.ruling_seconds)} after a dispute; with no ruling, the clause pays and the bond comes back; if the jury could not fetch the work, it refunds you</dd>
          <dt>Redelivery</dt><dd>{duration(timing.redelivery_seconds)} after an unmet ruling; then the clause is refunded</dd>
        </dl>
      </div>

      <div className="card">
        {errors.length > 0 ? (
          errors.map((e) => <div key={e} className="notice bad small">{e}</div>)
        ) : (
          <div className="notice good">The spec can be funded: {parsed.clauses.length} clauses, <Gen atto={sum} /> in total.</div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!canSign || tx.pending || errors.length > 0} onClick={fund}>
            {tx.pending ? <Spinner /> : null} Fund {formatGen(sum)} GEN on {NETWORKS[network].short}
          </button>
          {!canSign && <span className="hint">Connect a wallet{network === "studio" ? " or use a Studio burner" : ""} to fund.</span>}
        </div>
        <TxLine network={network} pending={tx.pending} hash={tx.hash} outcome={tx.outcome} />
        {refusal && <div className="notice bad">Refused, and your GEN was credited back to withdraw: {refusal}</div>}
        {tx.err && <div className="notice bad">{tx.err}</div>}
      </div>
    </>
  );
}
