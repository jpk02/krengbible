# krengbible-web

Bilingual Korean/English Bible reader, single-page static site in `index.html`.  Backend is a Cloudflare Worker at `krengbible.pauljkim22.workers.dev`.

## Worker source

The Worker source lives at `worker/index.js` in this repo.  Cloudflare-dashboard-edited deploys are still the workflow — paste the file into the dashboard when changing.  See `worker/README.md` for routes, env vars (`COMMENTARY_KV`, `ESV_TOKEN`, `ANTHROPIC_KEY`, `ADMIN_SECRET`), and the search-index build runbook.

### Korean search architecture

Korean full-text search uses a **pre-built flat index** stored in KV at key `nkrv_search_index` — a JSON array of `[bookIdx, chapter, verse, cleanText]` tuples for all 31k verses (~2.2 MB).  The Worker loads it once per isolate into a module-level cache (`SEARCH_INDEX`), then every `/search/ko` query is in-memory `includes()` + `slice()`.  All pages return in ~200ms.

**Do not** revert `/search/ko` to a per-chapter KV scan — that was the old (10s–50s) implementation.  If the index is missing, `/search/ko` returns HTTP 503 `{"error":"index_not_built"}` by design — fail loudly so the rebuild is visible.

To rebuild after a KV wipe or text change: run `/admin/build-index` in 5 chunks of 250 chapters, then `/admin/merge-index`.  Full instructions in `worker/README.md`.

English search delegates to ESV's own API — fast, no index needed.

## Prose conventions (user-strict)

- **Two spaces between sentences**, always.  Strict preference.
- **Title-case headings**, never ALL CAPS.
- **No emojis** unless explicitly requested.
- **Honest pushback over validation** — surface tradeoffs rather than rubber-stamping.

## Chapter Insights feature — the in-progress work

Insights tab on each chapter renders Q&A-style cards.  Data lives in the `INSIGHTS_SAMPLE` const inside the main inline `<script>` in `index.html`.  Key format: `"{bookNumber}_{chapter}"` (e.g. `"2_33"` = Exodus 33).

### Status as of this writing

- Exodus 1-32 complete and pushed (Ex 1-32 cards live on the site)
- Exodus 33-40 remaining — 8 chapters
- `INSIGHTS_INDEX.md` tracks all anchored concepts.  **Read it before drafting any new chapter** to avoid duplicating questions already covered.

### Card format

```js
"2_33": {
  cards: [
    {
      kicker_en: "Short label, title case",
      kicker_ko: "짧은 라벨",
      title_en: "Full question a reader would actually ask",
      title_ko: "독자가 실제로 물을 만한 질문",
      body_en: "Answer in ~250-320 words.  Use \\n\\n between paragraphs.  Two spaces between sentences.",
      body_ko: "자연스러운 한국어 흐름.  성경 인용은 개역개정 표현."
    }
  ]
}
```

### Style rules (these matter — earlier rounds got rejected for missing these)

- **Voice**: Reformed-evangelical perspective held *implicitly*.  Never use the words "Reformed", "Calvinist", or "the Reformed reading" in card text.  Just give the reading.
- **Question titles**: actual questions a curious reader would ask (not thematic essay headings).  Example: "Why does Pharaoh keep agreeing to release Israel when the plague hits, then reneging when it lifts?" — not "The pattern of false repentance".
- **Kicker labels**: short title case (e.g. "The mercy seat", "Bridegroom of blood", "Hardening").  Never all caps.
- **Body length**: 250-320 words per card.  Longer is OK for dense theological questions (the "I AM" card runs ~340).  Shorter is OK for narrative-only chapters.
- **Korean**: use 개역개정 verse phrasings throughout.  Standard Korean Presbyterian theological vocabulary (언약, 섭리, 그리스도, 메시아, 칭의, 성화, 원시복음).  Body should read as natural Korean, not English calque.
- **Cross-references**: scriptural is fine (Rom 9:17, Heb 11:21, John 1:14).  Vary them — don't recycle the same NT echo in every chapter.  Some heavily-used refs are listed in `INSIGHTS_INDEX.md`; prefer different ones when possible.
- **Cards per chapter**: 2-4 based on density.  Narrative-rich chapters (Ex 32 golden calf, Ex 33 face-to-face) get 3-4.  Construction-detail chapters (Ex 36-39 tabernacle building, repeating instructions from 25-31) get 1-2.

### Avoiding duplication

`INSIGHTS_INDEX.md` lists every anchored concept by chapter.  Major patterns already used:

- "God remembered" / *zakar* → anchored at Ex 2
- Divine name "I AM" → Ex 3
- "Hardened Pharaoh's heart" + compatibilism + Rom 9 → Ex 4
- Plagues vs Egyptian pantheon → Ex 7
- Pharaoh's false repentance pattern → Ex 8
- Lamb / Passover / Christ → Ex 12
- Red Sea as baptism → Ex 14
- "I AM WHO I AM" and divine name → Ex 3 (don't re-explain in later chapters)
- Tabernacle as God-dwelling-with-people → Ex 25 (later chapters can build on, not repeat)
- Aaron's failure pattern → Ex 32

If a concept appears in a later chapter where it's already been anchored, either skip the question or find a chapter-specific angle that adds something new.

### Injection pattern

New chapter data is injected into `INSIGHTS_SAMPLE` via a temporary Node script.  File uses CRLF line endings — important for the regex anchor to match.  Pattern:

```js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'index.html');
let src = fs.readFileSync(file, 'utf8');

const data = `,
  "2_NN": {
    cards: [
      { kicker_en: "...", kicker_ko: "...", title_en: "...", title_ko: "...", body_en: "...", body_ko: "..." }
    ]
  }`;

const pat = /(\r\n  \}\r\n)\};\r\n/;
if (!pat.test(src)) { console.error('anchor not found'); process.exit(1); }
src = src.replace(pat, `$1${data.replace(/\r?\n/g, '\r\n')}\r\n};\r\n`);
fs.writeFileSync(file, src, 'utf8');
console.log('OK');
```

Save as `_add_exNN.js`, run with `node`, then delete with `rm _add_exNN.js`.  Commit with descriptive message listing chapter cards.  Push to `origin main`.

### Verification after injection

Always run this sanity check after injection to confirm no JS broke and chapters are present:

```bash
node -e "
const s=require('fs').readFileSync('index.html','utf8');
const re=/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g;
let m,i=0;
while((m=re.exec(s))){
  const tag=s.slice(m.index,m.index+m[0].indexOf('>')+1);
  if(tag.includes('src=')||tag.includes('type=\"module\"')){ i++; continue; }
  try { new Function(m[1]); console.log('script',i,'ok'); } catch(e){ console.log('script',i,'FAIL:',e.message); }
  i++;
}
"
```

### Update the registry when done

After all chapters in a batch are pushed, append the new anchored concepts to `INSIGHTS_INDEX.md` under the appropriate Exodus chapter heading.
