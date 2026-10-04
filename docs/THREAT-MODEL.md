# Threat model

Each entry gives the attack, what stops it, the test that would fail without
it, and what is left. "Measured" means a recorded transaction in
`deploy/*.json`.

## T1 - The buyer invents a requirement after delivery

**Attack.** The work meets the spec; the buyer disputes it for something the
spec never said ("the cities must be capitals").

**Stops it.** A dispute must cite a clause id from the pinned spec. Citing one
that is not there is refused before any model runs: the refusal is recorded
on the deal, no jury is convened, and the bond is credited back
(`find_line`, `open_dispute`).

**Test.** `test_a_dispute_must_cite_a_clause_in_the_pinned_spec`; mutant
`uncited-dispute-allowed`. Measured: case 1a on both networks.

**This is the strongest claim Clause makes.** It does not depend on a model at
all.

## T2 - The buyer re-reads a real clause

**Attack.** The buyer cites the real clause and argues a new reading of it in
the dispute text.

**Stops it.** The jury never sees the dispute text. `build_prompt` takes only
the criterion, the acceptance test, the work and an optional slice of the
same work, and tells the model to read the test in its ordinary sense and add
nothing to it.

**Test.** `test_the_prompt_has_no_place_for_the_buyers_dispute_text`,
`test_the_jury_never_sees_the_dispute_text`; mutant `dispute-text-to-jury`.
Measured: cases 1b and 3.

**Left.** Cases 1b and 3 show that the complaint never arrives. They do not
show that the jury judges well: on a list of three names against "exactly 3",
a model only has to count. A test that can honestly be read two ways can be
read either way by the jury, whoever argues it. The checkability gate (T7)
narrows that, but does not close it.

## T3 - The seller's work instructs the jury

**Attack.** The delivered work contains text shaped like the prompt: a fake
`=== YOUR ANSWER ===` block with `satisfies`, or prose that asserts the work
is correct ("the total below is correct").

**Stops it.** The work is labelled untrusted, its headings and block markers
are broken up (`neutralize`), and each validator answers the question
itself.

**Test.** `test_the_delivered_work_cannot_forge_structure`; mutant
`work-not-neutralized`. Measured: case 5 (a forged answer block) and case 8,
an invoice whose note says the total is correct while its numbers do not add
up.

## T4 - The seller changes or removes the work after delivering

**Stops it.** The delivery pins a sha256. During a ruling, every validator
fetches the URL itself:

| What the server says | Artifact | Ruling |
| --- | --- | --- |
| 2xx, the bytes match the digest | `verified` | The model reads the work |
| 2xx, the bytes differ | `changed` | Unmet, no model call |
| 404 or 410 | `missing` | Unmet, no model call |

**Test.** `test_case_5_work_changed_or_removed_is_unmet_work_unreachable_is_no_ruling`;
mutant `changed-work-judged`. Measured: case 6, a 404, on both networks.

## T5 - A flaky fetch decides a clause

**Attack (or accident).** The host blinks while the jury runs. Under the old
rule, validators who all failed to fetch agreed on "unmet", while validators
who failed differently disagreed, and the clause then paid at its deadline.
The same missing file ended two opposite ways.

**Stops it.** No answer from the server (an exception, a 5xx, a 429) is not a
verdict on anyone. The jury contract refuses the call and records nothing.
Anyone can convene the jury again before the ruling deadline, and if nothing
lands, the clause pays the seller. The behaviour was measured first: on
Studio, a 404 returns a status and an unreachable host raises
(`deploy/probes/probe-web-studio.json`).

**Test.** The same scenario test, case 5c; mutant `unread-is-a-verdict`.
Measured: case 7, an unreachable host, on both networks.

**Left.** A seller could take a host offline (rather than deleting the file)
for the whole ruling window, and be paid at the deadline. A 404 does not
help them; a dead host does. Pinning to content-addressed storage
(roadmap 1.4) closes most of this.

## T6 - The buyer disputes everything to delay payment

**Stops it.**

- Every dispute posts a bond: 10% of the clause, never below the floor. It is
  forfeited to the seller when the clause is met.
- A clause can be disputed once per delivery, and ruled once per dispute.
- A dispute that is not ruled and applied in time releases to the seller.

**Test.** `test_met_releases_the_line_and_forfeits_the_bond_to_the_seller`,
`test_a_dispute_nobody_rules_lapses_to_the_seller_with_the_bond_returned`;
mutants `met-bond-returned`, `cheap-dispute`, `dispute-never-lapses`,
`ruled-twice`.

## T7 - "Do good work"

**Attack.** A spec vague enough that every delivery can be rejected.

**Stops it.** A clause is funded only if its acceptance test names something
checkable (a digit, a quoted value or a structural word) and contains no
taste word. Otherwise funding is refused and the GEN credited back.

**Test.** `test_untestable_acceptance_tests_get_no_clause`; mutants
`vague-test-funded`, `anchorless-test-funded`.

**Left.** It is a word-level heuristic. "Contains 3 relevant sections" passes
it, and "relevant" is still a judgement. The gate stops the empty specs; it
cannot make every sentence precise.

## T8 - The jury is wrong

**Stops it, partly.**

- Each validator re-answers the question from the work it fetched.
- `unmet` stands only on agreement, and a hesitant fail is undetermined and
  releases.
- GenLayer decides the round by majority, so one dissenting validator is not
  a veto.
- A wrong `met` pays the seller. A wrong `unmet` gives the seller one
  redelivery before the buyer is refunded.

**Measured.** Every jury verdict recorded on chain is in
`deploy/scenario-*.json`, including the ones that missed. Case 8 is the one
that needs more than counting: the model has to add four amounts and compare
them with a stated total, while the work's own note says the total is
correct.

- With the first prompt (`clause-jury/1`, `deploy/scenario-studio-jury1.json`)
  the wrong total was caught in **1 of 3** runs. The other two were ruled met
  at confidence 99 and 100.
- The prompt now says what the work says about itself is a claim, not
  evidence, and asks for the calculation before the reading
  (`clause-jury/2`). With it, the wrong total was caught in 3 of 3 runs on
  Studio and 1 of 1 on Bradbury, and the right total was met every time.

Case 8 is the file the prompt was changed to catch, so its 3 of 3 is a fix
for that file, not a rate. Cases 10 and 11 were written after the change and
pre-registered (`examples/HELD-OUT.md`): a timesheet total with an "approved"
note, and a multiplication error in one order line. All 12 runs on Studio came
back as registered. That is still a small sample.

Confidence 100 on a wrong answer is the lesson: the number the model reports
is not a measure of whether it is right.

**Left.** A model can misread a clause. The sample is small and is stated as
small. Roadmap 1.7 is a corpus of hundreds of cases with a published error
rate.

## T9 - The work is longer than the jury reads

**Attack (or accident).** The defect is past the first 4,000 characters, so
the jury cannot see it. Because the complaint is never shown, the buyer
cannot tell the jury where to look.

**Stops it.** A dispute may carry a location: a byte span or a JSON pointer.
Each validator slices those bytes out of the verified work and shows them,
labelled as a location chosen by the buyer, not as an argument. The prompt
also says when the work was cut.

**Test.** `test_a_location_shows_bytes_of_the_work_never_the_buyers_words`,
`test_case_6_a_non_counting_test_and_a_located_defect`; mutants
`pointer-text-shown`, `location-unchecked`. Measured: case 9, a catalog whose
missing price is at byte 5,731.

**Left.**

- A buyer can point at a misleading slice, for example two items of a list
  that has three. The jury still sees the start of the work and is told the
  slice is only where to look, but a slice is a framing.
- A pointer's text is never shown, so it cannot carry words. A byte span is
  shown only as numbers.

## T10 - Value sent with a refused call

**Platform behaviour, measured on Studio.** The GEN sent with a call that
reverts stays in the contract. A payable entrypoint that refused by raising
would keep a buyer's funding or bond.

**Stops it.** `create_deal` and `dispute` never raise once value has arrived:
they record the refusal and credit the value back.

**Test.** `test_a_payable_call_never_reverts_after_value_arrives`,
`test_funding_needs_a_checkable_spec_and_the_exact_amount`; mutants
`refusal-keeps-value`, `refusal-reverts`. Measured: case 1a credits the bond
back, and every run ends with `balance == held + owed`.

## T11 - An appeal freezes the escrow

**Platform behaviour, measured on Studio** (Remit). After an appeal, the
appealed contract was served as "Contract not deployed" at its non-final
state, and a contract that read it in order to pay could not pay.

**Stops it.** The money and the jury are separate contracts. Rulings run on
the jury contract. The escrow reads the jury in one place, `apply_ruling`;
`settle` and `withdraw` never read it. If an appeal makes the jury contract
unreadable, `apply_ruling` fails, the dispute lapses on the escrow's own
clock, and the GEN still moves.

A ruling also waits `appeal_seconds` before the escrow can apply it, so an
appeal has its window before any GEN is credited.

**Test.** `test_case_7_an_unreadable_jury_freezes_nothing` (the jury is
removed mid-dispute), `test_the_escrow_reads_the_jury_in_one_place`; mutants
`ruling-applied-before-appeal-window`, `lapse-skips-appeal-window`.
Measured: `deploy/appeal_scenario.mjs` appeals a real ruling on Studio, then
settles and withdraws (`deploy/appeal-studio.json`).

**Left.**

- If an appeal reverses a ruling after the escrow has applied it, the escrow
  does not follow. The appeal window is sized to finality to make that
  unlikely, not impossible.
- An appeal that leaves the jury unreadable turns a ruling into a lapse,
  which pays the seller.

## T12 - A stale ruling is applied

**Attack.** A ruling from before a redelivery is applied to the new dispute.

**Stops it.** Each dispute has a round. The jury records the round with its
ruling, and the escrow applies only a ruling whose round matches the open
dispute.

**Test.** `test_the_escrow_applies_only_a_timely_ruling_on_this_dispute_after_its_appeal_window`;
mutant `stale-ruling-applied`.

## Out of scope

| Not covered | Why |
| --- | --- |
| Whether the work is *good* | Deliberately. Clause enforces the rules that were written, not taste. |
| Disputes about the clause text itself | The spec is pinned and agreed by funding; the jury applies it. |
| Work that cannot be fetched by URL | The jury reads bytes it can fetch and hash. |
| Partial credit within a clause | A clause pays in full or not at all; split the work into more clauses. |
