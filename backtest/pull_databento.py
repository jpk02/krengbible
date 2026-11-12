import databento as db, pandas as pd, os
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
NY=ZoneInfo('America/New_York')
def get(sym,d,f,mins):
  if os.path.exists(f): return
  st=pd.Timestamp(d.strftime('%Y-%m-%d')+' 15:45',tz=NY).tz_convert('UTC')
  for a in range(3):
    try: db.Historical().timeseries.get_range(dataset='OPRA.PILLAR',symbols=[sym],stype_in='parent',schema='cbbo-1m',start=st,end=st+pd.Timedelta(minutes=mins),path=f+'.tmp'); os.rename(f+'.tmp',f); return
    except Exception as e: err=str(e)[:80]
  print(sym,d.date(),'ERR',err,flush=True)
jobs=[]
for d in pd.date_range('2013-04-05','2026-11-06',freq='W-FRI'):
  jobs.append(('MU.OPT',d,f"mu/q/{d.strftime('%Y-%m-%d')}.dbn.zst",1))
  jobs.append(('MU.OPT',d-pd.Timedelta(days=1),f"mu/q/{(d-pd.Timedelta(days=1)).strftime('%Y-%m-%d')}.dbn.zst",1))  # Thursday backup for holidays
for d in pd.bdate_range('2026-05-07','2026-11-11'):
  jobs.append(('DRAM.OPT',d,f"bt/q/{d.strftime('%Y-%m-%d')}.dbn.zst",1))
with ThreadPoolExecutor(16) as ex: list(ex.map(lambda j:get(*j),jobs))
c=db.Historical()
c.timeseries.get_range(dataset='XNAS.ITCH',symbols=['MU'],schema='ohlcv-1d',start='2018-05-01',end='2026-11-12',path='mu/mu_1d.dbn.zst')
c.timeseries.get_range(dataset='XNAS.ITCH',symbols=['DRAM'],schema='ohlcv-1d',start='2026-04-01',end='2026-11-12',path='bt/und_1d.dbn.zst')
print('done',flush=True)
