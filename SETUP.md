# Automation Setup — Handoff

Purpose: finish automating the Infrastructure Morning Briefing.  A prior session built the
format and archive but could not create/replace the scheduled trigger because the scheduler
MCP connector reconnected mid-session and its approval channel got stuck.  Do this from a
fresh session where the scheduler is freshly authorized.

## Tasks for the executing session

1. DELETE the interim trigger (old basic-digest format, Google Drive archive):
   - trigger_id: `trig_016SgyxBsvpq5wjXq9DqS96J`
   - Use the claude-code-remote MCP `delete_trigger` tool.

2. CREATE the replacement trigger with the exact config below.

3. VERIFY the headless run can git-push: fire the new trigger once, then check that a new
   commit lands on the `infra-digest` branch (list_commits).  This is the one thing not yet
   proven — the scheduled job runs in a fresh, headless session and must be able to `git push`
   to this repo.  If it cannot, fall back to reporting the failure; the emailed briefing still
   delivers regardless.

## Trigger config

- name: `Infrastructure Morning Briefing`
- cron: `0 8 * * *`  (08:00 UTC = 4:00 AM ET during EDT; note cron is fixed UTC and does not
  shift for daylight saving — revisit to 09:00 UTC when clocks fall back if 4 AM ET is desired)
- create_new_session_on_fire: `true`
- notifications: `{ "email": true, "push": true }`

## Trigger prompt (use verbatim)

```
Generate today's Infrastructure Morning Briefing — an analyst-style briefing for a PRIVATE-CREDIT LENDER on a deal team. US-focused; flag major global deals. Use today's date (YYYY-MM-DD) as the dateline. Emphasis throughout: financeability, offtake credit quality, leverage, spreads, tenor, security package — not just equity multiples.

STEP 1 — RESEARCH (WebSearch, and WebFetch for fetchable primaries only; many news sites like CNBC/OilPrice return 403 — route around them via targeted search queries that surface terms in the result summary).
A) Standing MARKET GAUGES to refresh every run (for the Financing Conditions section):
   - Base rates: 3M SOFR, 10Y Treasury, Fed path
   - Public spreads: IG/BBB/AA, HY OAS, leveraged-loan index
   - Direct-lending / private-credit spreads and leverage; data-center project-finance LTC and pricing (SOFR+bps)
   - Infra dry powder / fundraising / deal tempo
   - Commodity/power context: Henry Hub, power burn, data-center demand (GW)
   Prefer fetchable primaries: EIA (eia.gov), FRED (fred.stlouisfed.org), gov/IR pages, law-firm and asset-manager market notes.
B) DEALS & NEWS from ~last 24-48h across: Oil & Gas / Midstream; Power & Renewables; Data Centers & Compute Power; Airports & Aviation; Rail & Transit; Ports & Water + global megaprojects; plus infra M&A / project finance / private-credit financings. For each material deal, search specifically for TERMS: value/EV, EV/EBITDA or $/MW, counterparties (acquirer/target/sponsor, offtaker/supplier, lenders/advisors), tenor/structure, offtake credit quality, leverage/financing. Mark undisclosed terms "n/d" — never invent.

STEP 2 — COMPOSE (strict prose: two spaces between sentences; title-case headings; no emojis; no ALL CAPS). Sections in order:
1. The Macro Read (3-5 sentences: where capital and the market are this morning, dominant theme, what it means for a lender).
2. Financing Conditions (the gauge bullets from 1A, with a direction read).
3. One section per vertical (omit a vertical with no material news), each with: State of play (2-4 sentences on where the market is, key metrics/prices/direction); Today's moves (deal blocks — bold headline, confidence tag [Confirmed]/[Reported]/[Rumored], value, counterparties, tenor/structure, and an italic *Credit:* note on offtake quality/financeability/spread implication, then source link); What to watch.
4. Comps & Precedent Table (markdown table: Date | Target | Acquirer/Sponsor | Type | EV/Value | Multiple | Tenor/Structure | Offtake/Credit | Status).
5. Regulatory / Kill-Risk Watch (items that threaten project cash flows or permits).
6. Catalysts Ahead (rolling watchlist: pending FIDs, expected closes, data releases).
Profile the ~6-10 most material deals in depth; list smaller items briefly.

STEP 3 — ARCHIVE to git (best-effort; never fail the run over it).
1. Find the krengbible checkout (normally /home/user/krengbible; else: find / -maxdepth 6 -type d -name krengbible 2>/dev/null | head -1).
2. REMOTE=$(git -C /home/user/krengbible remote get-url origin)
3. rm -rf /tmp/infra-archive && git clone --branch infra-digest --single-branch "$REMOTE" /tmp/infra-archive
4. Write the full briefing to /tmp/infra-archive/digests/<YYYY-MM-DD>.md AND append the day's deals as rows to /tmp/infra-archive/comps.csv (columns: date,target,acquirer_sponsor,type,ev_or_value_usd,multiple,tenor_structure,offtake_credit,capacity,status,source).
5. cd /tmp/infra-archive && git config user.email "pauljkim22@gmail.com" && git config user.name "Paul Kim" && git add -A && git commit -m "Infrastructure briefing <YYYY-MM-DD>" && git push origin infra-digest
6. If any archive step fails, add a top-line note "Archive step failed: <reason>" and continue.

STEP 4 — DELIVER. Your FINAL message MUST be the complete briefing text (this is emailed to the user). End with a one-line footer: the archive commit result, or the failure note. Reminder in the footer: market intelligence only, not investment advice; verify terms against primary filings.
```

## Notes
- Format reference: `digests/2026-07-13.md` (first edition) and `comps.csv` on this branch.
- Compliance: public sources only — no live-deal names, targets, or non-public info in the
  prompt, the emails, or this archive.
- Optional watchlist: none provided yet; if the user supplies sponsor/strategic/asset names,
  add a "Watchlist Hits" section near the top and pass the names into the trigger prompt.
