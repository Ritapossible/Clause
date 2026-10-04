"""Clause: escrow paid per clause, disputed only by citing a pinned clause.

Built by ``deploy/build_contract.py`` into ``contracts/build/clause.py`` (and
``clause.min.py``, the bytes deployed). Do not edit the build.

One contract holds every deal. A deal is one JSON record (``deals``); every
rule that decides anything is in ``clause_core.py`` and tested there.

**Money.** The buyer funds a deal with exactly the sum of its clause amounts.
Nothing here pays out inside a ruling: a ruling or a deadline *credits* the
party owed (``owed``), and ``withdraw`` sends a party what it is owed. A
ruling therefore never depends on a transfer succeeding, and a deadline never
depends on a ruling: ``settle`` resolves every expired clock by arithmetic.

**The jury.** ``rule`` asks one question about one disputed clause - does the
delivered work fail this clause as written? - with the pinned clause and the
artifact every validator fetched and hash-checked itself. The buyer's dispute
text is stored for people and never reaches the prompt.

Hard rules (see docs/ARCHITECTURE.md):
- The fetch is written inline in both closures; ``genvm-lint`` cannot trace a
  ``gl.nondet.web`` call through a helper.
- Every value a closure captures is a plain Python value.
- ACCEPTED is not success: state is the record.
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
    bond_floor: u256
    deal_count: u256
    deals: TreeMap[u256, str]
    owed: TreeMap[str, u256]
    owed_total: u256
    held: u256

    def __init__(self, bond_floor: int):
        if int(bond_floor) <= 0:
            raise Exception("[EXPECTED] the bond floor must be positive")
        self.release = "clause/1"
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
        checkable (``acceptance_test_error``)."""
        try:
            clauses = json.loads(str(clauses_json))
        except Exception:
            raise Exception("[EXPECTED] the spec is not valid JSON")
        timing = {
            "delivery_seconds": int(delivery_seconds),
            "review_seconds": int(review_seconds),
            "redelivery_seconds": int(redelivery_seconds),
            "ruling_seconds": int(ruling_seconds),
        }
        value = int(gl.message.value)
        errors = spec_errors(clauses, value=value, timing=timing, buyer=self._me(), seller=str(seller))
        if errors:
            raise Exception("[EXPECTED] " + "; ".join(errors))
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
    def dispute(self, deal_id: int, clause_id: str, text: str) -> None:
        """The buyer disputes one clause, citing its id from the pinned spec,
        inside its review window, posting the bond as the value of this call.
        ``text`` is kept for people and never shown to the jury."""
        deal = self._load(deal_id)
        bond = int(gl.message.value)
        try:
            open_dispute(
                deal, clause_id=str(clause_id), by=self._me(), text=str(text), bond=bond,
                floor=int(self.bond_floor), now=self._now(),
            )
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        self._save(deal)
        self.held = u256(int(self.held) + bond)

    @gl.public.write
    def rule(self, deal_id: int, clause_id: str) -> None:
        """Convene the jury on one disputed clause. Anyone may call it."""
        deal = self._load(deal_id)
        try:
            line = find_line(deal, str(clause_id))
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        if line["state"] != LINE_DISPUTED:
            raise Exception("[EXPECTED] clause is not disputed")
        if self._now() > int(line["dispute"]["rule_by"]):
            raise Exception("[EXPECTED] the ruling deadline has passed; settle releases the clause")

        # Plain values only: the validator's closure is pickled into a sandbox
        # where a storage proxy does not survive.
        uri = str(deal["delivery"]["uri"])
        digest = str(deal["delivery"]["digest"])
        criterion = str(line["criterion"])
        test = str(line["test"])

        def leader() -> str:
            _state = ARTIFACT_UNVERIFIED
            _text = ""
            try:
                # INLINE fetch - do not factor this into a helper.
                _raw = gl.nondet.web.get(uri).body
                if isinstance(_raw, str):
                    _raw = _raw.encode("utf-8")
                if _raw is not None and hashlib.sha256(_raw).hexdigest().lower() == digest:
                    _state = ARTIFACT_VERIFIED
                    _text = _raw.decode("utf-8", "replace")
            except Exception:
                _state = ARTIFACT_UNVERIFIED
            if _state != ARTIFACT_VERIFIED:
                # The seller keeps the work available at the digest it pinned;
                # work nobody can read cannot meet a clause.
                return json.dumps({"verdict": VERDICT_UNMET, "reason": "work_unverifiable", "confidence": 100, "artifact": _state})
            _out = read_answer(
                gl.nondet.exec_prompt(build_prompt(criterion=criterion, test=test, artifact_text=_text), response_format="json")
            )
            _out["artifact"] = _state
            return json.dumps(_out)

        def validator(leader_result) -> bool:
            _state = ARTIFACT_UNVERIFIED
            _text = ""
            try:
                # INLINE fetch again - the duplication is deliberate.
                _raw = gl.nondet.web.get(uri).body
                if isinstance(_raw, str):
                    _raw = _raw.encode("utf-8")
                if _raw is not None and hashlib.sha256(_raw).hexdigest().lower() == digest:
                    _state = ARTIFACT_VERIFIED
                    _text = _raw.decode("utf-8", "replace")
            except Exception:
                _state = ARTIFACT_UNVERIFIED
            _theirs = as_dict(leader_result)
            if not _theirs or str(_theirs.get("artifact", "")) != _state:
                return False
            _verdict = str(_theirs.get("verdict", ""))
            if _verdict not in VERDICTS:
                return False
            if _state != ARTIFACT_VERIFIED:
                return _verdict == VERDICT_UNMET
            _mine = read_answer(
                gl.nondet.exec_prompt(build_prompt(criterion=criterion, test=test, artifact_text=_text), response_format="json")
            )
            return jury_agrees(leader_verdict=_verdict, own_verdict=_mine["verdict"])

        decoded = as_dict(gl.vm.run_nondet(leader, validator, compare_user_errors=True))
        verdict = str(decoded.get("verdict", VERDICT_UNDETERMINED))
        if verdict not in VERDICTS:
            verdict = VERDICT_UNDETERMINED
        credits = apply_ruling(
            line, verdict=verdict, buyer=deal["buyer"], seller=deal["seller"], now=self._now(),
            redelivery_seconds=int(deal["timing"]["redelivery_seconds"]),
        )
        line["verdict"] = verdict
        line["reason"] = str(decoded.get("reason", ""))[:48]
        line["confidence"] = int(decoded.get("confidence", 0))
        line["artifact"] = str(decoded.get("artifact", ""))
        self._save(deal)
        self._pay(credits)

    @gl.public.write
    def settle(self, deal_id: int) -> None:
        """Apply every deadline that has passed. Anyone may call it; it needs
        no jury and no other contract, so the escrow always resolves."""
        deal = self._load(deal_id)
        credits = apply_deadlines(deal, self._now())
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
        deal["escrowed"] = escrowed(deal)
        deal["now"] = self._now()
        return json.dumps(deal)

    @gl.public.view
    def owed_to(self, address: str) -> int:
        return int(self.owed.get(str(address).lower(), u256(0)))

    @gl.public.view
    def bond_for(self, deal_id: int, clause_id: str) -> int:
        """The bond a dispute on this clause must post."""
        deal = self._load(deal_id)
        return dispute_bond(int(find_line(deal, str(clause_id))["amount"]), int(self.bond_floor))

    @gl.public.view
    def check_spec(self, clauses_json: str, value: int, buyer: str, seller: str, review_seconds: int) -> str:
        """Every reason a spec could not be funded, before anything is signed."""
        try:
            clauses = json.loads(str(clauses_json))
        except Exception:
            return json.dumps(["the spec is not valid JSON"])
        t = int(review_seconds)
        timing = {"delivery_seconds": t, "review_seconds": t, "redelivery_seconds": t, "ruling_seconds": t}
        return json.dumps(spec_errors(clauses, value=int(value), timing=timing, buyer=str(buyer), seller=str(seller)))

    @gl.public.view
    def status(self) -> str:
        return json.dumps(
            {
                "release": self.release,
                "deals": int(self.deal_count),
                "held": int(self.held),
                "owed": int(self.owed_total),
                "balance": int(self.balance),
                "bond_floor": int(self.bond_floor),
            }
        )
