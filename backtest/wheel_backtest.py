import databento as db, pandas as pd, numpy as np, glob, os, sys
from math import log, sqrt
from scipy.stats import norm
from scipy.optimize import brentq
root, und_file, maxgap = sys.argv[1], sys.argv[2], int(sys.argv[3])   # e.g. mu mu/mu_1d.dbn.zst 8
TGT=float(sys.argv[4]) if len(sys.argv)>4 else 0.20
def load():
  rows=[]
  for f in sorted(glob.glob(f'{root}/q/*.dbn.zst')):
    day=pd.Timestamp(os.path.basename(f)[:10])
    try: q=db.DBNStore.from_file(f).to_df()
    except Exception: continue
    if q.empty: continue
    q=q.reset_index(drop=True); t=q.ts_recv.min(); q=q[q.ts_recv==t] if 'ts_recv' in q else q
    sp=q.symbol.str.split(expand=True); q=q[sp[0].isin(['MU','DRAM'])]; s=sp.loc[q.index,1]
    q=q.assign(exp=pd.to_datetime('20'+s.str[:6]),cp=s.str[6],K=s.str[7:].astype(int)/1000)
    q=q[(q.bid_px_00>0)&(q.ask_px_00>0)&(q.ask_px_00<1e5)].assign(mid=lambda x:(x.bid_px_00+x.ask_px_00)/2,day=day)
    rows.append(q[['day','exp','cp','K','bid_px_00','ask_px_00','mid']])
  return pd.concat(rows)
Q=load()
def spot(h):
  c=h[h.cp=='C'].groupby('K').mid.mean(); p=h[h.cp=='P'].groupby('K').mid.mean(); ks=c.index.intersection(p.index)
  if len(ks)==0: return np.nan
  k0=(c[ks]-p[ks]).abs().idxmin(); return float(c[k0]-p[k0]+k0)
S_day={}
for d,g in Q.groupby('day'): S_day[d]=spot(g[g.exp==g.exp.min()])
u=db.DBNStore.from_file(und_file).to_df(); u=u.assign(d=pd.to_datetime(u.index.date)).sort_values('volume').drop_duplicates('d',keep='last'); close=pd.Series(u.close.values,index=u.d.values)
def px(S,K,s,T,cp):
  d1=(log(S/K)+0.5*s*s*T)/(s*sqrt(T)); d2=d1-s*sqrt(T)
  return S*norm.cdf(d1)-K*norm.cdf(d2) if cp=='C' else K*norm.cdf(-d2)-S*norm.cdf(-d1)
def pick(h,S,T,cp,tgt):
  X=h[(h.cp==cp)&((h.K<S) if cp=='P' else (h.K>S))].copy()
  if len(X)<2: return None
  out=[]
  for k,m,b in zip(X.K,X.mid,X.bid_px_00):
    try: iv=brentq(lambda s:px(S,k,s,T,cp)-m,0.03,8)
    except: continue
    d1=(log(S/k)+0.5*iv*iv*T)/(iv*sqrt(T)); dl=abs(norm.cdf(d1)-(1 if cp=='P' else 0)); out.append((abs(dl-tgt),k,b,dl))
  if not out: return None
  e=min(out); return e[1],e[2],e[3]
# build trade schedule: each snapshot day d with next expiry E within maxgap days that also has a settlement
days=sorted(S_day); sched=[]
for d in days:
  g=Q[Q.day==d]; fut=sorted(e for e in g.exp.unique() if e>d)
  if not fut: continue
  E=fut[0]
  if (E-d).days>maxgap: continue
  ST=close.get(E, S_day.get(E, np.nan))
  if not np.isfinite(ST): continue
  sched.append((d,E,ST))
# non-overlapping chain: next trade starts on/after previous expiry
chain=[]; nxt=None
for d,E,ST in sched:
  if nxt is not None and d<nxt: continue
  chain.append((d,E,ST)); nxt=E
def run(mode):
  state='cash'; basis=None; log_=[]
  for d,E,ST in chain:
    g=Q[(Q.day==d)&(Q.exp==E)]; S=S_day[d]; T=((E-d).days+0.25/24)/365
    if state=='cash' or mode=='putonly':
      p=pick(g,S,T,'P',TGT)
      if p is None: continue
      K,b,dl=p; pnl=b-max(K-ST,0)
      if mode=='wheel' and ST<K: state='stock'; basis=K
    else:
      p=pick(g,S,T,'C',TGT)
      if p is None: continue
      K,b,dl=p; pnl=b+(min(ST,K)-S)
      if ST>K: state='cash'
    log_.append(dict(day=d,S=S,ST=ST,pnl=pnl,pct=pnl/S*100,state=state))
  return pd.DataFrame(log_)
for mode in ('wheel','putonly'):
  L=run(mode); L['yr']=L.day.dt.year
  bh=(L.ST/L.S-1)*100
  n=len(L); per=n/((L.day.iloc[-1]-L.day.iloc[0]).days/365.25)
  eq=(1+L.pct/100).cumprod(); dd=(eq/eq.cummax()-1).min()*100; beq=(1+bh/100).cumprod(); bdd=(beq/beq.cummax()-1).min()*100
  print(f'\n[{root} {mode} delta {TGT}] trades={n} ({per:.0f}/yr)  mean/trade={L.pct.mean():.3f}%  t={L.pct.mean()/(L.pct.std()/np.sqrt(n)):.2f}  annualized~{L.pct.mean()*per:.1f}%  vol~{L.pct.std()*np.sqrt(per):.1f}%  maxDD={dd:.1f}%  worst={L.pct.min():.1f}%  time in stock={(L.state=="stock").mean()*100:.0f}%')
  print(f'   buy&hold same periods: mean/trade={bh.mean():.3f}% annualized~{bh.mean()*per:.1f}% vol~{bh.std()*np.sqrt(per):.1f}% maxDD={bdd:.1f}%')
  yt=pd.DataFrame({'strategy':L.groupby('yr').pct.sum(),'buy&hold':bh.groupby(L.yr).sum()}).round(1)
  print(yt.to_string())
