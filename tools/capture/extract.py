from mitmproxy import http
import os
OUT = r"C:\tmp\op-capture\dumps"
os.makedirs(OUT, exist_ok=True)
WANT = ["/user/item","/user/character","/user/asset","/user/info","/item/customInfo","/user/lobby"]
seen = {}
def response(flow: http.HTTPFlow):
    u = flow.request.path
    for w in WANT:
        if w in u:
            name = w.strip("/").replace("/","_")
            seen[name] = seen.get(name,0)+1
            fn = os.path.join(OUT, f"{name}_{seen[name]}.json")
            try:
                body = flow.response.get_text() or ""
            except Exception as e:
                body = "<decode err %s>" % e
            req = ""
            try:
                req = flow.request.get_text() or ""
            except Exception:
                pass
            with open(fn,"w",encoding="utf-8") as o:
                o.write("# URL: %s%s\n" % (flow.request.host, u))
                o.write("# REQ BODY: %s\n" % req[:1000])
                o.write("# RESP STATUS: %s  len=%s\n\n" % (flow.response.status_code, len(body)))
                o.write(body)
            print("WROTE", fn, "resplen", len(body))
