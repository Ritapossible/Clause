import { href } from "../state";

export function How() {
  return (
    <div className="wrap prose" style={{ paddingTop: 36, paddingBottom: 56, maxWidth: 820 }}>
      <h1 className="page-title">How Clause works</h1>
      <h2>1. Fund</h2>
      <p>
        The buyer names a seller and writes the spec as clauses - an id, what is asked, an acceptance test and an amount - and
        sends exactly the sum. The contract refuses a spec whose tests cannot be checked (no number, no quoted value, no
        structure, or a taste word like “good”), refunding what was sent. Once funded, the spec is pinned: its sha256 is on
        the deal and no clause can change.
      </p>
      <h2>2. Deliver</h2>
      <p>
        The seller delivers one URL and its sha256 before the delivery deadline. Every clause opens for review. If nothing is
        delivered in time, every clause refunds the buyer.
      </p>
      <h2>3. Review, and dispute only by citation</h2>
      <p>
        Inside a clause's review window the buyer may dispute it, citing its id and posting a bond (10% of the clause, never
        less than the floor). A dispute citing an id that is not in the spec, or late, or under-bonded, is refused and
        recorded: no jury, the bond credited back. A clause nobody disputes pays the seller when its window closes.
      </p>
      <h2>4. The jury</h2>
      <p>
        Anyone may convene the jury on a disputed clause. Each GenLayer validator fetches the work, checks it against the
        pinned digest, and answers one question from the clause and the work alone - <i>does the delivered work fail this
        clause as written?</i> - as <code>fails</code>, <code>satisfies</code> or <code>cannot_tell</code>. The buyer's dispute text
        is never in the prompt. Work that is not at its digest cannot meet a clause.
      </p>
      <ul>
        <li><b>Unmet</b> (a confident fail): the clause is kept for the buyer, the bond comes back, and the seller may redeliver once.</li>
        <li><b>Met</b>: the clause pays the seller, with the bond - a dispute against work that met the clause cost the seller a wait.</li>
        <li><b>Undetermined</b> (a hesitant fail, or a genuine ambiguity): the clause pays the seller; the bond comes back.</li>
      </ul>
      <p>
        Validators fail closed toward paying the seller, because the buyer carries the burden: an unmet ruling stands only if
        a validator re-answering the question also finds the clause unmet. The round is decided by a majority of validators.
      </p>
      <h2>5. Every deadline is arithmetic</h2>
      <p>
        <code>settle</code> - callable by anyone - applies every clock that has run out: undelivered work refunds, closed review
        windows pay, an unruled dispute pays the seller at its ruling deadline with the bond returned, an unmet clause
        nobody redelivered refunds. None of it needs a jury or another contract, so the escrow always resolves.
      </p>
      <h2>6. Withdraw</h2>
      <p>
        Rulings and deadlines credit what each party is owed; <code>withdraw</code> sends it. A ruling never depends on a
        transfer succeeding.
      </p>
      <p><a className="btn primary" href={href({ name: "new" })}>Fund a deal</a></p>
    </div>
  );
}
