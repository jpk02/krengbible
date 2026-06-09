// krengbible Cloudflare Worker
//
// Routes:
//   /esv/?q=...                           -> ESV API passage lookup (passthrough)
//   /intro/{bookNum}                      -> AI-generated book intro (cached in COMMENTARY_KV)
//   /commentary/{bookNum}/{chapter}       -> AI-generated chapter commentary (cached)
//   /search/ko?q=...&offset=...           -> Korean full-text search (FAST: uses pre-built index)
//   /search/en?q=...&page=...             -> English full-text search (FAST: uses pre-built index)
//   /votd                                 -> Verse of the day + photo
//   /nkrv/{book}/{chapter}                -> Korean Bible (NKRV), cached per chapter
//   /admin/build-index?secret=...&from=N&size=M     -> (re)build the Korean search index.  Chunked.
//   /admin/merge-index?secret=...                   -> Merge KO chunks -> nkrv_search_index.
//   /admin/build-en-index?secret=...&from=N&size=M  -> (re)build the ESV English search index.  Chunked.
//   /admin/merge-en-index?secret=...                -> Merge EN chunks -> esv_search_index.
//   /admin/index-status?secret=...                  -> Status of both indexes + api.bible cache counts.
//   /admin/wipe-apibible-cache?secret=...[&translationId=...]
//                                                   -> Delete cached api.bible chapters + chunks + index.
//   /admin/build-apibible-index?secret=...&translationId=...&from=N&size=M
//                                                   -> (re)build the api.bible search index for one translation.
//                                                      Chunked.  Side effect: warms per-chapter KV cache.
//   /admin/merge-apibible-index?secret=...&translationId=...
//                                                   -> Merge per-translation chunks -> apibible_search_index_{id}.
//   /apibible/{translationId}/{bookNum}/{chapter}   -> api.bible chapter fetch (NLT/NIV/MSG).
//                                                      30-day KV TTL.  FUMS token returned for client to ping.
//   /search/apibible/{translationId}?q=...&page=...
//                                                   -> Per-translation search.  Uses pre-built index when
//                                                      available (instant); falls back to live api.bible search
//                                                      when not built.
//
// Search index formats:
//   nkrv_search_index : JSON array of [bookIdx, chapter, verse, text] tuples for the Korean Bible.
//   esv_search_index  : JSON array of [bookIdx, chapter, verse, text] tuples for the ESV Bible.
//   bookIdx is 0-based, verse is the original label.
//
// During build we write partial chunks to KV keys (nkrv_search_chunk_N / esv_search_chunk_N), then
// the matching /admin/merge-* endpoint reads them all and writes the final index blob.

const BOOK_NAMES_EN = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah',
  'Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah',
  'Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah',
  'Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi',
  'Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians',
  'Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians',
  '1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James',
  '1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'
];
const BOOK_NAMES_KO = [
  '창세기','출애굽기','레위기','민수기','신명기','여호수아','사사기','룻기',
  '사무엘상','사무엘하','열왕기상','열왕기하','역대상','역대하','에스라','느헤미야',
  '에스더','욥기','시편','잠언','전도서','아가','이사야','예레미야',
  '예레미야애가','에스겔','다니엘','호세아','요엘','아모스','오바댜','요나',
  '미가','나훔','하박국','스바냐','학개','스가랴','말라기',
  '마태복음','마가복음','누가복음','요한복음','사도행전','로마서','고린도전서','고린도후서',
  '갈라디아서','에베소서','빌립보서','골로새서','데살로니가전서','데살로니가후서',
  '디모데전서','디모데후서','디도서','빌레몬서','히브리서','야고보서',
  '베드로전서','베드로후서','요한일서','요한이서','요한삼서','유다서','요한계시록'
];
const BOOK_CHAPTERS = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
const NKRV_CODES = [
  "gen","exo","lev","num","deu","jos","jdg","rut",
  "1sa","2sa","1ki","2ki","1ch","2ch","ezr","neh",
  "est","job","psa","pro","ecc","sng","isa","jer",
  "lam","ezk","dan","hos","jol","amo","oba","jnh",
  "mic","nam","hab","zep","hag","zec","mal",
  "mat","mrk","luk","jhn","act","rom","1co","2co",
  "gal","eph","php","col","1th","2th","1ti","2ti",
  "tit","phm","heb","jas","1pe","2pe","1jn","2jn",
  "3jn","jud","rev"
];

// USFM book codes (uppercase) — what api.bible expects in chapter IDs like "GEN.1".
// Differs from NKRV_CODES only by case and JON vs JNH (Jonah).
const USFM_CODES = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT",
  "1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH",
  "EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON",
  "MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO",
  "GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI",
  "TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN",
  "3JN","JUD","REV"
];

// Whitelist of api.bible translation IDs the app is authorized to fetch.
// Keep this list explicit: any ID not in here returns 403 even with a valid key.
// abbreviation/name are used for the in-response identification and downstream attribution.
const API_BIBLE_TRANSLATIONS = {
  'd6e14a625393b4da-01': { abbreviation: 'NLT', name: 'New Living Translation' },
  '78a9f6124f344018-01': { abbreviation: 'NIV', name: 'New International Version' },
  '6f11a7de016f942e-01': { abbreviation: 'MSG', name: 'The Message' }
};

// 30 days, in seconds — matches api.bible's required cache-refresh cadence.
const API_BIBLE_CACHE_TTL = 30 * 24 * 60 * 60;

// ---- Module-level search index cache (per isolate) ----
// SEARCH_INDEX: the parsed array of [b, c, v, t] tuples once loaded.
// SEARCH_INDEX_PROMISE: in-flight load promise so concurrent requests share one KV read.
let SEARCH_INDEX = null;
let SEARCH_INDEX_PROMISE = null;
let EN_SEARCH_INDEX = null;
let EN_SEARCH_INDEX_PROMISE = null;
// Per-translation api.bible index cache: { [translationId]: tuples[] }.
// Same shape as EN_SEARCH_INDEX; loaded lazily, retained for the isolate's lifetime.
const APIBIBLE_INDEXES = Object.create(null);
const APIBIBLE_INDEX_PROMISES = Object.create(null);

async function getSearchIndex(env) {
  if (SEARCH_INDEX) return SEARCH_INDEX;
  if (SEARCH_INDEX_PROMISE) return SEARCH_INDEX_PROMISE;
  SEARCH_INDEX_PROMISE = (async () => {
    const raw = await env.COMMENTARY_KV.get('nkrv_search_index');
    if (!raw) {
      SEARCH_INDEX_PROMISE = null;
      return null;
    }
    try {
      SEARCH_INDEX = JSON.parse(raw);
    } catch (e) {
      SEARCH_INDEX = null;
    }
    SEARCH_INDEX_PROMISE = null;
    return SEARCH_INDEX;
  })();
  return SEARCH_INDEX_PROMISE;
}

async function getEnSearchIndex(env) {
  if (EN_SEARCH_INDEX) return EN_SEARCH_INDEX;
  if (EN_SEARCH_INDEX_PROMISE) return EN_SEARCH_INDEX_PROMISE;
  EN_SEARCH_INDEX_PROMISE = (async () => {
    const raw = await env.COMMENTARY_KV.get('esv_search_index');
    if (!raw) {
      EN_SEARCH_INDEX_PROMISE = null;
      return null;
    }
    try {
      EN_SEARCH_INDEX = JSON.parse(raw);
    } catch (e) {
      EN_SEARCH_INDEX = null;
    }
    EN_SEARCH_INDEX_PROMISE = null;
    return EN_SEARCH_INDEX;
  })();
  return EN_SEARCH_INDEX_PROMISE;
}

// ---- HTML -> verses parser for bskorea.or.kr (extracted so /admin/build-index can reuse it) ----
// Korean consonant footnote markers (ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ)
// map to position numbers 1..14.  bskorea uses these as visual inline
// markers but the corresponding popup footnotes are keyed by digit, so
// we normalize both forms to the same numeric key.
const KO_FN_LETTER_TO_NUM = {
  'ㄱ': 1, 'ㄴ': 2, 'ㄷ': 3, 'ㄹ': 4, 'ㅁ': 5, 'ㅂ': 6, 'ㅅ': 7,
  'ㅇ': 8, 'ㅈ': 9, 'ㅊ': 10, 'ㅋ': 11, 'ㅌ': 12, 'ㅍ': 13, 'ㅎ': 14
};

function parseNkrvHtml(html) {
  const divTextMap = {};
  const d2Re = /<div\b[^>]*\bid=['"]?(D_\d+_\d+)['"]?[^>]*>/gi;
  let d2Match;
  while ((d2Match = d2Re.exec(html)) !== null) {
    const divId = d2Match[1];
    const start = d2Re.lastIndex;
    const end = html.indexOf('</div>', start);
    if (end === -1) continue;
    const body = html.slice(start, end);
    const fnText = body
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (fnText) divTextMap[divId] = fnText;
  }

  const footnotes = {};
  // Match either digit or Korean consonant footnote labels in the popup
  // anchor.  Normalize Korean letters to position numbers so the key
  // matches the inline-marker key we'll emit below.
  const popRe = /clickPopUp\('([^']+)'[^)]*\)[^<]*<font[^>]*>([ㄱ-ㅎ\d]+)\)<\/font>/gi;
  let popMatch;
  while ((popMatch = popRe.exec(html)) !== null) {
    const divId = popMatch[1];
    let fnKey = popMatch[2];
    if (/^[ㄱ-ㅎ]+$/.test(fnKey)) {
      const mapped = KO_FN_LETTER_TO_NUM[fnKey];
      if (!mapped) continue;
      fnKey = String(mapped);
    }
    if (fnKey && divId && divTextMap[divId]) footnotes[fnKey] = divTextMap[divId];
  }

  const verses = [];
  const parts = html.split('<span class="number">');
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const numMatch = part.match(/^(\d+(?:-\d+)?)/);
    if (!numMatch) continue;
    const numStr = numMatch[1];
    const num = parseInt(numStr);
    const afterClose = part.replace(/^[\d-]+(?:&nbsp;)+<\/span>/, '');
    const end = afterClose.indexOf('</span>');
    const raw = end > -1 ? afterClose.substring(0, end) : afterClose;
    let text = raw
      .replace(/<font\b[^>]*class=["']smallTitle["'][^>]*>[\s\S]*?<\/font>/gi, '')
      .replace(/<div[^>]*>[\s\S]*?<\/div>/gi, '')
      // Extract footnote markers from bskorea's <a class=comment>...<font>N)</font></a>
      // tags BEFORE the general <a> strip below.  Marker may be digit (1, 2, ...) or
      // Korean consonant (ㄱ, ㄴ, ...); normalize Korean letters to position numbers
      // so the key matches the digit-keyed `footnotes` dict.
      .replace(
        /<a\s+class=["']?comment["']?[^>]*>[\s\S]*?<font[^>]*>([ㄱ-ㅎ\d]+)\)<\/font>[\s\S]*?<\/a>/gi,
        (_, marker) => {
          let key = marker;
          if (/^[ㄱ-ㅎ]+$/.test(key)) {
            const mapped = KO_FN_LETTER_TO_NUM[key];
            if (!mapped) return '';
            key = String(mapped);
          }
          return `(KN:${key})`;
        }
      )
      .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '')
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '')
      .replace(/<p\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
      .replace(/<div\b[^>]*class=["'][^"']*(title|head|heading)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    // Defensive cleanup for any markers that escaped the <a class=comment>
    // pre-processing above (rare, but possible if bskorea ever renders
    // markers as plain text).  Negative lookbehind on the digit regex
    // prevents re-matching the "1)" inside already-emitted "(KN:1)".
    text = text.replace(/([ㄱ-ㅎ])\)\s*/g, (_, ch) => {
      const n = KO_FN_LETTER_TO_NUM[ch];
      return n ? `(KN:${n})` : '';
    });
    text = text.replace(/(?<!\(KN:)(\d+)\)\s*/g, '(KN:$1)');
    // bskorea places footnote anchors BEFORE the annotated word; the marker
    // belongs AFTER the word per Korean Bible convention.  Swap each
    // "(KN:N)WORD" → "WORD(KN:N)" so consumers can render markers inline
    // without further post-processing.
    text = text.replace(/^\(KN:(\d+)\)(\S+)/, '$2(KN:$1)');
    text = text.replace(/(\s)\(KN:(\d+)\)(\S+)/g, '$1$3(KN:$2)');
    const verseLabel = numStr.includes('-') ? numStr : num;
    if (text.length > 1) verses.push({ verse: verseLabel, text });
  }

  return { verses, footnotes };
}

async function fetchChapterFromBskorea(bookNum, chapter) {
  const book = NKRV_CODES[bookNum - 1];
  const url = `https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE&book=${book}&chap=${chapter}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": "https://www.bskorea.or.kr/"
    }
  });
  if (!resp.ok) throw new Error(`bskorea ${resp.status} for ${book} ${chapter}`);
  const html = await resp.text();
  return parseNkrvHtml(html);
}

// Strip (KN:NN) markers from a verse for clean search display.
function cleanForSearch(text) {
  return text.replace(/\(KN:\d+\)/g, '').replace(/\s+/g, ' ').trim();
}

// Convert a chapter's verse array to flat [b, c, v, text] tuples.
function chapterToTuples(bookIdx, chapter, verses) {
  const out = [];
  for (const v of verses) {
    out.push([bookIdx, chapter, v.verse, cleanForSearch(v.text)]);
  }
  return out;
}

// ---- /admin/build-index — builds one phase of the search index ----
// Query params:
//   secret:  must match env.ADMIN_SECRET
//   from:    0-based "chapter ordinal" to start at (default 0)
//   size:    how many chapters to process in this call (default 250)
//   refetch: if "1", re-fetch chapters from bskorea even if KV-cached (slower)
//
// Flat chapter ordinal mapping:
//   ordinal 0       = Genesis 1
//   ordinal 1       = Genesis 2
//   ordinal 50      = Exodus 1
//   ...
//   ordinal 1188    = Revelation 22 (last)  (total: 1189)
//
// Each call writes a chunk to KV key `nkrv_search_chunk_${from}` (so re-running with the same
// `from` overwrites that chunk).  Once all chunks exist, call /admin/merge-index to concatenate.
function ordinalToBookChapter(ordinal) {
  let acc = 0;
  for (let b = 0; b < BOOK_CHAPTERS.length; b++) {
    if (ordinal < acc + BOOK_CHAPTERS[b]) return [b, ordinal - acc + 1];
    acc += BOOK_CHAPTERS[b];
  }
  return null;
}

const TOTAL_CHAPTERS = BOOK_CHAPTERS.reduce((a,b)=>a+b, 0);

async function handleBuildIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  const from = Math.max(0, parseInt(url.searchParams.get('from') || '0'));
  const size = Math.min(400, Math.max(1, parseInt(url.searchParams.get('size') || '250')));
  const refetch = url.searchParams.get('refetch') === '1';
  const concurrency = 12; // parallel fetches per batch

  const tuples = [];
  let fetched = 0, fromCache = 0, errored = 0;
  const errors = [];

  const ordinals = [];
  for (let o = from; o < Math.min(from + size, TOTAL_CHAPTERS); o++) ordinals.push(o);

  // Process in waves to limit concurrency.
  for (let i = 0; i < ordinals.length; i += concurrency) {
    const batch = ordinals.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (ord) => {
      const [bookIdx, chapter] = ordinalToBookChapter(ord);
      const key = `nkrv_${bookIdx + 1}_${chapter}`;
      try {
        let data = null;
        if (!refetch && env.COMMENTARY_KV) {
          const cached = await env.COMMENTARY_KV.get(key);
          if (cached) {
            data = JSON.parse(cached);
            fromCache++;
          }
        }
        if (!data) {
          data = await fetchChapterFromBskorea(bookIdx + 1, chapter);
          if (env.COMMENTARY_KV) await env.COMMENTARY_KV.put(key, JSON.stringify(data));
          fetched++;
        }
        const verses = Array.isArray(data) ? data : (data.verses || []);
        return chapterToTuples(bookIdx, chapter, verses);
      } catch (e) {
        errored++;
        errors.push({ord, bookIdx, chapter, msg: String(e.message || e)});
        return [];
      }
    }));
    for (const r of results) for (const t of r) tuples.push(t);
  }

  // Write the chunk under a key that encodes the starting ordinal.  Pad so lex order matches numeric.
  const chunkKey = `nkrv_search_chunk_${String(from).padStart(5, '0')}`;
  if (env.COMMENTARY_KV) {
    await env.COMMENTARY_KV.put(chunkKey, JSON.stringify(tuples));
  }

  const nextFrom = from + size;
  const done = nextFrom >= TOTAL_CHAPTERS;
  return new Response(JSON.stringify({
    ok: true,
    chunkKey,
    processedOrdinals: ordinals.length,
    verseCount: tuples.length,
    fetchedFromBskorea: fetched,
    fromKvCache: fromCache,
    errored,
    errors: errors.slice(0, 10),
    nextFrom: done ? null : nextFrom,
    nextUrl: done ? null : `/admin/build-index?secret=...&from=${nextFrom}&size=${size}`,
    totalChapters: TOTAL_CHAPTERS,
    done
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

async function handleMergeIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.COMMENTARY_KV) return new Response(JSON.stringify({error:'no_kv'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});

  // List all chunk keys.
  const chunks = [];
  let cursor = undefined;
  let safety = 0;
  while (true) {
    const list = await env.COMMENTARY_KV.list({ prefix: 'nkrv_search_chunk_', cursor, limit: 1000 });
    for (const k of list.keys) chunks.push(k.name);
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
    if (++safety > 50) break;
  }
  chunks.sort();

  if (chunks.length === 0) {
    return new Response(JSON.stringify({error:'no_chunks', hint:'run /admin/build-index first'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
  }

  const merged = [];
  for (const key of chunks) {
    const raw = await env.COMMENTARY_KV.get(key);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw);
      for (const t of arr) merged.push(t);
    } catch (e) { /* skip */ }
  }

  const payload = JSON.stringify(merged);
  await env.COMMENTARY_KV.put('nkrv_search_index', payload);

  // Bust the per-isolate cache (this isolate at least).
  SEARCH_INDEX = null;
  SEARCH_INDEX_PROMISE = null;

  return new Response(JSON.stringify({
    ok: true,
    chunksRead: chunks.length,
    totalVerses: merged.length,
    indexBytes: payload.length,
    storedAt: 'nkrv_search_index'
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

// Wipe every cached api.bible chapter in KV, plus the related index chunks and
// flat index for the scope.  Exists for compliance with api.bible's 72-hour
// deletion rule on termination and as a manual reset.  Protected by ADMIN_SECRET.
async function handleWipeApiBibleCache(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.COMMENTARY_KV) return new Response(JSON.stringify({error:'no_kv'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});

  const tId = url.searchParams.get('translationId') || null;
  const prefixes = [];
  if (tId) {
    prefixes.push(`apibible_raw_${tId}_`);
    prefixes.push(`apibible_search_chunk_${tId}_`);
  } else {
    prefixes.push('apibible_raw_');
    prefixes.push('apibible_search_chunk_');
  }

  let deleted = 0;
  for (const prefix of prefixes) {
    let cursor = undefined, safety = 0;
    while (true) {
      const list = await env.COMMENTARY_KV.list({ prefix, cursor, limit: 1000 });
      for (const k of list.keys) {
        await env.COMMENTARY_KV.delete(k.name);
        deleted++;
      }
      if (list.list_complete || !list.cursor) break;
      cursor = list.cursor;
      if (++safety > 100) break;
    }
  }

  // Also delete the merged flat index(es).
  if (tId) {
    await env.COMMENTARY_KV.delete(`apibible_search_index_${tId}`);
    APIBIBLE_INDEXES[tId] = null;
    APIBIBLE_INDEX_PROMISES[tId] = null;
  } else {
    for (const id of Object.keys(API_BIBLE_TRANSLATIONS)) {
      await env.COMMENTARY_KV.delete(`apibible_search_index_${id}`);
      APIBIBLE_INDEXES[id] = null;
      APIBIBLE_INDEX_PROMISES[id] = null;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    deleted,
    prefixes,
    scope: tId ? `translation=${tId}` : 'all api.bible cache + indexes'
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

async function handleIndexStatus(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.COMMENTARY_KV) return new Response(JSON.stringify({error:'no_kv'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});

  const idx = await env.COMMENTARY_KV.get('nkrv_search_index');
  let indexInfo = null;
  if (idx) {
    try {
      const arr = JSON.parse(idx);
      indexInfo = { verses: arr.length, bytes: idx.length };
    } catch (e) {
      indexInfo = { verses: 0, bytes: idx.length, parseError: true };
    }
  }

  // Count chunks.
  let chunkCount = 0;
  let cursor = undefined;
  let safety = 0;
  while (true) {
    const list = await env.COMMENTARY_KV.list({ prefix: 'nkrv_search_chunk_', cursor, limit: 1000 });
    chunkCount += list.keys.length;
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
    if (++safety > 50) break;
  }

  // EN index info.
  const enIdx = await env.COMMENTARY_KV.get('esv_search_index');
  let enIndexInfo = null;
  if (enIdx) {
    try {
      const arr = JSON.parse(enIdx);
      enIndexInfo = { verses: arr.length, bytes: enIdx.length };
    } catch (e) {
      enIndexInfo = { verses: 0, bytes: enIdx.length, parseError: true };
    }
  }
  let enChunkCount = 0;
  let cursor2 = undefined;
  let safety2 = 0;
  while (true) {
    const list = await env.COMMENTARY_KV.list({ prefix: 'esv_search_chunk_', cursor: cursor2, limit: 1000 });
    enChunkCount += list.keys.length;
    if (list.list_complete || !list.cursor) break;
    cursor2 = list.cursor;
    if (++safety2 > 50) break;
  }

  // api.bible state — per translation: cached chapter count + chunk count + index status.
  const apiBibleDetail = {};
  for (const tid of Object.keys(API_BIBLE_TRANSLATIONS)) {
    const abbr = API_BIBLE_TRANSLATIONS[tid].abbreviation;
    // Count cached raw chapters.
    let rawCount = 0, cursor3 = undefined, safety3 = 0;
    while (true) {
      const list = await env.COMMENTARY_KV.list({ prefix: `apibible_raw_${tid}_`, cursor: cursor3, limit: 1000 });
      rawCount += list.keys.length;
      if (list.list_complete || !list.cursor) break;
      cursor3 = list.cursor;
      if (++safety3 > 10) break;
    }
    // Count search chunks.
    let chunkCt = 0, cursor4 = undefined, safety4 = 0;
    while (true) {
      const list = await env.COMMENTARY_KV.list({ prefix: `apibible_search_chunk_${tid}_`, cursor: cursor4, limit: 1000 });
      chunkCt += list.keys.length;
      if (list.list_complete || !list.cursor) break;
      cursor4 = list.cursor;
      if (++safety4 > 10) break;
    }
    // Check merged index.
    const idx = await env.COMMENTARY_KV.get(`apibible_search_index_${tid}`);
    let indexInfo = null;
    if (idx) {
      try {
        const arr = JSON.parse(idx);
        indexInfo = { verses: arr.length, bytes: idx.length };
      } catch (e) {
        indexInfo = { verses: 0, bytes: idx.length, parseError: true };
      }
    }
    apiBibleDetail[abbr] = {
      translationId: tid,
      cachedChapters: rawCount,
      searchChunks: chunkCt,
      index: indexInfo,
      moduleCache: { loaded: !!APIBIBLE_INDEXES[tid], verses: APIBIBLE_INDEXES[tid] ? APIBIBLE_INDEXES[tid].length : 0 }
    };
  }
  const apiBibleCounts = { _total: 0 };
  for (const abbr of Object.keys(apiBibleDetail)) {
    apiBibleCounts[abbr] = apiBibleDetail[abbr].cachedChapters;
    apiBibleCounts._total += apiBibleDetail[abbr].cachedChapters;
  }

  return new Response(JSON.stringify({
    ko: {
      index: indexInfo,
      chunkCount,
      moduleCache: { loaded: !!SEARCH_INDEX, verses: SEARCH_INDEX ? SEARCH_INDEX.length : 0 }
    },
    en: {
      index: enIndexInfo,
      chunkCount: enChunkCount,
      moduleCache: { loaded: !!EN_SEARCH_INDEX, verses: EN_SEARCH_INDEX ? EN_SEARCH_INDEX.length : 0 }
    },
    apibible: {
      cachedChapters: apiBibleCounts,
      ttlSeconds: API_BIBLE_CACHE_TTL,
      perTranslation: apiBibleDetail,
      translations: Object.fromEntries(
        Object.entries(API_BIBLE_TRANSLATIONS).map(([id, t]) => [t.abbreviation, id])
      )
    },
    totalChapters: TOTAL_CHAPTERS
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

// ---- /search/en — fast in-memory search over the pre-built ESV index ----
async function handleEnglishSearch(env, url, cors) {
  const q = url.searchParams.get('q');
  // Pagination: ESV-style "page" param (1-based), 20 per page, for backward compat with the client.
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  if (!q || q.trim().length < 2) {
    return new Response(JSON.stringify({results:[], hasMore:false}), {headers:{...cors,'Content-Type':'application/json'}});
  }

  const index = await getEnSearchIndex(env);
  if (!index) {
    return new Response(JSON.stringify({
      results: [],
      hasMore: false,
      error: 'index_not_built',
      hint: 'Run /admin/build-en-index then /admin/merge-en-index'
    }), {status:503, headers:{...cors,'Content-Type':'application/json'}});
  }

  // Case-insensitive substring filter.
  const term = q.trim().toLowerCase();
  const matches = [];
  for (let i = 0; i < index.length; i++) {
    const t = index[i][3];
    if (t.toLowerCase().indexOf(term) !== -1) matches.push(index[i]);
  }

  const slice = matches.slice(offset, offset + pageSize);
  const results = slice.map(([b, c, v, text]) => ({
    book: b,
    chapter: c,
    verse: v,
    text,
    ref: BOOK_NAMES_EN[b] + ' ' + c + ':' + v
  }));
  const hasMore = (offset + pageSize) < matches.length;

  // Count unique books across all matches (for a results-overview header on the client).
  const bookSet = new Set();
  for (const m of matches) bookSet.add(m[0]);

  return new Response(JSON.stringify({
    results,
    hasMore,
    nextPage: hasMore ? (page + 1) : -1,
    total: matches.length,
    bookCount: bookSet.size
  }), {headers:{...cors,'Content-Type':'application/json'}});
}

// ---- api.bible chapter handler ----
// Route: GET /apibible/{translationId}/{bookNum}/{chapter}
//   - translationId must be in API_BIBLE_TRANSLATIONS whitelist
//   - bookNum is 1-66 (matches BOOKS array indexing)
//   - chapter is the integer chapter number
// Returns: { data: {...api.bible chapter data}, meta: {...api.bible meta},
//   fumsToken: string|null, cached: bool, translation: {abbreviation, name} }
//
// Cache strategy:
//   - 30-day TTL per the api.bible policy (cached content must be refreshed every 30 days)
//   - Key: apibible_raw_{translationId}_{usfmCode}.{chapter}
//   - Cached entries omit the FUMS token (each fresh API call gets its own token; cached reads
//     fire FUMS without a token, per the FUMS spec for previously-fetched content).
async function handleApiBibleChapter(env, url, cors, translationId, bookNum, chapter) {
  // Validate authorization
  const translation = API_BIBLE_TRANSLATIONS[translationId];
  if (!translation) {
    return new Response(JSON.stringify({error: 'translation_not_authorized', translationId}), {
      status: 403, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
    });
  }
  // Validate book/chapter
  const bookIdx = bookNum - 1;
  if (bookIdx < 0 || bookIdx >= USFM_CODES.length) {
    return new Response(JSON.stringify({error: 'bad_book', bookNum}), {
      status: 400, headers: {...cors, 'Content-Type': 'application/json'}
    });
  }
  if (chapter < 1 || chapter > BOOK_CHAPTERS[bookIdx]) {
    return new Response(JSON.stringify({error: 'bad_chapter', book: USFM_CODES[bookIdx], chapter, max: BOOK_CHAPTERS[bookIdx]}), {
      status: 400, headers: {...cors, 'Content-Type': 'application/json'}
    });
  }
  if (!env.API_BIBLE_KEY) {
    return new Response(JSON.stringify({error: 'api_bible_key_unset'}), {
      status: 503, headers: {...cors, 'Content-Type': 'application/json'}
    });
  }

  const usfmCode = USFM_CODES[bookIdx];
  const chapterId = `${usfmCode}.${chapter}`;
  const cacheKey = `apibible_raw_${translationId}_${chapterId}`;

  // no-store on the response so browsers and edge don't keep their own copies.
  // Our KV is the canonical cache, and a stale entry in the browser would prevent
  // us from honoring api.bible's 30-day refresh + 24-hour update-on-request rules.
  const respHeaders = {
    ...cors,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, must-revalidate'
  };

  // Try KV cache first
  if (env.COMMENTARY_KV) {
    const cached = await env.COMMENTARY_KV.get(cacheKey, 'json');
    if (cached) {
      return new Response(JSON.stringify({
        data: cached.data,
        meta: cached.meta || {},
        fumsToken: null, // never reuse a stored FUMS token; cached reads fire FUMS without one
        cached: true,
        translation
      }), { headers: respHeaders });
    }
  }

  // Fetch fresh from api.bible
  // Query params per api.bible /v1/bibles/{id}/chapters/{chapterId} spec.
  // NOTE: do NOT include `use-org-id` here — that param belongs to the verses
  // endpoint and api.bible 400s on it for chapters.
  const params = new URLSearchParams({
    'content-type': 'text',
    'include-notes': 'false',
    'include-titles': 'false',
    'include-chapter-numbers': 'false',
    'include-verse-numbers': 'true',
    'include-verse-spans': 'false'
  });
  const apiUrl = `https://rest.api.bible/v1/bibles/${translationId}/chapters/${chapterId}?${params}`;

  const resp = await fetch(apiUrl, { headers: { 'api-key': env.API_BIBLE_KEY } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return new Response(JSON.stringify({error: 'apibible_status_' + resp.status, body: body.slice(0, 500)}), {
      status: 502, headers: respHeaders
    });
  }
  const apiData = await resp.json();
  if (!apiData?.data?.content) {
    return new Response(JSON.stringify({error: 'apibible_empty_response', apiData}), {
      status: 502, headers: respHeaders
    });
  }

  // Persist to KV with 30-day TTL.  We store only data + meta — NOT the FUMS token,
  // since FUMS tokens are per-request and shouldn't be replayed from cache.
  if (env.COMMENTARY_KV) {
    const toStore = JSON.stringify({ data: apiData.data, meta: apiData.meta || {} });
    await env.COMMENTARY_KV.put(cacheKey, toStore, { expirationTtl: API_BIBLE_CACHE_TTL });
  }

  // FUMS token from api.bible's response — front-end will ping fums.api.bible/f3 with it
  const fumsToken = apiData.meta?.fums || apiData.meta?.fumsId || null;

  return new Response(JSON.stringify({
    data: apiData.data,
    meta: apiData.meta || {},
    fumsToken,
    cached: false,
    translation
  }), { headers: respHeaders });
}

// ---- /search/apibible/{translationId}?q=...&page=... ----
// Per-translation full-text search.  Prefers the pre-built flat index in KV
// (instant) and falls back to api.bible's live search endpoint when the index
// isn't built yet.  Once the index is built, this path makes ZERO api.bible
// calls per query — same property as /search/en for ESV.
async function handleApiBibleSearch(env, url, cors, translationId) {
  const translation = API_BIBLE_TRANSLATIONS[translationId];
  if (!translation) {
    return new Response(JSON.stringify({error: 'translation_not_authorized'}), {
      status: 403, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
    });
  }
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return new Response(JSON.stringify({results: [], hasMore: false}), {
      headers: {...cors, 'Content-Type': 'application/json'}
    });
  }
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const respHeaders = {
    ...cors,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, must-revalidate'
  };

  // -- Fast path: pre-built flat index --
  const index = await getApiBibleSearchIndex(env, translationId);
  if (index) {
    const term = q.trim().toLowerCase();
    const matches = [];
    for (let i = 0; i < index.length; i++) {
      const t = index[i][3];
      if (t.toLowerCase().indexOf(term) !== -1) matches.push(index[i]);
    }
    const slice = matches.slice(offset, offset + pageSize);
    const results = slice.map(([b, c, v, text]) => ({
      book: b,
      chapter: c,
      verse: v,
      text,
      ref: `${BOOK_NAMES_EN[b]} ${c}:${v}`
    }));
    const hasMore = (offset + pageSize) < matches.length;
    const bookSet = new Set();
    for (const m of matches) bookSet.add(m[0]);
    return new Response(JSON.stringify({
      results,
      hasMore,
      nextPage: hasMore ? (page + 1) : -1,
      total: matches.length,
      bookCount: bookSet.size,
      fumsToken: null, // indexed reads don't consume new FUMS tokens
      translation: translation.abbreviation,
      source: 'index'
    }), { headers: respHeaders });
  }

  // -- Fallback: live api.bible search (used until the index is built) --
  if (!env.API_BIBLE_KEY) {
    return new Response(JSON.stringify({error: 'api_bible_key_unset'}), {
      status: 503, headers: respHeaders
    });
  }
  const params = new URLSearchParams({
    query: q.trim(),
    limit: String(pageSize),
    offset: String(offset)
  });
  const apiUrl = `https://rest.api.bible/v1/bibles/${translationId}/search?${params}`;
  const resp = await fetch(apiUrl, { headers: { 'api-key': env.API_BIBLE_KEY } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return new Response(JSON.stringify({error: 'apibible_search_status_' + resp.status, body: body.slice(0, 300)}), {
      status: 502, headers: respHeaders
    });
  }
  const data = await resp.json();
  const apiVerses = data?.data?.verses || [];
  const results = [];
  const bookSet = new Set();
  for (const v of apiVerses) {
    const bookIdx = USFM_CODES.indexOf(v.bookId);
    if (bookIdx < 0) continue;
    const m = String(v.id).match(/^[A-Z0-9]+\.(\d+)\.(\d+)/);
    if (!m) continue;
    const chapter = parseInt(m[1]);
    const verse = parseInt(m[2]);
    results.push({
      book: bookIdx,
      chapter,
      verse,
      text: v.text,
      ref: v.reference || `${BOOK_NAMES_EN[bookIdx]} ${chapter}:${verse}`
    });
    bookSet.add(bookIdx);
  }
  const total = data?.data?.total || results.length;
  const hasMore = (offset + pageSize) < total;
  const fumsToken = data?.meta?.fums || data?.meta?.fumsId || null;
  return new Response(JSON.stringify({
    results,
    hasMore,
    nextPage: hasMore ? (page + 1) : -1,
    total,
    bookCount: bookSet.size,
    fumsToken,
    translation: translation.abbreviation,
    source: 'live'
  }), { headers: respHeaders });
}

// ---- api.bible chapter content parser (text format with [N] / [N-M] markers) ----
// Returns [{verse: N, text: '...'}].  For grouped verses [N-M], stores the text
// once under the first verse number (M-N other verses get no entry — matches
// the front-end "↑ continued above" approach for display consistency).
function parseApiBibleChapterContent(content) {
  if (!content) return [];
  const out = [];
  const segments = content.split(/(?=\[\d+(?:-\d+)?\])/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^\[(\d+)(?:-\d+)?\]\s*([\s\S]*)/);
    if (!m) continue;
    const verseStart = parseInt(m[1]);
    let text = m[2].replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    out.push({ verse: verseStart, text });
  }
  return out;
}

async function getApiBibleSearchIndex(env, translationId) {
  if (APIBIBLE_INDEXES[translationId]) return APIBIBLE_INDEXES[translationId];
  if (APIBIBLE_INDEX_PROMISES[translationId]) return APIBIBLE_INDEX_PROMISES[translationId];
  APIBIBLE_INDEX_PROMISES[translationId] = (async () => {
    const key = `apibible_search_index_${translationId}`;
    const raw = await env.COMMENTARY_KV.get(key);
    if (!raw) {
      APIBIBLE_INDEX_PROMISES[translationId] = null;
      return null;
    }
    try {
      APIBIBLE_INDEXES[translationId] = JSON.parse(raw);
    } catch (e) {
      APIBIBLE_INDEXES[translationId] = null;
    }
    APIBIBLE_INDEX_PROMISES[translationId] = null;
    return APIBIBLE_INDEXES[translationId];
  })();
  return APIBIBLE_INDEX_PROMISES[translationId];
}

// Fetch a chapter directly from api.bible for index building.  Returns the
// parsed [{verse, text}] list, or throws on failure.  Used both by the live
// chapter handler (via cache) and by the index builder.  Includes a small
// 429-aware retry like fetchChapterFromEsv.
async function fetchChapterFromApiBible(translationId, usfmCode, chapter, env) {
  const chapterId = `${usfmCode}.${chapter}`;
  const params = new URLSearchParams({
    'content-type': 'text',
    'include-notes': 'false',
    'include-titles': 'false',
    'include-chapter-numbers': 'false',
    'include-verse-numbers': 'true',
    'include-verse-spans': 'false'
  });
  const apiUrl = `https://rest.api.bible/v1/bibles/${translationId}/chapters/${chapterId}?${params}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(apiUrl, { headers: { 'api-key': env.API_BIBLE_KEY } });
    if (resp.ok) {
      const data = await resp.json();
      if (!data?.data?.content) throw new Error(`empty content for ${chapterId}`);
      return { data: data.data, meta: data.meta || {} };
    }
    if (resp.status === 429) {
      const wait = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s, 8s
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const body = await resp.text().catch(() => '');
    throw new Error(`status ${resp.status} for ${chapterId}: ${body.slice(0, 200)}`);
  }
  throw new Error(`429 retries exhausted for ${chapterId}`);
}

// Walk a slice of the canonical chapter ordinals and either reuse the cached
// chapter or call api.bible.  Writes a flat-tuple chunk to KV.  Mirrors
// handleBuildEnIndex but is per-translation.
async function handleBuildApiBibleIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  const translationId = url.searchParams.get('translationId');
  if (!translationId || !API_BIBLE_TRANSLATIONS[translationId]) {
    return new Response(JSON.stringify({
      error: 'translation_required',
      hint: 'Pass &translationId={id}',
      authorized: Object.fromEntries(Object.entries(API_BIBLE_TRANSLATIONS).map(([k,v])=>[v.abbreviation,k]))
    }), {status:400, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.API_BIBLE_KEY) {
    return new Response(JSON.stringify({error:'api_bible_key_unset'}), {status:503, headers:{...cors,'Content-Type':'application/json'}});
  }

  const from = Math.max(0, parseInt(url.searchParams.get('from') || '0'));
  const size = Math.min(400, Math.max(1, parseInt(url.searchParams.get('size') || '250')));
  const refetch = url.searchParams.get('refetch') === '1';
  const concurrency = 2; // be polite to api.bible

  const tuples = [];
  let fetched = 0, fromCache = 0, errored = 0;
  const errors = [];

  const ordinals = [];
  for (let o = from; o < Math.min(from + size, TOTAL_CHAPTERS); o++) ordinals.push(o);

  for (let i = 0; i < ordinals.length; i += concurrency) {
    const batch = ordinals.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (ord) => {
      const [bookIdx, chapter] = ordinalToBookChapter(ord);
      const usfm = USFM_CODES[bookIdx];
      const chapterId = `${usfm}.${chapter}`;
      const cacheKey = `apibible_raw_${translationId}_${chapterId}`;
      try {
        let chapterPayload = null;
        if (!refetch && env.COMMENTARY_KV) {
          const cached = await env.COMMENTARY_KV.get(cacheKey, 'json');
          if (cached) { chapterPayload = cached; fromCache++; }
        }
        if (!chapterPayload) {
          chapterPayload = await fetchChapterFromApiBible(translationId, usfm, chapter, env);
          if (env.COMMENTARY_KV) {
            // Store WITHOUT the FUMS token; same shape as the on-demand chapter handler.
            const toStore = JSON.stringify({ data: chapterPayload.data, meta: chapterPayload.meta });
            await env.COMMENTARY_KV.put(cacheKey, toStore, { expirationTtl: API_BIBLE_CACHE_TTL });
          }
          fetched++;
        }
        const verses = parseApiBibleChapterContent(chapterPayload.data.content);
        return verses.map(v => [bookIdx, chapter, v.verse, v.text]);
      } catch (e) {
        errored++;
        errors.push({ ord, bookIdx, chapter, chapterId, msg: String(e.message || e) });
        return [];
      }
    }));
    for (const r of results) for (const t of r) tuples.push(t);
  }

  const chunkKey = `apibible_search_chunk_${translationId}_${String(from).padStart(5, '0')}`;
  if (env.COMMENTARY_KV) {
    await env.COMMENTARY_KV.put(chunkKey, JSON.stringify(tuples));
  }

  const nextFrom = from + size;
  const done = nextFrom >= TOTAL_CHAPTERS;
  return new Response(JSON.stringify({
    ok: true,
    translation: API_BIBLE_TRANSLATIONS[translationId].abbreviation,
    chunkKey,
    processedOrdinals: ordinals.length,
    verseCount: tuples.length,
    fetchedFromApi: fetched,
    fromKvCache: fromCache,
    errored,
    errors: errors.slice(0, 10),
    nextFrom: done ? null : nextFrom,
    nextUrl: done ? null : `/admin/build-apibible-index?secret=...&translationId=${translationId}&from=${nextFrom}&size=${size}`,
    totalChapters: TOTAL_CHAPTERS,
    done
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

async function handleMergeApiBibleIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.COMMENTARY_KV) return new Response(JSON.stringify({error:'no_kv'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});
  const translationId = url.searchParams.get('translationId');
  if (!translationId || !API_BIBLE_TRANSLATIONS[translationId]) {
    return new Response(JSON.stringify({error:'translation_required'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
  }

  const chunkPrefix = `apibible_search_chunk_${translationId}_`;
  const chunks = [];
  let cursor = undefined;
  let safety = 0;
  while (true) {
    const list = await env.COMMENTARY_KV.list({ prefix: chunkPrefix, cursor, limit: 1000 });
    for (const k of list.keys) chunks.push(k.name);
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
    if (++safety > 50) break;
  }
  chunks.sort();

  if (chunks.length === 0) {
    return new Response(JSON.stringify({error:'no_chunks', hint:'run /admin/build-apibible-index first'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
  }

  const merged = [];
  for (const key of chunks) {
    const raw = await env.COMMENTARY_KV.get(key);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw);
      for (const t of arr) merged.push(t);
    } catch (e) { /* skip */ }
  }

  const indexKey = `apibible_search_index_${translationId}`;
  const payload = JSON.stringify(merged);
  await env.COMMENTARY_KV.put(indexKey, payload);

  APIBIBLE_INDEXES[translationId] = null;
  APIBIBLE_INDEX_PROMISES[translationId] = null;

  return new Response(JSON.stringify({
    ok: true,
    translation: API_BIBLE_TRANSLATIONS[translationId].abbreviation,
    chunksRead: chunks.length,
    totalVerses: merged.length,
    indexBytes: payload.length,
    storedAt: indexKey
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

// ---- ESV chapter fetch + parse for the English index ----
// Returns { verses: [{verse: N, text: '...'}], headings: {} }.
function parseEsvPassageText(passage) {
  if (!passage) return [];
  const lines = passage.split('\n');
  const passageLines = [];
  let inFn = false;
  for (const l of lines) {
    if (!inFn && /^\s*Footnotes?\s*$/i.test(l)) { inFn = true; continue; }
    if (!inFn) passageLines.push(l);
  }
  const joined = passageLines.join(' ');
  const verses = [];
  // Split on [N] verse markers.  First chunk before any [N] is heading/intro — discard.
  const segments = joined.split(/(?=\[\d+\])/);
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) continue;
    const m = s.match(/^\[(\d+)\]\s*([\s\S]*)/);
    if (!m) continue;
    const num = parseInt(m[1]);
    let text = m[2]
      .replace(/\s+/g, ' ')
      .replace(/\s*Footnotes?\s*$/i, '')
      .trim();
    if (text.length > 1) verses.push({ verse: num, text });
  }
  return verses;
}

async function fetchChapterFromEsv(bookNum, chapter, env) {
  const book = BOOK_NAMES_EN[bookNum - 1];
  // Ask for the entire chapter; ESV understands "Genesis 1" form.
  const q = book + ' ' + chapter;
  const esvUrl = 'https://api.esv.org/v3/passage/text/?q=' + encodeURIComponent(q)
    + '&include-headings=false&include-footnotes=false&include-verse-numbers=true'
    + '&include-short-copyright=false&include-passage-references=false'
    + '&indent-paragraphs=0&indent-poetry=false&include-chapter-numbers=false'
    + '&indent-psalm-doxology=false&line-length=0';
  // Retry on 429 with exponential backoff.  ESV is conservative on burst rate.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(esvUrl, { headers: { Authorization: 'Token ' + env.ESV_TOKEN } });
    if (resp.ok) {
      const data = await resp.json();
      if (!data.passages || !data.passages[0]) throw new Error(`No passage for ${q}`);
      return parseEsvPassageText(data.passages[0]);
    }
    if (resp.status === 429) {
      const wait = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s, 8s
      await new Promise(r => setTimeout(r, wait));
      lastErr = `ESV 429 for ${q}`;
      continue;
    }
    throw new Error(`ESV ${resp.status} for ${q}`);
  }
  throw new Error(lastErr || `ESV retries exhausted for ${q}`);
}

function enChapterToTuples(bookIdx, chapter, verses) {
  const out = [];
  for (const v of verses) {
    out.push([bookIdx, chapter, v.verse, v.text]);
  }
  return out;
}

async function handleBuildEnIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  const from = Math.max(0, parseInt(url.searchParams.get('from') || '0'));
  const size = Math.min(400, Math.max(1, parseInt(url.searchParams.get('size') || '250')));
  const refetch = url.searchParams.get('refetch') === '1';
  const concurrency = 2; // be polite to ESV API — they rate-limit aggressively on burst

  const tuples = [];
  let fetched = 0, fromCache = 0, errored = 0;
  const errors = [];

  const ordinals = [];
  for (let o = from; o < Math.min(from + size, TOTAL_CHAPTERS); o++) ordinals.push(o);

  for (let i = 0; i < ordinals.length; i += concurrency) {
    const batch = ordinals.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (ord) => {
      const [bookIdx, chapter] = ordinalToBookChapter(ord);
      const key = `esv_${bookIdx + 1}_${chapter}`;
      try {
        let verses = null;
        if (!refetch && env.COMMENTARY_KV) {
          const cached = await env.COMMENTARY_KV.get(key);
          if (cached) {
            verses = JSON.parse(cached);
            fromCache++;
          }
        }
        if (!verses) {
          verses = await fetchChapterFromEsv(bookIdx + 1, chapter, env);
          if (env.COMMENTARY_KV) await env.COMMENTARY_KV.put(key, JSON.stringify(verses));
          fetched++;
        }
        return enChapterToTuples(bookIdx, chapter, verses);
      } catch (e) {
        errored++;
        errors.push({ord, bookIdx, chapter, msg: String(e.message || e)});
        return [];
      }
    }));
    for (const r of results) for (const t of r) tuples.push(t);
  }

  const chunkKey = `esv_search_chunk_${String(from).padStart(5, '0')}`;
  if (env.COMMENTARY_KV) {
    await env.COMMENTARY_KV.put(chunkKey, JSON.stringify(tuples));
  }

  const nextFrom = from + size;
  const done = nextFrom >= TOTAL_CHAPTERS;
  return new Response(JSON.stringify({
    ok: true,
    chunkKey,
    processedOrdinals: ordinals.length,
    verseCount: tuples.length,
    fetchedFromEsv: fetched,
    fromKvCache: fromCache,
    errored,
    errors: errors.slice(0, 10),
    nextFrom: done ? null : nextFrom,
    nextUrl: done ? null : `/admin/build-en-index?secret=...&from=${nextFrom}&size=${size}`,
    totalChapters: TOTAL_CHAPTERS,
    done
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

async function handleMergeEnIndex(env, url, cors) {
  const secret = url.searchParams.get('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({error:'forbidden'}), {status:403, headers:{...cors,'Content-Type':'application/json'}});
  }
  if (!env.COMMENTARY_KV) return new Response(JSON.stringify({error:'no_kv'}), {status:500, headers:{...cors,'Content-Type':'application/json'}});

  const chunks = [];
  let cursor = undefined;
  let safety = 0;
  while (true) {
    const list = await env.COMMENTARY_KV.list({ prefix: 'esv_search_chunk_', cursor, limit: 1000 });
    for (const k of list.keys) chunks.push(k.name);
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
    if (++safety > 50) break;
  }
  chunks.sort();

  if (chunks.length === 0) {
    return new Response(JSON.stringify({error:'no_chunks', hint:'run /admin/build-en-index first'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
  }

  const merged = [];
  for (const key of chunks) {
    const raw = await env.COMMENTARY_KV.get(key);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw);
      for (const t of arr) merged.push(t);
    } catch (e) { /* skip */ }
  }

  const payload = JSON.stringify(merged);
  await env.COMMENTARY_KV.put('esv_search_index', payload);

  EN_SEARCH_INDEX = null;
  EN_SEARCH_INDEX_PROMISE = null;

  return new Response(JSON.stringify({
    ok: true,
    chunksRead: chunks.length,
    totalVerses: merged.length,
    indexBytes: payload.length,
    storedAt: 'esv_search_index'
  }, null, 2), {headers:{...cors,'Content-Type':'application/json'}});
}

// ---- /search/ko — fast in-memory search over the pre-built index ----
async function handleKoreanSearch(env, url, cors) {
  const q = url.searchParams.get('q');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const pageSize = 20;
  if (!q || q.trim().length < 1) {
    return new Response(JSON.stringify({results:[], hasMore:false}), {headers:{...cors,'Content-Type':'application/json'}});
  }

  const index = await getSearchIndex(env);
  if (!index) {
    // Fall back to a clear error rather than silently scanning KV.  This makes index-build status visible.
    return new Response(JSON.stringify({
      results: [],
      hasMore: false,
      error: 'index_not_built',
      hint: 'Run /admin/build-index then /admin/merge-index'
    }), {status:503, headers:{...cors,'Content-Type':'application/json'}});
  }

  const term = q.trim();
  const matches = [];
  // Linear filter.  ~31k verses, includes() is fast.
  for (let i = 0; i < index.length; i++) {
    const t = index[i][3];
    if (t.indexOf(term) !== -1) matches.push(index[i]);
  }

  const slice = matches.slice(offset, offset + pageSize);
  const results = slice.map(([b, c, v, text]) => ({
    book: b,
    chapter: c,
    verse: v,
    text,
    ref: BOOK_NAMES_KO[b] + ' ' + c + ':' + v
  }));
  const hasMore = (offset + pageSize) < matches.length;
  const bookSet = new Set();
  for (const m of matches) bookSet.add(m[0]);
  return new Response(JSON.stringify({
    results,
    hasMore,
    nextOffset: hasMore ? (offset + pageSize) : -1,
    total: matches.length,
    bookCount: bookSet.size
  }), {headers:{...cors,'Content-Type':'application/json'}});
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=86400"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- ESV passthrough ----
    if (path.startsWith('/esv/')) {
      const q = url.searchParams.get('q');
      if (!q) return new Response(JSON.stringify({error:'missing q'}), {status:400, headers:{...cors,"Content-Type":"application/json"}});

      // Headers used on every /esv/ response.  no-store keeps browsers (and
      // Cloudflare edge) from caching, because our KV layer is the canonical
      // cache and any previously-cached error responses must NOT linger.
      const respHeaders = {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "no-store, must-revalidate"
      };

      // Cache forever per query — ESV text is static.  Key is the raw q string.
      const cacheKey = 'esv_raw_' + q;
      if (env.COMMENTARY_KV) {
        const cached = await env.COMMENTARY_KV.get(cacheKey);
        if (cached) return new Response(cached, { headers: respHeaders });
      }

      const esvUrl = 'https://api.esv.org/v3/passage/text/?q=' + encodeURIComponent(q)
        + '&include-headings=false&include-footnotes=true&include-verse-numbers=true'
        + '&include-short-copyright=false&include-passage-references=false'
        + '&indent-paragraphs=0&indent-poetry=false&include-chapter-numbers=false'
        + '&indent-psalm-doxology=false&line-length=0';

      // Retry on 429 with exponential backoff.  ESV sometimes returns 200 OK
      // with a {"detail":"Request was throttled..."} body — treat that as a
      // throttle too and retry, so a soft-throttle doesn't leak to the client.
      let data = null, lastStatus = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        const esvResp = await fetch(esvUrl, { headers: { Authorization: 'Token ' + env.ESV_TOKEN } });
        lastStatus = esvResp.status;
        if (esvResp.ok) {
          const parsed = await esvResp.json();
          // Soft-throttle detection: 200 OK but no passages, has detail/error.
          if (!parsed.passages || !parsed.passages[0]) {
            if (parsed.detail || parsed.error || parsed.message) {
              const wait = 500 * Math.pow(2, attempt);
              await new Promise(r => setTimeout(r, wait));
              continue;
            }
          }
          data = parsed;
          break;
        }
        if (esvResp.status === 429) {
          const wait = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s, 8s
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        // Non-429 error — surface it.
        const body = await esvResp.text();
        return new Response(JSON.stringify({error: 'esv_status_' + esvResp.status, body}), {
          status: 502, headers: respHeaders
        });
      }
      if (!data || !data.passages || !data.passages[0]) {
        return new Response(JSON.stringify({error: 'esv_throttled', lastStatus, q}), {
          status: 503, headers: respHeaders
        });
      }

      // Only cache real passage data (not error responses leaking through).
      const body = JSON.stringify(data);
      if (env.COMMENTARY_KV) {
        await env.COMMENTARY_KV.put(cacheKey, body);
      }
      return new Response(body, { headers: respHeaders });
    }

    // ---- /intro/{bookNum} ----
    if (path.startsWith('/intro/')) {
      const parts = path.match(/\/intro\/(\d+)/);
      if (!parts) return new Response(JSON.stringify({error:'bad path'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
      const bookNum = +parts[1];
      const cacheKey = `intro_${bookNum}`;

      const cached = env.COMMENTARY_KV ? await env.COMMENTARY_KV.get(cacheKey) : null;
      if (cached) return new Response(cached, {headers:{...cors,'Content-Type':'application/json'}});

      const bookName = BOOK_NAMES_EN[bookNum-1];
      const bookNameKo = BOOK_NAMES_KO[bookNum-1];

      const prompt = `You are a Bible scholar writing an accessible book introduction in the Reformed/evangelical tradition (Calvin, Sproul, Keller, Piper).

Write a book introduction for ${bookName} with these sections:

1. **Overview** (3-4 sentences): What this book is about, its central message, and why it matters.
2. **Historical Background** (3-4 sentences): Author, date, audience, historical setting, and how it fits in the canon.
3. **Key Themes** (provide exactly 4 themes, each with a title and 2-sentence explanation).
4. **Geographic Context** (2-3 sentences): Key locations in the book and their significance. Then provide an array of up to 5 map locations relevant to this book with name, lat, lng, and a one-sentence description.

Then provide Korean translations of all sections. Use 존댓말 (formal polite -습니다/-ㅂ니다 speech level) for all Korean text.

Respond in this exact JSON format with no markdown, no preamble:
{
  "overview_en": "...",
  "background_en": "...",
  "themes_en": [{"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}],
  "geo_en": "...",
  "map_locations": [{"name": "...", "name_ko": "...", "lat": 0.0, "lng": 0.0, "desc": "...", "desc_ko": "..."}],
  "overview_ko": "...",
  "background_ko": "...",
  "themes_ko": [{"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}, {"title": "...", "desc": "..."}],
  "geo_ko": "..."
}`;

      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{role:'user', content: prompt}]
        })
      });

      if (!aiResp.ok) {
        const err = await aiResp.text();
        return new Response(JSON.stringify({error:'ai_failed', detail: err}), {status:500, headers:{...cors,'Content-Type':'application/json'}});
      }

      const aiData = await aiResp.json();
      const text = aiData.content?.[0]?.text || '{}';
      const cleanText = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();

      let intro;
      try { intro = JSON.parse(cleanText); }
      catch(e) { return new Response(JSON.stringify({error:'parse_failed', raw: cleanText}), {status:500, headers:{...cors,'Content-Type':'application/json'}}); }

      intro.book_en = bookName;
      intro.book_ko = bookNameKo;

      const result = JSON.stringify(intro);
      if (env.COMMENTARY_KV) await env.COMMENTARY_KV.put(cacheKey, result);
      return new Response(result, {headers:{...cors,'Content-Type':'application/json'}});
    }

    // ---- /commentary/{bookNum}/{chapter} ----
    if (path.startsWith('/commentary/')) {
      const parts = path.match(/\/commentary\/(\d+)\/(\d+)/);
      if (!parts) return new Response(JSON.stringify({error:'bad path'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});
      const bookNum = +parts[1], chapter = +parts[2];
      const cacheKey = `commentary_${bookNum}_${chapter}`;

      const cached = env.COMMENTARY_KV ? await env.COMMENTARY_KV.get(cacheKey) : null;
      if (cached) return new Response(cached, {headers:{...cors,'Content-Type':'application/json'}});

      const bookName = BOOK_NAMES_EN[bookNum-1];
      const bookNameKo = BOOK_NAMES_KO[bookNum-1];

      const prompt = `You are a Bible teacher writing accessible commentary in the tradition of Reformed/evangelical scholars like John Calvin, Matthew Henry, R.C. Sproul, Tim Keller, and John Piper. Your commentary emphasizes Scripture's authority, God's sovereignty, Christ-centered interpretation, and practical application.

Write commentary for ${bookName} chapter ${chapter} with these two sections:

1. **Summary** (2-3 sentences): What happens in this chapter in plain language anyone can understand.

2. **Reflection** (3-4 sentences): Key theological themes and one practical takeaway for a modern reader. Keep it warm, pastoral, and grounded in the text.

Then provide Korean translations of each section. Use 존댓말 (formal polite -습니다/-ㅂ니다 speech level) for all Korean text.

Respond in this exact JSON format:
{
  "summary_en": "...",
  "reflection_en": "...",
  "summary_ko": "...",
  "reflection_ko": "..."
}

Only output valid JSON, no markdown, no preamble.`;

      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{role:'user', content: prompt}]
        })
      });

      if (!aiResp.ok) {
        const err = await aiResp.text();
        return new Response(JSON.stringify({error:'ai_failed', detail: err}), {status:500, headers:{...cors,'Content-Type':'application/json'}});
      }

      const aiData = await aiResp.json();
      const text = aiData.content?.[0]?.text || '{}';

      let commentary;
      const cleanText = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
      try { commentary = JSON.parse(cleanText); }
      catch(e) { return new Response(JSON.stringify({error:'parse_failed', raw: text}), {status:500, headers:{...cors,'Content-Type':'application/json'}}); }

      commentary.book_en = bookName;
      commentary.book_ko = bookNameKo;
      commentary.chapter = chapter;

      const result = JSON.stringify(commentary);
      if (env.COMMENTARY_KV) await env.COMMENTARY_KV.put(cacheKey, result);
      return new Response(result, {headers:{...cors,'Content-Type':'application/json'}});
    }

    // ---- Admin endpoints (must precede /search) ----
    if (path === '/admin/build-index') return handleBuildIndex(env, url, cors);
    if (path === '/admin/merge-index') return handleMergeIndex(env, url, cors);
    if (path === '/admin/build-en-index') return handleBuildEnIndex(env, url, cors);
    if (path === '/admin/merge-en-index') return handleMergeEnIndex(env, url, cors);
    if (path === '/admin/index-status') return handleIndexStatus(env, url, cors);
    if (path === '/admin/wipe-apibible-cache') return handleWipeApiBibleCache(env, url, cors);
    if (path === '/admin/build-apibible-index') return handleBuildApiBibleIndex(env, url, cors);
    if (path === '/admin/merge-apibible-index') return handleMergeApiBibleIndex(env, url, cors);

    // ---- api.bible chapter fetch (NLT / NIV / MSG) ----
    //   /apibible/{translationId}/{bookNum}/{chapter}
    const apb = path.match(/^\/apibible\/([^/]+)\/(\d+)\/(\d+)\/?$/);
    if (apb) {
      const translationId = apb[1];
      const bookNum = parseInt(apb[2]);
      const chapter = parseInt(apb[3]);
      return handleApiBibleChapter(env, url, cors, translationId, bookNum, chapter);
    }

    // ---- api.bible per-translation search ----
    //   /search/apibible/{translationId}?q=...&page=...
    const apbs = path.match(/^\/search\/apibible\/([^/]+)\/?$/);
    if (apbs) {
      return handleApiBibleSearch(env, url, cors, apbs[1]);
    }

    // ---- /search/ko (fast) ----
    if (path.startsWith('/search/ko')) return handleKoreanSearch(env, url, cors);

    // ---- /search/en (fast in-memory index) ----
    if (path.startsWith('/search/en')) return handleEnglishSearch(env, url, cors);

    // ---- /votd ----
    if (path.startsWith('/votd')) {
      const now = new Date();
      const today = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const votdKey = `votd3_${today}`;

      const tomorrowDateET = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', {timeZone:'America/New_York'});
      const midnightET = new Date(`${tomorrowDateET}T00:00:00`);
      const nowET = new Date(now.toLocaleString('en-US', {timeZone:'America/New_York'}));
      const offsetMs = now - nowET;
      const midnightUTC = new Date(midnightET.getTime() + offsetMs);
      const secondsUntilMidnight = Math.max(60, Math.floor((midnightUTC - now) / 1000));
      const votdHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": `public, max-age=${secondsUntilMidnight}` };

      if (env.COMMENTARY_KV) {
        const cached = await env.COMMENTARY_KV.get(votdKey);
        if (cached) return new Response(cached, { headers: votdHeaders });
      }

      const topics = [
        'wheat field golden sunrise',
        'rolling pasture hills countryside',
        'olive trees ancient landscape',
        'mountain valley mist sunrise',
        'wildflower meadow no people',
        'calm lake reflection mountains',
        'rolling green hills countryside',
        'lavender field provence landscape',
        'vineyard hills golden hour',
        'desert canyon landscape sunrise',
        'forest light rays peaceful',
        'coastal cliffs ocean horizon'
      ];

      // Anything in the photo's description/tags that hints at a person being
      // in frame.  Unsplash has no native no-people filter, so we re-roll if
      // any of these show up in the metadata of the returned photo.
      const PEOPLE_KEYWORDS = [
        'person','people','human','man','woman','boy','girl','child','kid',
        'baby','family','group','crowd','farmer','shepherd','hiker','rider',
        'face','portrait','silhouette','model','tourist','traveler'
      ];
      const photoHasPeople = (pd) => {
        const text = [
          pd.description || '',
          pd.alt_description || '',
          ...(pd.tags || []).map(t => (t && t.title) || ''),
          ...(pd.tags_preview || []).map(t => (t && t.title) || '')
        ].join(' ').toLowerCase();
        return PEOPLE_KEYWORDS.some(k =>
          new RegExp(`\\b${k}\\b`).test(text)
        );
      };

      const unsplashKey = 'jdBAQs04z5PyhHphjzUKIJCjl3SyMhQS2rSMfBLQOpk';
      const fetchOnePhoto = async () => {
        const t = topics[Math.floor(Math.random() * topics.length)];
        const r = await fetch(
          `https://api.unsplash.com/photos/random?query=${encodeURIComponent(t)}` +
          `&orientation=landscape&content_filter=high&client_id=${unsplashKey}`
        );
        if (!r.ok) return null;
        return await r.json();
      };

      // First photo attempt runs in parallel with the verse fetch so we don't
      // pay for the retry loop on the common path.
      const [votdResp, firstPhotoResp] = await Promise.allSettled([
        fetch('https://labs.bible.org/api/?passage=votd&type=json', {
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
        }),
        fetchOnePhoto()
      ]);

      const votdData = votdResp.status === 'fulfilled' ? await votdResp.value.json() : [];

      let pd = firstPhotoResp.status === 'fulfilled' ? firstPhotoResp.value : null;
      // If the first attempt has people, re-roll up to 3 more times.  VOTD
      // only fires once a day so the extra Unsplash calls are cheap.
      let attempts = 1;
      while (pd && photoHasPeople(pd) && attempts < 4) {
        pd = await fetchOnePhoto();
        attempts++;
      }
      // If we ran out of retries and still have a people-shot, drop the photo
      // rather than serve a bad image — the front end falls back to the solid
      // color card when photo is null.
      if (pd && photoHasPeople(pd)) pd = null;

      let photo = null;
      if (pd) {
        photo = {
          url: pd.urls?.regular || null,
          color: pd.color || '#555555',
          credit: pd.user?.name || null,
          creditLink: pd.user?.links?.html || null
        };
      }

      const result = JSON.stringify({ verses: votdData, photo });

      if (env.COMMENTARY_KV) {
        await env.COMMENTARY_KV.put(votdKey, result, { expirationTtl: secondsUntilMidnight });
      }

      return new Response(result, { headers: votdHeaders });
    }

    // ---- Korean Bible (nkrv) chapter fetch ----
    let bookNum, chapter;
    const m  = path.match(/\/nkrv\/(\d+)\/(\d+)/);
    const m2 = path.match(/^\/(\d+)\/(\d+)/);
    if (m)       { bookNum = +m[1];  chapter = +m[2]; }
    else if (m2) { bookNum = +m2[1]; chapter = +m2[2]; }
    else return new Response(JSON.stringify({error:"Use /nkrv/{book}/{chapter}"}), {status:400, headers:{...cors,"Content-Type":"application/json"}});

    const verseKey = `nkrv_${bookNum}_${chapter}`;
    if (env.COMMENTARY_KV) {
      const cachedVerses = await env.COMMENTARY_KV.get(verseKey);
      if (cachedVerses) {
        return new Response(cachedVerses, {headers:{...cors,"Content-Type":"application/json","Cache-Control":"public, max-age=2592000, stale-while-revalidate=86400"}});
      }
    }

    try {
      const data = await fetchChapterFromBskorea(bookNum, chapter);
      if (data.verses.length === 0) {
        return new Response(JSON.stringify({error:"parse_failed"}), {headers:{...cors,"Content-Type":"application/json"}});
      }
      const result = JSON.stringify(data);
      if (env.COMMENTARY_KV) await env.COMMENTARY_KV.put(verseKey, result);
      return new Response(result, {headers:{...cors,"Content-Type":"application/json","Cache-Control":"public, max-age=2592000, stale-while-revalidate=86400"}});
    } catch (e) {
      return new Response(JSON.stringify({error: e.message}), {status:500, headers:{...cors,"Content-Type":"application/json"}});
    }
  }
};
