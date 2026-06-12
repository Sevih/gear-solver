import json, os, glob
KEY=b'ASLDKGFJASPODIFJSOWEI'
def dec(fn):
    raw=open(fn,encoding='utf-8').read()
    payload=raw.split("\n\n",1)[1]
    b=bytes.fromhex(json.loads(payload)['msg'])
    return bytes(b[i]^KEY[i%len(KEY)] for i in range(len(b))).decode('utf-8')
src=r'C:\tmp\op-capture\dumps'
dst=r'C:\Users\Sevih\Documents\dev\gear-solver\capture\dumps'
os.makedirs(dst,exist_ok=True)
for f in glob.glob(src+r'\*.json'):
    name=os.path.basename(f)
    try:
        obj=json.loads(dec(f))
        out=os.path.join(dst,name)
        json.dump(obj, open(out,'w',encoding='utf-8'), ensure_ascii=False, indent=1)
        print('decoded ->',name, os.path.getsize(out),'bytes')
    except Exception as e:
        print('skip',name,repr(e))
