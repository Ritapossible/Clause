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


@pytest.fixture(scope="module")
def built():
    subprocess.run([sys.executable, os.path.join(ROOT, "deploy", "build_contract.py")], check=True, capture_output=True)
    with open(os.path.join(BUILD, "clause.py")) as h:
        return h.read()


@pytest.fixture(scope="module")
def deployed(built):
    with open(os.path.join(BUILD, "clause.min.py")) as h:
        return h.read()


def method(src, name):
    start = src.index("    def %s(" % name)
    rest = src[start + 10 :]
    ends = [i for i in (rest.find("\n    @gl."), rest.find("\n    def ")) if i != -1]
    return src[start : start + 10 + min(ends)] if ends else src[start:]


def test_runner_header_then_code(built, deployed):
    for src in (built, deployed):
        lines = src.splitlines()
        assert lines[0] == '# { "Depends": "%s" }' % RUNNER
        assert lines[1] == "from genlayer import *"


def test_deployed_is_a_fresh_minify_of_the_tested_build(built, deployed):
    assert minify(built, root="Clause")[0] == deployed


def test_every_name_the_deployed_file_uses_is_defined(deployed):
    tree = ast.parse(deployed)
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


def test_it_fits_bradburys_gas_cap(deployed):
    """Measured on Bradbury: a deploy costs about 0.96M gas plus 782 per byte
    of code and arguments, against 2^24."""
    size = len(deployed.encode("utf-8"))
    assert 960_000 + 782 * (size + 100) < CAP * 0.96, size


def test_the_fetch_is_inline_in_both_closures(built):
    body = method(built, "rule")
    leader = body[body.index("def leader"): body.index("def validator")]
    validator = body[body.index("def validator"): body.index("gl.vm.run_nondet")]
    for closure in (leader, validator):
        assert "gl.nondet.web.get(uri)" in closure
        assert "hashlib.sha256(_raw).hexdigest().lower() == digest" in closure
        assert 'response_format="json"' in closure


def test_the_jury_never_sees_the_dispute_text(built):
    body = method(built, "rule")
    assert '["text"]' not in body and "dispute_text" not in body
    assert "build_prompt(criterion=criterion, test=test, artifact_text=_text)" in body


def test_validators_compare_the_evidence_exactly_and_the_verdict_through_the_rule(built):
    body = method(built, "rule")
    validator = body[body.index("def validator"):]
    assert 'str(_theirs.get("artifact", "")) != _state' in validator
    assert "jury_agrees(leader_verdict=_verdict, own_verdict=_mine[\"verdict\"])" in validator


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
