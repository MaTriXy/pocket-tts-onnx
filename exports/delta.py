import torch, numpy as np
from pocket_tts import TTSModel
en = TTSModel.load_model(language="english"); es = TTSModel.load_model(language="spanish")
se, ss = en.state_dict(), es.state_dict()
print("tokenizer attrs:", [a for a in dir(en) if "token" in a.lower()][:6])
same_shape = [k for k in se if k in ss and se[k].shape == ss[k].shape]
diff_shape = [k for k in se if k in ss and se[k].shape != ss[k].shape]
print(f"{len(same_shape)} tensors same shape, {len(diff_shape)} differ, {len(set(se)-set(ss))} only-en, {len(set(ss)-set(se))} only-es")
for k in diff_shape[:5]: print("  shape diff", k, tuple(se[k].shape), tuple(ss[k].shape))
rows=[]
for k in same_shape:
    a, b = se[k].float(), ss[k].float()
    if a.numel() < 1000: continue
    rel = (b-a).norm()/a.norm()
    rows.append((rel.item(), k))
rows.sort()
print("relative delta ||es-en||/||en||: min %.3f median %.3f max %.3f" % (rows[0][0], rows[len(rows)//2][0], rows[-1][0]))
for r,k in rows[:3]+rows[-3:]: print(f"  {r:.3f} {k}")
# low-rank energy of the delta on the big flow-LM matmuls
picks = [k for k in same_shape if se[k].ndim==2 and min(se[k].shape)>=512 and 'flow_lm.transformer' in k][:6]
for k in picks:
    d = (ss[k].float()-se[k].float()); s = torch.linalg.svdvals(d); e = (s**2).cumsum(0)/(s**2).sum()
    n=len(s); print(f"{k} {tuple(d.shape)}  delta energy in top r=16: {e[15]:.2f}  r=64: {e[63]:.2f}  r=256: {e[255]:.2f}  (full rank={n})")
    # and for comparison, the same for the English weight itself (how low-rank a *model* is)
    s2 = torch.linalg.svdvals(se[k].float()); e2=(s2**2).cumsum(0)/(s2**2).sum()
    print(f"   english weight itself: r=64: {e2[63]:.2f}  r=256: {e2[255]:.2f}")
# is es closer to en than to random? cosine similarity of flattened weights
import torch.nn.functional as F
cos=[F.cosine_similarity(se[k].float().flatten(), ss[k].float().flatten(), dim=0).item() for k in picks]
print("cosine(en, es) on those matmuls:", [round(c,3) for c in cos])
