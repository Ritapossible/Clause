"""The deployed file: what it is built from, that it fits, and the structural
rules a reviewer would check by reading it."""

import ast
import builtins
import os
import subprocess
import sys

import pytest

from minify_contract import _names_used, minify

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD = os.path.join(ROOT, "contracts", "build")
RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
CAP = 16_777_216
GENLAYER = {"gl", "Address", "u256", "TreeMap", "DynArray"}


def read(name):
    with open(os.path.join(BUILD, name)) as h:
        return h.read()


@pytest.fixture(scope="module")
def built():
    """The escrow, readable."""
    subprocess.run([sys.executable, os.path.join(ROOT, "deploy", "build_contract.py")], check=True, capture_output=True)
    return read("clause.py")


@pytest.fixture(scope="module")
def jury(built):
    return read("clause_jury.py")


@pytest.fixture(scope="module", params=[("clause", "Clause"), ("clause_jury", "ClauseJury")])
def pair(request, built):
    name, root = request.param
    return read(name + ".py"), read(name + ".min.py"), root


def method(src, name):
    start = src.index("    def %s(" % name)
    rest = src[start + 10 :]
    ends = [i for i in (rest.find("\n    @gl."), rest.find("\n    def ")) if i != -1]
    return src[start : start + 10 + min(ends)] if ends else src[start:]


def test_runner_header_then_code(pair):
    for src in pair[:2]:
        lines = src.splitlines()
        assert lines[0] == '# { "Depends": "%s" }' % RUNNER
        assert lines[1] == "from genlayer import *"


def test_deployed_is_a_fresh_minify_of_the_tested_build(pair):
    readable, deployed, root = pair
    assert minify(readable, root=root)[0] == deployed


def test_every_name_the_deployed_file_uses_is_defined(pair):
    tree = ast.parse(pair[1])
    defined = set(GENLAYER) | set(dir(builtins))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.Assign):
            defined |= {t.id for t in node.targets if isinstance(t, ast.Name)}
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            defined |= {(a.asname or a.name).split(".")[0] for a in node.names if a.name != "*"}
    missing = set()
    for node in tree.body:
        missing |= _names_used(node) - defined
    assert not missing, sorted(missing)


def test_it_fits_bradburys_gas_cap(pair):
    """Measured on Bradbury: a deploy costs about 0.96M gas plus 782 per byte
    of code and arguments, against 2^24."""
    size = len(pair[1].encode("utf-8"))
    assert 960_000 + 782 * (size + 100) < CAP * 0.96, size


def test_the_fetch_is_inline_in_both_closures(jury):
    body = method(jury, "rule")
    leader = body[body.index("def leader"): body.index("def validator")]
    validator = body[body.index("def validator"): body.index("gl.vm.run_nondet")]
    for closure in (leader, validator):
        assert "gl.nondet.web.get(uri)" in closure
        assert "_status in MISSING_STATUS" in closure and "200 <= _status < 300" in closure
        assert "hashlib.sha256(_raw).hexdigest().lower() == digest" in closure
        assert 'response_format="json"' in closure


def test_the_jury_never_sees_the_dispute_text(jury):
    body = method(jury, "rule")
    assert '["text"]' not in body and "dispute_text" not in body and '"text"' not in body
    assert body.count("criterion=criterion, test=test, artifact_text=_raw.decode(") == 2


def test_validators_compare_the_evidence_exactly_and_the_verdict_through_the_rule(jury):
    body = method(jury, "rule")
    validator = body[body.index("def validator"):]
    assert 'str(_theirs.get("artifact", "")) != _state' in validator
    assert "jury_agrees(leader_verdict=_verdict, own_verdict=_mine[\"verdict\"])" in validator


def test_the_jury_holds_no_gen_and_the_escrow_runs_no_model(built, jury):
    assert "payable" not in jury and "emit_transfer" not in jury
    assert "exec_prompt" not in built and "run_nondet" not in built and "web.get" not in built


def test_the_escrow_reads_the_jury_in_one_place(built):
    """settle and withdraw never depend on the jury contract being readable.
    The escrow reads the jury only in apply_ruling, and otherwise only sends
    it one message: dispute convenes it, fire-and-forget."""
    assert built.count("gl.get_contract_at(Address(") == 2
    assert ".view()" in method(built, "apply_ruling")
    assert ".emit(on=\"accepted\").rule(" in method(built, "dispute")
    assert ".view()" not in method(built, "dispute")
    for name in ("settle", "withdraw", "create_deal", "deliver"):
        assert "self.jury" not in method(built, name), name


def test_no_ruling_moves_value(built):
    """Rulings and deadlines credit; only withdraw transfers."""
    assert built.count("emit_transfer(") == 1
    assert "emit_transfer(" in method(built, "withdraw")


def test_a_payable_call_never_reverts_after_value_arrives(built):
    """Measured on Studio: value sent with a call that reverts stays in the
    contract. So the payable entrypoints refuse by crediting the value back,
    never by raising, and only read deal storage directly."""
    for name in ("create_deal", "dispute"):
        body = method(built, name)
        assert "raise" not in body, name
        assert "self._load(" not in body, name
        assert "self._refuse(" in body, name


def test_value_enters_only_by_funding_or_a_dispute_bond(built):
    assert built.count("@gl.public.write.payable") == 2
    assert "@gl.public.write.payable\n    def create_deal(" in built
    assert "@gl.public.write.payable\n    def dispute(" in built
