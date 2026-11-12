import numpy as np
FX=1340.7
hyn=[27.0,3.1,-2.2,23.9,29.8,28.4,19.1,45.6,51.5,10.1,15.7,28.9,15.3,-23.6,35.5,48.6]   # 2010-2025 op margin %
mu_rev=[8.482,8.788,8.234,9.073,16.358,16.192,12.399,20.322,30.391,23.406,21.435,27.705,30.758,15.540,25.111,37.378]
mu_oi=[1.589,0.761,-0.612,0.236,3.087,2.998,0.168,5.868,14.994,7.376,3.003,6.283,9.702,-5.745,1.935,10.846]
mu=[o/r*100 for o,r in zip(mu_oi,mu_rev)]
H_AVG=np.mean(hyn); M_AVG=np.mean(mu); M_RW=sum(mu_oi)/sum(mu_rev)*100
# company setup: peak revenue & EBIT margin by year (consensus); shares; tax factor (NI/EBIT); cash; r; Q4 FCF per share
C={
 'Hynix': dict(rev={2027:583.914e12,2028:685.430e12,2029:685.430e12}, m={2027:466.409/583.914,2028:531.303/685.430,2029:531.303/685.430},
               sh=0.7006e9, tax=0.80, cash=98.7e12, r=0.105, q4=104e12*0.80*0.8, mid=H_AVG/100, px=1254000),
 'Samsung':dict(rev={2027:731e12,2028:802e12,2029:802e12}, m={2027:(573.834-20)/731,2028:(585.119-20.8)/802,2029:(585.119-20.8)/802},
               sh=6.313e9, tax=0.80, cash=167.6e12, r=0.105, q4=128e12*0.80*0.8, mid=H_AVG/100, px=208000, nm_rev=250e12, nm_m=0.08),
 'Micron': dict(rev={2027:275.706e9,2028:318.746e9,2029:320.344e9}, m={2027:230.174/275.706,2028:260.530/318.746,2029:247.512/320.344},
               sh=1.132e9, tax=0.85, cash=68.3e9, r=0.108, q4=0, mid=M_AVG/100, px=810.0),
}
coef={'Hynix':0.01085,'Samsung':0.0785,'Micron':0.01642}
OTHERS_OCT30=12.13; BIG3_OCT30=11.17+13.00+13.63; NETCASH_ETF=-1.56
def value(name, peak_end, rev_path=(0.60,0.45,0.50), m_path=(0.20,-0.08,0.10), midadd=0.0, rgrow=0.04, g=0.03, rs=0.0, reinv=(0.12,0.06,0.05), haircut=1.0):
  c=C[name]; r=c['r']+rs; t0=0.35 if name=='Micron' else 0.63; mid=c['mid']+midadd
  pv=0; years=list(range(2027,2042))
  for i,y in enumerate(years):
    if y<=peak_end:
      R=c['rev'][min(y,2029)]*haircut; M=c['m'][min(y,2029)]; last=R; ri=reinv[0]
    else:
      k=y-peak_end
      if k<=len(rev_path): R=last*rev_path[k-1]; M=m_path[k-1]; ri=reinv[1]
      else: R=last*rev_path[-1]*(1+rgrow)**(k-len(rev_path)); M=mid; ri=reinv[2]
    fcf=R*M*c['tax']-R*ri
    if 'nm_rev' in c: fcf+=c['nm_rev']*1.02**i*c['nm_m']*c['tax']*0.8
    pv+=fcf/(1+r)**(t0+i)
  # terminal on last year
  tv=fcf*(1+g)/(r-g); pv+=tv/(1+r)**(t0+len(years)-1)
  pv+=c['q4']/(1+r)**0.08+c['cash']
  return pv/c['sh']
def dram(v):
  usd={'Hynix':v['Hynix']/FX,'Samsung':v['Samsung']/FX,'Micron':v['Micron']}
  big3=sum(coef[k]*usd[k] for k in coef); return big3*(1+OTHERS_OCT30/BIG3_OCT30)+NETCASH_ETF
W={2027:.15,2028:.70,2029:.15}
def run(**kw):
  rows={pe:{k:value(k,pe,**kw) for k in C} for pe in (2027,2028,2029,2030)}
  d={pe:dram(rows[pe]) for pe in rows}
  wv={k:sum(rows[p][k]*W[p] for p in W) for k in C}
  return rows,d,sum(d[p]*W[p] for p in W),wv
if __name__=='__main__':
  print('historical avg op margin: Hynix %.1f%%  Micron %.1f%% (rev-weighted %.1f%%)'%(H_AVG,M_AVG,M_RW))
  print('Hynix troughs',min(hyn),'Micron trough %.1f'%min(mu))
  rows,d,w,wv=run()
  for pe in rows: print(pe,{k:round(rows[pe][k]) for k in C},'DRAM',round(d[pe],2))
  print('15/70/15 DRAM',round(w,2),{k:round(wv[k]) for k in wv})
  for k in C: print(k,'FV/27EPS', round(wv[k]/ (C[k]['rev'][2027]*C[k]['m'][2027]*C[k]['tax']/C[k]['sh']),2))
  print('\nSensitivities:')
  for lab,kw in [('mid-cycle margin +10pt (structural HBM)',dict(midadd=0.10)),('mid-cycle margin -5pt',dict(midadd=-0.05)),
                 ('mid revenue 40% of peak',dict(rev_path=(0.55,0.38,0.40))),('mid revenue 60% of peak',dict(rev_path=(0.70,0.55,0.60))),
                 ('trough -20% margin (2023-like)',dict(m_path=(0.15,-0.20,0.05))),('consensus -15%',dict(haircut=0.85)),
                 ('rate +1pt',dict(rs=0.01)),('rate -1pt',dict(rs=-0.01)),('terminal g 1%',dict(g=0.01)),('peak reinvest 18% of rev',dict(reinv=(0.18,0.06,0.05)))]:
    print(' ',lab.ljust(40),round(run(**kw)[2],2))
