"""Clause escrow: paid per clause, disputed only by citing a pinned clause.

Built by ``deploy/build_contract.py`` into ``contracts/build/clause.py`` (and
``clause.min.py``, the bytes deployed). Do not edit the build.

One contract holds every deal's GEN, credits and clocks. It never runs a
model. The jury is a separate contract (``jury_shell.py``): it reads a
disputed clause from here and records a ruling there, and ``apply_ruling``
pulls that ruling once it is ``appeal_seconds`` old. That pull is the only
place this contract reads the jury. ``settle`` and ``withdraw`` never do, so
if the jury contract is appealed into an unreadable state (measured on
Studio), every clock here still pays or refunds and every credit still sends.

**Money.** The buyer funds a deal with exactly the sum of its clause amounts.
A payable call never reverts once value has arrived: measured on Studio, the
value sent with a call that reverts stays in the contract, so a refused
funding or a refused dispute is recorded instead and its value is credited
straight back to the sender (``_refuse``). Rulings and deadlines *credit*
the party owed (``owed``); only ``withdraw`` sends GEN.
"""


@gl.evm.contract_interface
class _Payee:
    """Any address, as a value recipient. Value to a wallet goes through an
    EVM contract interface; ``gl.get_contract_at(wallet)`` is for Intelligent
    Contracts and does not credit a wallet."""

    class View:
        pass

    class Write:
        pass


class Clause(gl.Contract):
    release: str
    jury: str
    appeal_seconds: u256
    bond_floor: u256
    deal_count: u256
    deals: TreeMap[u256, str]
    owed: TreeMap[str, u256]
    owed_total: u256
    held: u256
    refusals: TreeMap[str, str]

    def __init__(self, jury: str, bond_floor: int, appeal_seconds: int):
        if int(bond_floor) <= 0:
            raise Exception("[EXPECTED] the bond floor must be positive")
        if int(appeal_seconds) < 0 or int(appeal_seconds) > MAX_WINDOW:
            raise Exception("[EXPECTED] the appeal window is 0-%d seconds" % MAX_WINDOW)
        self.release = "clause/3"
        self.jury = normalize_address(jury, "jury")
        self.appeal_seconds = u256(int(appeal_seconds))
        self.bond_floor = u256(int(bond_floor))
        self.deal_count = u256(0)
        self.owed_total = u256(0)
        self.held = u256(0)

    # -------------------------------------------------------------- helpers

    def _now(self) -> int:
        return int(datetime.datetime.now().timestamp())

    def _load(self, deal_id: int) -> dict:
        if int(deal_id) < 0 or int(deal_id) >= int(self.deal_count):
            raise Exception("[EXPECTED] unknown deal")
        return json.loads(self.deals[u256(int(deal_id))])

    def _save(self, deal: dict) -> None:
        self.deals[u256(int(deal["id"]))] = json.dumps(deal)

    def _pay(self, credits: dict) -> None:
        """Move credited GEN from held escrow to what each party is owed."""
        total = 0
        for who, amount in credits.items():
            key = str(who).lower()
            self.owed[key] = u256(int(self.owed.get(key, u256(0))) + int(amount))
            total += int(amount)
        self.held = u256(int(self.held) - total)
        self.owed_total = u256(int(self.owed_total) + total)

    def _me(self) -> str:
        return str(gl.message.sender_address).lower()

    def _refuse(self, reason: str, value: int) -> None:
        """Refuse a payable call without reverting: record why, and credit
        the value it carried back to the sender, to withdraw like any credit."""
        me = self._me()
        if value > 0:
            self.owed[me] = u256(int(self.owed.get(me, u256(0))) + value)
            self.owed_total = u256(int(self.owed_total) + value)
        self.refusals[me] = json.dumps({"reason": str(reason)[:600], "at": self._now(), "returned": value})

    # ---------------------------------------------------------- entrypoints

    @gl.public.write.payable
    def create_deal(
        self,
        seller: str,
        clauses_json: str,
        delivery_seconds: int,
        review_seconds: int,
        redelivery_seconds: int,
        ruling_seconds: int,
    ) -> int:
        """The buyer funds an escrow against a pinned spec. The GEN sent must
        equal the sum of the clause amounts, and every acceptance test must be
        checkable (``acceptance_test_error``). Returns the deal id, or -1 when
        refused - the value is then credited back and ``refusal_of`` says why."""
        value = int(gl.message.value)
        try:
            clauses = json.loads(str(clauses_json))
        except Exception:
            clauses = None
        timing = {
            "delivery_seconds": int(delivery_seconds),
            "review_seconds": int(review_seconds),
            "redelivery_seconds": int(redelivery_seconds),
            "ruling_seconds": int(ruling_seconds),
        }
        errors = ["the spec is not valid JSON"] if clauses is None else spec_errors(
            clauses, value=value, timing=timing, buyer=self._me(), seller=str(seller)
        )
        if errors:
            self._refuse("; ".join(errors), value)
            return -1
        deal_id = int(self.deal_count)
        deal = open_deal(deal_id=deal_id, buyer=self._me(), seller=str(seller), clauses=clauses, timing=timing, now=self._now())
        self._save(deal)
        self.deal_count = u256(deal_id + 1)
        self.held = u256(int(self.held) + value)
        return deal_id

    @gl.public.write
    def deliver(self, deal_id: int, uri: str, digest: str) -> None:
        """The seller delivers one artifact for the deal, pinned by sha256 -
        or redelivers for clauses the jury found unmet."""
        deal = self._load(deal_id)
        if self._me() != deal["seller"]:
            raise Exception("[EXPECTED] only the seller may deliver")
        try:
            deliver(deal, uri=str(uri), digest=str(digest), now=self._now())
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        self._save(deal)

    @gl.public.write.payable
    def dispute(self, deal_id: int, clause_id: str, text: str, locate: str) -> None:
        """The buyer disputes one clause, citing its id from the pinned spec,
        inside its review window, posting the bond as the value of this call.
        ``text`` is kept for people and never shown to the jury. ``locate``
        ("" or a byte span or JSON pointer) shows the jury where to look. A
        dispute that cites no clause of the spec, or is late, under-bonded or
        badly located, is refused: it is recorded on the deal, no jury runs,
        and the bond is credited back. An accepted dispute convenes the jury
        itself."""
        bond = int(gl.message.value)
        if int(deal_id) < 0 or int(deal_id) >= int(self.deal_count):
            self._refuse("unknown deal", bond)
            return
        deal = json.loads(self.deals[u256(int(deal_id))])
        try:
            open_dispute(
                deal, clause_id=str(clause_id), by=self._me(), text=str(text), bond=bond,
                floor=int(self.bond_floor), now=self._now(), locate=str(locate),
            )
        except ClauseError as exc:
            # No jury, no state change: the dispute is refused and its bond
            # goes back. This is where a complaint about a requirement that is
            # not in the pinned spec ends.
            self._refuse(str(exc), bond)
            refused = deal.get("refused", [])
            refused.append({"cited": str(clause_id)[:40], "reason": str(exc)[:300], "at": self._now()})
            deal["refused"] = refused[-10:]
            self._save(deal)
            return
        self._save(deal)
        self.held = u256(int(self.held) + bond)
        # Every dispute gets a jury round: convened here, as a message the
        # jury runs once this call is accepted. So the work is always fetched
        # at least once - a round that cannot fetch it is recorded and the
        # clause can no longer pay the seller - even if nobody convenes the
        # jury by hand. A message is not a read: if the jury contract fails,
        # only the message fails, and every clock here still runs.
        gl.get_contract_at(Address(self.jury)).emit(on="accepted").rule(str(self.address).lower(), int(deal_id), str(clause_id))

    @gl.public.write
    def apply_ruling(self, deal_id: int, clause_id: str) -> None:
        """Apply the jury contract's ruling on a disputed clause, once it is
        ``appeal_seconds`` old. Anyone may call it. The only read of the jury.
        A record that the work could not be fetched is noted at once."""
        deal = self._load(deal_id)
        try:
            line = find_line(deal, str(clause_id))
            raw = gl.get_contract_at(Address(self.jury)).view().ruling_of(str(self.address).lower(), int(deal_id), str(clause_id))
            ruling = json.loads(str(raw))
            verdict = accept_ruling(line, ruling, now=self._now(), appeal_seconds=int(self.appeal_seconds))
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        if verdict == "":
            # Rounds that could not fetch the work, noted on the line: from
            # now on its deadline refunds the buyer instead of paying the seller.
            line["artifact"] = ARTIFACT_UNREAD
            self._save(deal)
            return
        credits = apply_ruling(
            line, verdict=verdict, buyer=deal["buyer"], seller=deal["seller"], now=self._now(),
            redelivery_seconds=int(deal["timing"]["redelivery_seconds"]),
        )
        line["verdict"] = verdict
        line["reason"] = str(ruling.get("reason", ""))[:48]
        line["confidence"] = int(ruling.get("confidence", 0))
        line["artifact"] = str(ruling.get("artifact", ""))
        line["ruled_at"] = int(ruling["at"])
        self._save(deal)
        self._pay(credits)

    @gl.public.write
    def note_unread(self, deal_id: int, clause_id: str, round_id: str, count: int, at: int) -> None:
        """Sent by the jury contract after a round that could not fetch the
        work. Noted on the clause, so its deadline refunds the buyer instead
        of paying the seller. Only this escrow's jury may send it."""
        if self._me() != self.jury:
            raise Exception("[EXPECTED] only the jury contract notes an unread round")
        deal = self._load(deal_id)
        try:
            line = find_line(deal, str(clause_id))
            accept_ruling(line, {"round": str(round_id), "unread": int(count), "at": int(at)}, now=self._now(),
                          appeal_seconds=int(self.appeal_seconds))
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        line["artifact"] = ARTIFACT_UNREAD
        self._save(deal)

    @gl.public.write
    def settle(self, deal_id: int) -> None:
        """Apply every deadline that has passed. Anyone may call it; it needs
        no jury and no other contract, so the escrow always resolves."""
        deal = self._load(deal_id)
        credits = apply_deadlines(deal, self._now(), int(self.appeal_seconds))
        self._save(deal)
        self._pay(credits)

    @gl.public.write
    def withdraw(self) -> None:
        """Send the caller everything it is owed."""
        me = self._me()
        amount = int(self.owed.get(me, u256(0)))
        if amount <= 0:
            raise Exception("[EXPECTED] nothing is owed to this address")
        self.owed[me] = u256(0)
        self.owed_total = u256(int(self.owed_total) - amount)
        _Payee(gl.message.sender_address).emit_transfer(value=u256(amount))

    # ---------------------------------------------------------------- views

    @gl.public.view
    def get_deal(self, deal_id: int) -> str:
        deal = self._load(deal_id)
        deal["now"] = self._now()
        return json.dumps(deal)

    @gl.public.view
    def refusal_of(self, address: str) -> str:
        """Why the address's last payable call was refused, if it was."""
        return self.refusals.get(str(address).lower(), "{}")

    @gl.public.view
    def owed_to(self, address: str) -> int:
        return int(self.owed.get(str(address).lower(), u256(0)))

    @gl.public.view
    def bond_for(self, deal_id: int, clause_id: str) -> int:
        """The bond a dispute on this clause must post."""
        deal = self._load(deal_id)
        return dispute_bond(int(find_line(deal, str(clause_id))["amount"]), int(self.bond_floor))

    @gl.public.view
    def status(self) -> str:
        return json.dumps(
            {
                "release": self.release,
                "jury": self.jury,
                "appeal_seconds": int(self.appeal_seconds),
                "deals": int(self.deal_count),
                "held": int(self.held),
                "owed": int(self.owed_total),
                "balance": int(self.balance),
                "bond_floor": int(self.bond_floor),
            }
        )
