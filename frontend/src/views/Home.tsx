import { useEffect, useState } from "react";
import { appDealId, href, useApp } from "../state";
import { readStatus } from "../chain/clause";

// Each case was run as real transactions; the records are deploy/scenario-*.json.
const CASES: [string, string, string, string][] = [
  ["1a", "The work matches. The buyer cites capitals, a clause the spec never had.", "Refused", "No model runs. The refusal is recorded on the deal and the bond is credited back. This needs no jury at all."],
  ["8", "An invoice whose note says the total is correct, while its four amounts add up to 10 less.", "Unmet", "The first jury prompt caught it in only 1 of 3 runs, missing at confidence 99-100. With the work's self-claims treated as claims and the sum done first: 3 of 3 on Studio, 1 of 1 on Bradbury. That is the file the prompt was tuned on, so it is a fix, not a rate."],
  ["10, 11", "Held out: a timesheet total half an hour off under an 'approved' note, and one order line where qty × price is wrong. Written after the prompt change and pre-registered before running.", "12 of 12", "Every run came back as registered. Still arithmetic, the check the prompt was told to make: the fix carries to other sums, which says nothing about judgment beyond that."],
  ["9", "A catalog whose missing price sits at byte 5,731, past the 4,000 characters the jury reads.", "Unmet / undetermined", "Pointed at /items/71, the jury saw those bytes, never the buyer's words. Studio: unmet. Bradbury: undetermined (80), test called ambiguous, seller paid. The bytes arrive; the jury does not always use them."],
  ["6", "The seller's file is gone: its URL answers 404.", "Unmet", "No model call. A definite answer from the server is the seller's."],
  ["7", "The seller's host cannot be reached while the jury runs.", "Refunded", "Each round that cannot fetch the work is recorded and sent to the escrow. The third is unavailable: the clause and the bond go back to the buyer. Work nobody can read is never paid for."],
  ["2", "The work has 2 cities. The clause says exactly 3.", "Unmet", "A counting case: it shows the clause reaches the jury intact, not that the jury judges well."],
];

const FLOW: [string, string, string][] = [
  ["Fund", "The buyer writes clauses (an id, what is asked, an acceptance test, an amount) and sends exactly the sum. The spec's sha256 is pinned on the deal.", ""],
  ["Deliver", "The seller delivers one URL and its sha256. Every clause opens for review. No delivery by the deadline refunds the buyer.", ""],
  ["Dispute by citation", "The buyer disputes a clause by id, with a 10% bond, and may point at a location in the work. An id not in the spec is refused: no model, bond back.", "hot"],
  ["The jury rules", "A separate jury contract fetches the work, checks its digest, and answers one question from the clause and the work alone.", ""],
  ["The escrow applies it", "After an appeal window, anyone applies the ruling. It is the only time the escrow reads the jury.", ""],
  ["Clocks and withdraw", "Undisputed clauses pay, unruled disputes lapse to the seller, work nobody could fetch refunds the buyer, undelivered work refunds. withdraw sends what each party is owed.", ""],
];

/** Deals opened on the selected network, read live from the contract. */
function useDealCount() {
  const { client, clause, network } = useApp();
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setN(null);
    if (!clause) return;
    // Every deal on Clause here, the previous release's included.
    readStatus(client, clause)
      .then((s) => live && setN(appDealId(network, s.deals)))
      .catch(() => live && setN(null));
    return () => {
      live = false;
    };
  }, [client, clause, network]);
  return n;
}

export function Home() {
  const deals = useDealCount();
  return (
    <>
      <section className="wrap hero marks">
        <div className="hero-grid">
          <div>
            <span className="kicker live">
              <span>
                Deals on GenLayer <b>{deals === null ? "…" : deals.toLocaleString()}</b>
              </span>
            </span>
            <h1 className="display">
              Escrow that pays on the spec you <em>wrote.</em>
            </h1>
            <p className="tagline">Disputes by citation.</p>
            <p className="lede">
              A dispute must cite a clause from the spec, so{" "}
              <strong>a requirement added after the deal never reaches the jury.</strong> The jury reads the clause and the
              work, never the complaint.
            </p>
            <div className="row">
              <a className="btn primary lg" href={href({ name: "new" })}>Fund a deal</a>
              <a className="btn lg" href={href({ name: "docs", page: "introduction" })}>Read the docs</a>
            </div>
          </div>

          <div className="console scan" aria-label="Example: a dispute citing a clause the spec never had">
            <div className="console-head">
              <span className="kicker">Case 1a <b>capitals</b></span>
              <span className="status-chip">Refused</span>
            </div>
            <div className="console-body">
              <ol className="rail">
                <li className="on">
                  <span className="n">Step 01</span>
                  <h3>The spec is pinned</h3>
                  <p>One clause, cities: “contains exactly 3 city names”. Nothing about capitals.</p>
                </li>
                <li className="on">
                  <span className="n">Step 02</span>
                  <h3>The buyer cites “capitals”</h3>
                  <p>There is no such clause. The dispute is refused and recorded, and the bond is credited back.</p>
                </li>
                <li>
                  <span className="n">Step 03</span>
                  <h3>No model runs</h3>
                  <p>Measured on Studio and Bradbury. This guarantee does not depend on a jury at all.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-line">
            <span className="v">0</span>
            <span className="k">Model calls<small>for a clause not in the spec</small></span>
          </div>
          <div className="stat-line">
            <span className="v">2</span>
            <span className="k">Contracts<small>the escrow pays without the jury</small></span>
          </div>
          <div className="stat-line">
            <span className="v">0</span>
            <span className="k">Words of the complaint<small>shown to the jury</small></span>
          </div>
        </div>
      </section>

      <section className="night">
        <div className="wrap section marks">
          <span className="kicker">The rules</span>
          <h2 className="h2">
            Three rules to a fair <em>payout.</em>
          </h2>
          <p className="lede" style={{ marginBottom: 36 }}>
            None of them is a policy someone enforces later. Each is code in a GenLayer Intelligent Contract.
          </p>
          <div className="panels">
            <div className="panel">
              <div className="idx">01<small>Pin</small></div>
              <h3>The spec is pinned with the money</h3>
              <p>Each clause has an amount and an acceptance test someone could check. A test that leans on taste is refused at funding.</p>
            </div>
            <div className="panel">
              <div className="idx">02<small>Cite</small></div>
              <h3>A dispute must cite a clause</h3>
              <p>The buyer disputes one clause by its id, with a bond. A requirement that is not in the spec has nowhere to go.</p>
            </div>
            <div className="panel aurora">
              <div className="idx">03<small>Rule</small></div>
              <h3>The jury reads the clause, not the complaint</h3>
              <p>Validators answer one question about the clause and the work. The buyer may point at where to look, never argue.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section marks">
        <span className="kicker">The flow</span>
        <h2 className="h2">
          Inside a <em>dispute.</em>
        </h2>
        <p className="lede" style={{ marginBottom: 36 }}>
          From funding to withdrawal. The money and the jury are separate contracts, and the escrow reads the jury in one place.
        </p>
        <div className="flow three">
          {FLOW.map(([t, d, hot], i) => (
            <div key={t} className={`flow-card ${hot}`}>
              <h3>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                {t}
              </h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section rule-top marks">
        <h2 className="h2">
          The jury can be wrong.
          <br />
          The money <em>still moves.</em>
        </h2>
        <p className="lede" style={{ marginBottom: 36 }}>
          An appeal on GenLayer has been measured to leave a contract unreadable. So the escrow never runs the jury, and
          nothing that pays depends on reading it.
        </p>
        <div className="grid-2">
          <div className="feature-orange">
            <div className="halftone" aria-hidden="true" />
            <div className="bar">
              <span>01 / Split contracts</span>
              <span>// The escrow</span>
            </div>
            <h3>Settle and withdraw never read the jury.</h3>
            <p>
              The jury records a ruling. The escrow applies it after an appeal window. If the jury contract goes dark, the
              dispute lapses on the escrow's own clock and the GEN is paid.
            </p>
            <div className="foot">
              <b>1</b>
              <span>place the escrow reads the jury</span>
            </div>
          </div>
          <div className="flow-card">
            <span className="kicker">02 / Fetching <b>the work</b></span>
            <h3 style={{ marginTop: 22 }}>A missing file is not a failed test.</h3>
            <p>Each validator fetches the work itself, and only a definite answer from the server is held against the seller:</p>
            <ul>
              <li>bytes that differ from the digest: unmet, no model</li>
              <li>a 404: unmet, no model</li>
              <li>no answer, three rounds running: refunded to the buyer</li>
              <li>the right bytes: the jury reads them</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="wrap section rule-top marks">
        <span className="kicker">The record</span>
        <h2 className="h2">
          What has been shown, <em>and what hasn't.</em>
        </h2>
        <p className="lede" style={{ marginBottom: 28 }}>
          Real transactions on GenLayer Studio and the Bradbury testnet, every verdict published. The jury sample is small,
          and a test that can honestly be read two ways has not been run yet. It is the first item on the roadmap.
        </p>
        <div className="cases">
          {CASES.map(([n, q, v, a]) => (
            <div className="case" key={n}>
              <span className="n">// {n}</span>
              <span className="q">{q}</span>
              <span className="a">
                <b>{v}</b>
                {a}
              </span>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 24 }}>
          <a className="btn" href={href({ name: "docs", page: "introduction" })}>Every case, in the docs</a>
        </p>
      </section>

      <section className="night">
        <div className="wrap section marks cta-band">
          <div>
            <span className="kicker">Start</span>
            <h2 className="h2" style={{ marginBottom: 0 }}>
              Write the spec. <em>Lock the money.</em>
            </h2>
          </div>
          <div className="row">
            <a className="btn primary lg" href={href({ name: "new" })}>Fund a deal</a>
            <a className="btn lg on-night" href={href({ name: "deals" })}>See the deals</a>
          </div>
        </div>
      </section>
    </>
  );
}
