"""mitmproxy addon: live-decode Outerplane game-server responses.

For each target endpoint it XOR-decodes the {"msg":"<hex>"} body and writes clean
JSON into $OP_OUT (default capture/out/). Drops a .captured marker once /user/item
is seen so an orchestrator can know the inventory was grabbed.

Unknown paths (anything beyond WANT) are decoded too and written under
$OP_OUT/_unknown/<sanitized-path>.json plus appended to seen-paths.log — that's
how we discover the right endpoints for Codex / Awakening progression which
aren't yet in WANT.

Loaded by mitmdump in reverse mode: mitmdump -s addon.py --mode reverse:...
"""
from mitmproxy import http, ctx
import os, json

KEY = b"ASLDKGFJASPODIFJSOWEI"
OUT = os.environ.get("OP_OUT") or os.path.join(os.path.dirname(__file__), "out")
UNKNOWN_DIR = os.path.join(OUT, "_unknown")
SEEN_LOG = os.path.join(OUT, "seen-paths.log")

# exact path (without query) -> output basename
WANT = {
    "/user/item": "user_item",
    "/user/character": "user_character",
    "/user/asset": "user_asset",
    "/user/info": "user_info",
    "/user/lobby": "user_lobby",
    "/user/etc": "user_etc",
    "/item/customInfo": "item_customInfo",
    # Codex (Hero Archive) + Geas (Gift tree) per-account progression — drives
    # the no-gear baseline composer in apps/web's BuildsScreen.
    "/archive/info": "user_archive",
    "/gift/info": "user_gift",
}

# Paths we deliberately ignore — login/heartbeat noise that would clutter the
# unknown bucket without ever holding gameplay data we want.
IGNORE_PREFIXES = (
    "/account/",
    "/server/",
)

os.makedirs(OUT, exist_ok=True)
os.makedirs(UNKNOWN_DIR, exist_ok=True)
_seen_paths = set()


def _decode(msg_hex: str) -> str:
    b = bytes.fromhex(msg_hex)
    return bytes(b[i] ^ KEY[i % len(KEY)] for i in range(len(b))).decode("utf-8")


def _safe_filename(path: str) -> str:
    return path.lstrip("/").replace("/", "_").replace(".", "_") or "root"


def _log_seen(path: str):
    if path in _seen_paths:
        return
    _seen_paths.add(path)
    try:
        with open(SEEN_LOG, "a", encoding="utf-8") as f:
            f.write(path + "\n")
    except Exception:
        pass


def response(flow: http.HTTPFlow):
    path = flow.request.path.split("?", 1)[0]
    name = WANT.get(path)

    # Log every observed path once, so the user can grep new endpoints after
    # navigating to Codex / Awakening / Trust screens in-game.
    _log_seen(path)

    if not name:
        # Unknown endpoint — still decode it and save under _unknown/ so we
        # can inspect it after the fact. Skip login/heartbeat traffic.
        if any(path.startswith(p) for p in IGNORE_PREFIXES):
            return
        try:
            body = flow.response.get_text()
            outer = json.loads(body)
            msg = outer.get("msg") if isinstance(outer, dict) else None
            if not isinstance(msg, str):
                return  # not an XOR-encoded game payload
            obj = json.loads(_decode(msg))
            out_path = os.path.join(UNKNOWN_DIR, _safe_filename(path) + ".json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, indent=1)
            ctx.log.info("OP unknown %s -> _unknown/%s.json" % (path, _safe_filename(path)))
        except Exception:
            pass
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
