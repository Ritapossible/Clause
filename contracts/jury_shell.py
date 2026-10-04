"""Clause jury: the only contract that runs a model.

Built by ``deploy/build_contract.py`` into ``contracts/build/clause_jury.py``
(and ``clause_jury.min.py``, the bytes deployed). Do not edit the build.

It holds no GEN and no deal. ``rule`` reads one disputed clause from an escrow
(a view call), asks the jury the one question, and records the ruling here,
keyed by the escrow it read. The escrow pulls the ruling with
``apply_ruling`` once the ruling is ``appeal_seconds`` old; nothing else in the
escrow reads this contract. So an appeal, or a platform fault, that leaves
this contract unreadable cannot freeze any GEN: the escrow's clocks still pay
or refund, and ``withdraw`` still sends.

**What counts as a reading.** Measured on Studio: a 404 is a normal response
with ``status`` 404, and an unreachable host raises. So:

- 2xx and the bytes match the pinned digest: the model reads the work.
- 2xx and the bytes differ, or 404/410: the seller changed or removed the
  work it pinned. ``unmet``, no model call; the seller may redeliver.
- no answer at all (an exception, 5xx, 429): not a verdict on anyone. The
  call is refused, nothing is recorded, and it can be convened again until
  the ruling deadline, after which the clause pays the seller.

Hard rules (see docs/ARCHITECTURE.md):
- The fetch is written inline in both closures.
- Every value a closure captures is a plain Python value.
"""


class ClauseJury(gl.Contract):
    release: str
    rulings: TreeMap[str, str]
    ruled: u256

    def __init__(self):
        self.release = "clause-jury/2"
        self.ruled = u256(0)

    def _now(self) -> int:
        return int(datetime.datetime.now().timestamp())

    def _key(self, escrow: str, deal_id: int, clause_id: str) -> str:
        return "%s:%d:%s" % (str(escrow).lower(), int(deal_id), str(clause_id))

    @gl.public.write
    def rule(self, escrow: str, deal_id: int, clause_id: str) -> None:
        """Convene the jury on one disputed clause of a deal in ``escrow``.
        Anyone may call it, once per dispute."""
        source = str(escrow).lower()
        deal = json.loads(str(gl.get_contract_at(Address(source)).view().get_deal(int(deal_id))))
        try:
            line = find_line(deal, str(clause_id))
        except ClauseError as exc:
            raise Exception("[EXPECTED] " + str(exc))
        if line["state"] != LINE_DISPUTED:
            raise Exception("[EXPECTED] clause is not disputed")
        dispute = line["dispute"]
        if self._now() > int(dispute["rule_by"]):
            raise Exception("[EXPECTED] the ruling deadline has passed; settle releases the clause")
        key = self._key(source, deal_id, clause_id)
        if str(json.loads(self.rulings.get(key, "{}")).get("round", "")) == str(dispute["round"]):
            raise Exception("[EXPECTED] this dispute is already ruled; apply_ruling applies it")

        # Plain values only: the validator's closure is pickled into a sandbox
        # where a storage proxy does not survive.
        uri = str(deal["delivery"]["uri"])
        digest = str(deal["delivery"]["digest"])
        criterion = str(line["criterion"])
        test = str(line["test"])
        locate = str(dispute.get("locate", ""))
        where = locate_where(locate)

        def leader() -> str:
            _state = ARTIFACT_UNREAD
            _raw = b""
            try:
                # INLINE fetch - do not factor this into a helper.
                _resp = gl.nondet.web.get(uri)
                _status = int(_resp.status)
                _raw = _resp.body or b""
                if isinstance(_raw, str):
                    _raw = _raw.encode("utf-8")
                if _status in MISSING_STATUS:
                    _state = ARTIFACT_MISSING
                elif 200 <= _status < 300:
                    _ok = hashlib.sha256(_raw).hexdigest().lower() == digest
                    _state = ARTIFACT_VERIFIED if _ok else ARTIFACT_CHANGED
            except Exception:
                _state = ARTIFACT_UNREAD
            if _state == ARTIFACT_UNREAD:
                return json.dumps({"artifact": _state})
            if _state != ARTIFACT_VERIFIED:
                # The seller keeps the work at the digest it pinned.
                return json.dumps({"verdict": VERDICT_UNMET, "reason": "work_" + _state, "confidence": 100, "artifact": _state})
            _prompt = build_prompt(
                criterion=criterion, test=test, artifact_text=_raw.decode("utf-8", "replace"),
                excerpt=excerpt_of(_raw, locate), where=where,
            )
            _out = read_answer(gl.nondet.exec_prompt(_prompt, response_format="json"))
            _out["artifact"] = _state
            return json.dumps(_out)

        def validator(leader_result) -> bool:
            _state = ARTIFACT_UNREAD
            _raw = b""
            try:
                # INLINE fetch again - the duplication is deliberate.
                _resp = gl.nondet.web.get(uri)
                _status = int(_resp.status)
                _raw = _resp.body or b""
                if isinstance(_raw, str):
                    _raw = _raw.encode("utf-8")
                if _status in MISSING_STATUS:
                    _state = ARTIFACT_MISSING
                elif 200 <= _status < 300:
                    _ok = hashlib.sha256(_raw).hexdigest().lower() == digest
                    _state = ARTIFACT_VERIFIED if _ok else ARTIFACT_CHANGED
            except Exception:
                _state = ARTIFACT_UNREAD
            _theirs = as_dict(leader_result)
            if not _theirs or str(_theirs.get("artifact", "")) != _state:
                return False
            if _state == ARTIFACT_UNREAD:
                return True
            _verdict = str(_theirs.get("verdict", ""))
            if _verdict not in VERDICTS:
                return False
            if _state != ARTIFACT_VERIFIED:
                return _verdict == VERDICT_UNMET
            _prompt = build_prompt(
                criterion=criterion, test=test, artifact_text=_raw.decode("utf-8", "replace"),
                excerpt=excerpt_of(_raw, locate), where=where,
            )
            _mine = read_answer(gl.nondet.exec_prompt(_prompt, response_format="json"))
            return jury_agrees(leader_verdict=_verdict, own_verdict=_mine["verdict"])

        decoded = as_dict(gl.vm.run_nondet(leader, validator, compare_user_errors=True))
        if str(decoded.get("artifact", "")) == ARTIFACT_UNREAD:
            # No answer from the server is not a verdict on anyone.
            raise Exception("[EXPECTED] the work could not be fetched, so nothing was ruled; convene the jury again before the ruling deadline")
        verdict = str(decoded.get("verdict", VERDICT_UNDETERMINED))
        if verdict not in VERDICTS:
            verdict = VERDICT_UNDETERMINED
        self.rulings[key] = json.dumps(
            {
                "round": str(dispute["round"]),
                "verdict": verdict,
                "reason": str(decoded.get("reason", ""))[:48],
                "confidence": int(decoded.get("confidence", 0)),
                "artifact": str(decoded.get("artifact", "")),
                "located": locate != "",
                "at": self._now(),
            }
        )
        self.ruled = u256(int(self.ruled) + 1)

    @gl.public.view
    def ruling_of(self, escrow: str, deal_id: int, clause_id: str) -> str:
        """The latest ruling on a clause of a deal in ``escrow``, or ``{}``."""
        return self.rulings.get(self._key(escrow, deal_id, clause_id), "{}")

    @gl.public.view
    def status(self) -> str:
        return json.dumps({"release": self.release, "ruled": int(self.ruled)})
