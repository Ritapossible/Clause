# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


class ProbeWeb(gl.Contract):
    out: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def probe(self, uri: str) -> None:
        def leader() -> str:
            try:
                r = gl.nondet.web.get(uri)
                b = r.body
                return json.dumps({"raised": False, "status": getattr(r, "status", "absent"),
                                   "attrs": [a for a in dir(r) if not a.startswith("_")],
                                   "body_len": -1 if b is None else len(b)})
            except Exception as e:
                return json.dumps({"raised": True, "type": type(e).__name__, "msg": str(e)[:300]})

        def validator(x) -> bool:
            return True

        self.out[uri] = str(gl.vm.run_nondet(leader, validator))

    @gl.public.view
    def get(self, uri: str) -> str:
        return self.out.get(uri, "")
