# Clause - Architecture

## The question

A spec is a list of clauses, pinned when the escrow is funded. The seller
delivers one artifact. For a disputed clause the jury answers one thing:

> Does the delivered work fail this clause, as written?

It sees the clause (what was asked and its acceptance test) and the work - and
nothing the buyer wrote. That is the product. A dispute contributes only *which
clause* to check; it has no way to add a requirement, re-read a clause, or
instruct the jury.

## Lifecycle of a clause

```
create_deal (buyer, payable: exactly the sum of the clause amounts)
   every acceptance test must be checkable, or the funding is refused and
   the GEN credited back
        |
     FUNDED ----------- no delivery by deliver_by ----------> REFUNDED
        |
   deliver (seller: one URL + sha256)
        |
    IN_REVIEW --------- review window closes, no dispute ---> RELEASED
        |
   dispute (buyer, payable: the bond; must cite this clause's id)
   a dispute citing an id not in the spec is refused: recorded, no jury,
   bond credited back
        |
    DISPUTED ---------- no ruling by rule_by (lapse) -------> RELEASED, bond back
        |
   rule (anyone): the jury
        |
        +-- met ----------------------------------------------> RELEASED, bond to seller
        +-- undetermined -------------------------------------> RELEASED, bond back
        +-- unmet --> FAILED, bond back
                        |
                        +-- redeliver by redeliver_by --> IN_REVIEW (only this clause)
                        +-- no redelivery ----------------> REFUNDED
```

`settle(deal_id)` - callable by anyone - applies every arrow labelled with a
deadline. It is arithmetic over the deal record: no jury, no other contract,
no transfer. Each clause of a deal is independent: one broken clause does not
hold the rest.

## Money: credit, then withdraw

Rulings and deadlines never move value. They credit what each party is owed
(`owed[address]`), and `withdraw()` sends it. So a ruling can never fail
because a transfer failed, and a party that is owed money can always take it
in a separate, simple transaction. The pattern follows Recourse's
settlement design.

Value goes to a wallet through an EVM contract interface
(`@gl.evm.contract_interface` then `.emit_transfer(value=...)`); measured on
Studio and Bradbury, the wallet is credited when the transaction finalises.
`gl.get_contract_at(wallet).emit_transfer` treats a wallet as an Intelligent
Contract and credits nothing; it is not used.

The contract's books always balance: `balance == held + owed`, where `held` is
every line not yet resolved plus every open bond. The scenario scripts check it
on chain.

### A payable call never reverts once value has arrived

Measured on Studio: the GEN sent with a call that reverts **stays in the
contract**. A payable entrypoint that raised would swallow the payment. So
`create_deal` and `dispute` refuse without reverting: they record why
(`refusal_of(address)`, and on the deal for a dispute) and credit the value
back to the sender. `tests/direct/test_built.py` holds both entrypoints to
containing no `raise`.

## The jury

```python
leader():    fetch the work; sha256 must equal the pinned digest
             unverified  -> {"verdict": "unmet", "artifact": "unverified"}   # no model call
             verified    -> exec_prompt(build_prompt(criterion, test, work), json)
                            -> reading (fails | satisfies | cannot_tell) -> verdict
validator(): fetch and hash again; the artifact state must match exactly;
             re-answer the same question; accept by jury_agrees
```

- **The model reads; the contract rules.** The model returns a reading, a
  reason code and a confidence. `reading_to_verdict` maps it: `fails` with
  confidence 60 or more is `unmet`; a hesitant `fails` and `cannot_tell` are
  `undetermined`; `satisfies` is `met`. An unreadable answer is
  `undetermined` - it never keeps money from the seller.
- **Fail closed toward paying the seller.** The buyer carries the burden of a
  dispute. `jury_agrees`: the same verdict agrees; `unmet` stands only on
  agreement; a validator that is itself sure the clause failed vetoes a release
  (the round fails, and if no ruling lands by `rule_by` the clause releases
  anyway); `met` and `undetermined` both release, so they agree.
- **Rule per vote, decided by majority.** Each validator votes with that rule;
  GenLayer accepts the leader's answer when a majority agree.
- **Work nobody can read cannot meet a clause.** The seller keeps the work at
  the digest it pinned. If the bytes are missing or different, every validator
  sees it, and the clause is `unmet` without a model call.
- **The fetch is inline in both closures**, and every value the closures
  capture is a plain Python value (a storage proxy does not survive into the
  validator's sandbox).

## What the jury is told

`contracts/clause_prompts.py`, `build_prompt(criterion, test, artifact_text)` -
the only three inputs, which is why the dispute text cannot reach it. The
delivered work is labelled untrusted, its structure-shaped text is disarmed
(`neutralize`), and the instruction is to check only what the acceptance test
states, in its ordinary sense, without adding requirements or judging taste.

## The checkability gate

An acceptance test is funded only if it names something a reader can check:
a digit, a quoted value, or a structural word (key, section, words, JSON,
items, ...), and only if it contains no taste word (good, professional,
quality, ...). `acceptance_test_error` in `clause_core.py`; the app runs the
same rule in the browser (`frontend/src/lib/spec.ts`), held to the engine's
answers by `frontend/scripts/parity.ts`. It is a heuristic and stated as one in
the threat model.

## One contract

Every deal lives in one `Clause` contract, each as a JSON record. That keeps
the product to one address to verify and one to integrate, at a cost:
transactions on one Intelligent Contract execute in order, so a jury round on
one deal delays the next transaction on another by the length of the round
(about 20 seconds on Studio, minutes on Bradbury).

## Build

```
contracts/clause_core.py     every rule that needs no model; pure Python
contracts/clause_prompts.py  the jury's question, and how its answer is read
contracts/contract_shell.py  storage, entrypoints, the consensus block
        |
        +-- deploy/build_contract.py --> contracts/build/clause.py      (readable, tested)
                                     --> contracts/build/clause.min.py  (deployed)
```

Bradbury caps a transaction at 2^24 gas and a deploy costs about 0.96M gas
plus 782 per byte, so the deployed file must stay under about 19.5 KB. It is
18,983 bytes. The minifier strips docstrings and comments, drops unreachable
definitions and shortens names; `tests/direct/test_scenarios.py` runs the
readable and the minified file side by side in a GenVM stand-in and requires
identical results, so the renaming is proven by execution.

The runner is pinned: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`,
the header followed immediately by code.
