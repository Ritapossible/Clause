import { href } from "../state";

const STEPS: { t: string; hot?: boolean; body: JSX.Element }[] = [
  {
    t: "Fund",
    body: (
      <p>
        The buyer names a seller and writes the spec as clauses (an id, what is asked, an acceptance test and an amount) and
        sends exactly the sum. The contract refuses a spec whose tests cannot be checked (no number, no quoted value, no
        structure, or a taste word like “good”) and credits back what was sent. Once funded, the spec is pinned: its sha256
        is on the deal and no clause can change.
      </p>
    ),
  },
  {
    t: "Deliver",
    body: (
      <p>
        The seller delivers one URL and its sha256 before the delivery deadline. Every clause opens for review. If nothing is
        delivered in time, every clause refunds the buyer.
      </p>
    ),
  },
  {
    t: "Review, and dispute only by citation",
    body: (
      <p>
        Inside a clause's review window the buyer may dispute it, citing its id and posting a bond (10% of the clause, never
        less than the floor). A dispute citing an id that is not in the spec, or late, or under-bonded, is refused and
        recorded: no jury, the bond credited back. A clause nobody disputes pays the seller when its window closes. If the
        problem is deep in the work, the buyer may point at it with a location (a byte span or a JSON pointer); the jury
        sees those bytes, never the buyer's words.
      </p>
    ),
  },
  {
    t: "The jury",
    hot: true,
    body: (
      <>
        <p>
          Anyone may convene the jury on a disputed clause. The jury is its own contract: each GenLayer validator fetches the
          work, checks it against the pinned digest, and answers one question from the clause and the work alone: <i>does
          the delivered work fail this clause, as written?</i> The buyer's dispute text is never in the prompt. Work changed
          or removed from its URL is unmet; work nobody could fetch is no ruling at all.
        </p>
        <p>
          The ruling is recorded on the jury contract. After an appeal window, anyone applies it to the escrow. That is the
          only time the escrow reads the jury, so the escrow's clocks pay even if the jury contract becomes unreadable.
        </p>
        <ul>
          <li><b>Unmet</b> (a confident fail): the clause is kept for the buyer, the bond comes back, and the seller may redeliver once.</li>
          <li><b>Met</b>: the clause pays the seller, with the bond.</li>
          <li><b>Undetermined</b> (a hesitant fail, or a real ambiguity): the clause pays the seller and the bond comes back.</li>
        </ul>
        <p>
          Validators fail closed toward paying the seller, because the buyer carries the burden: an unmet ruling stands only
          if a validator re-answering the question also finds the clause unmet. A majority of validators decides the round.
        </p>
      </>
    ),
  },
  {
    t: "Every deadline is arithmetic",
    body: (
      <p>
        <code>settle</code>, callable by anyone, applies every clock that has run out: undelivered work refunds, closed review
        windows pay, a dispute with no ruling applied pays the seller after its ruling deadline and appeal window with the
        bond returned, and an unmet clause nobody redelivered refunds. None of it reads the jury or any other contract, so
        the escrow always resolves.
      </p>
    ),
  },
  {
    t: "Withdraw",
    body: (
      <p>
        Rulings and deadlines credit what each party is owed; <code>withdraw</code> sends it. A ruling never depends on a
        transfer succeeding.
      </p>
    ),
  },
];

export function How() {
  return (
    <div className="wrap section marks" style={{ paddingTop: 48 }}>
      <span className="kicker">How it works</span>
      <h1 className="page-title">
        From funding to <em>withdrawal.</em>
      </h1>
      <p className="lede" style={{ marginBottom: 36 }}>
        Six steps across two GenLayer Intelligent Contracts: an escrow that holds the money and a jury that holds nothing.
        The jury appears in exactly one step. The full docs cover every rule.
      </p>
      <div className="flow" style={{ gridTemplateColumns: "minmax(0, 1fr)", maxWidth: 860 }}>
        {STEPS.map((s, i) => (
          <div key={s.t} className={`flow-card${s.hot ? " hot" : ""}`}>
            <h3>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              {s.t}
            </h3>
            {s.body}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 32 }}>
        <a className="btn primary lg" href={href({ name: "new" })}>Fund a deal</a>
      </p>
    </div>
  );
}
