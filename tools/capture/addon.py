"""mitmproxy addon: live-decode Outerplane game-server responses.

For each target endpoint it XOR-decodes the {"msg":"<hex>"} body and writes clean
JSON into $OP_OUT (default capture/out/). Drops a .captured marker once /user/item
is seen so an orchestrator can know the inventory was grabbed.
Loaded by mitmdump in reverse mode: mitmdump -s addon.py --mode reverse:...
"""
from mitmproxy import http, ctx
import os, json

KEY = b"ASLDKGFJASPODIFJSOWEI"
OUT = os.environ.get("OP_OUT") or os.path.join(os.path.dirname(__file__), "out")

# exact path (without query) -> output basename
WANT = {
    "/user/item": "user_item",
    "/user/character": "user_character",
    "/user/asset": "user_asset",
    "/user/info": "user_info",
    "/user/lobby": "user_lobby",
    "/user/etc": "user_etc",
    "/item/customInfo": "item_customInfo",
}

os.makedirs(OUT, exist_ok=True)


def _decode(msg_hex: str) -> str:
    b = bytes.fromhex(msg_hex)
    return bytes(b[i] ^ KEY[i % len(KEY)] for i in range(len(b))).decode("utf-8")


def response(flow: http.HTTPFlow):
    path = flow.request.path.split("?", 1)[0]
    name = WANT.get(path)
    if not name:
        return
    try:
        body = flow.response.get_text()
        outer = json.loads(body)
        msg = outer.get("msg") if isinstance(outer, dict) else None
        obj = json.loads(_decode(msg)) if isinstance(msg, str) else outer
        with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        if name == "user_item":
            with open(os.path.join(OUT, ".captured"), "w") as f:
                f.write("ok")
        ctx.log.info("OP captured %s -> %s.json" % (path, name))
    except Exception as e:
        ctx.log.warn("OP decode failed for %s: %r" % (path, e))
