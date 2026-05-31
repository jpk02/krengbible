# krengbible Cloudflare Worker

Source for the Worker at `krengbible.pauljkim22.workers.dev`.  This repo is the source of truth — paste `index.js` into the Cloudflare dashboard editor when deploying.

## What changed in the Korean search rewrite

**Before:** `/search/ko` looped through up to 1189 chapters, doing a serial `KV.get()` per chapter.  Cold queries took 10s+; pagination beyond the first page took 30–50s; verses in never-visited chapters were silently un-searchable.

**After:** A pre-built flat index lives in KV at `nkrv_search_index` — one JSON blob, roughly 5 MB, containing every verse as `[bookIdx, chapter, verse, cleanText]`.  The Worker loads it once per isolate (cold start ~100ms) into a module-level cache, then every query is in-memory `includes()` + `slice()`.  Sub-100ms per query regardless of page.

If the index hasn't been built yet, `/search/ko` returns HTTP 503 with `{"error":"index_not_built"}` rather than silently returning partial results.  This is intentional — if you ever wipe the KV namespace, search visibly breaks until you rebuild.

## Required env vars / bindings

Already present in this Worker:

- `COMMENTARY_KV` — KV namespace binding
- `ESV_TOKEN` — ESV API token
- `ANTHROPIC_KEY` — Anthropic API key

**Add:**

- `ADMIN_SECRET` — any random string.  Required to call the `/admin/*` endpoints below.  Set it as a Worker secret (Settings → Variables and Secrets → Add → "Secret").

## Deploying the new Worker

1. Open the Cloudflare dashboard → Workers & Pages → krengbible → Edit code.
2. Replace the entire file with the contents of `worker/index.js`.
3. Confirm `COMMENTARY_KV`, `ESV_TOKEN`, `ANTHROPIC_KEY`, `ADMIN_SECRET` are all bound under Settings.
4. Deploy.

## Building the English (ESV) search index

The English search now uses the same flat-index architecture as Korean, replacing the ESV `passage/search` API (which was a relevance-ranked black box that dropped obvious matches like Psalm 119:105 for "lamp").

Chunk size 250 chapters at a time, same as Korean.  Each chunk fetches the chapters from the ESV API (concurrency 8 to be polite).  After all chunks land, merge.

```bash
# Chunk 1: chapters 0-249
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/build-en-index?secret=YOUR_SECRET&from=0&size=250"

# Chunks 2-5
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/build-en-index?secret=YOUR_SECRET&from=250&size=250"
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/build-en-index?secret=YOUR_SECRET&from=500&size=250"
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/build-en-index?secret=YOUR_SECRET&from=750&size=250"
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/build-en-index?secret=YOUR_SECRET&from=1000&size=250"

# Merge once all chunks are done
curl.exe "https://krengbible.pauljkim22.workers.dev/admin/merge-en-index?secret=YOUR_SECRET"
```

Each chunk takes 60–120s the first time (it's calling ESV ~250 times in parallel batches).  Subsequent chunks reuse the per-chapter cache (`esv_{book}_{chapter}` keys) unless you pass `&refetch=1`.

After merge, `/search/en` returns sub-second substring matches across the whole Bible — Psalm 119:105 will now show up for "lamp", and any other previously-missing matches.

## Building the Korean search index (first time, or after a wipe)

The Bible has 1189 chapters.  Building the index means walking each one, ensuring it's cached in KV, and writing flat verse tuples into chunk keys.  We do it in chunks so a single request stays well under the Worker CPU limit.

Replace `YOUR_SECRET` with your `ADMIN_SECRET` value below.  Default chunk size is 250 chapters.

```bash
# Chunk 1: chapters 0-249
curl "https://krengbible.pauljkim22.workers.dev/admin/build-index?secret=YOUR_SECRET&from=0&size=250"

# Chunk 2
curl "https://krengbible.pauljkim22.workers.dev/admin/build-index?secret=YOUR_SECRET&from=250&size=250"

# Chunk 3
curl "https://krengbible.pauljkim22.workers.dev/admin/build-index?secret=YOUR_SECRET&from=500&size=250"

# Chunk 4
curl "https://krengbible.pauljkim22.workers.dev/admin/build-index?secret=YOUR_SECRET&from=750&size=250"

# Chunk 5 (final — covers 1000-1188)
curl "https://krengbible.pauljkim22.workers.dev/admin/build-index?secret=YOUR_SECRET&from=1000&size=250"
```

Each chunk response tells you `nextFrom` (or `null` if done) so you can copy/paste the next URL straight from the JSON output.  If a chunk fetches a lot of un-cached chapters from bskorea.or.kr it can take 30–90 seconds.  Mostly-cached chunks finish in a few seconds.

When `done: true` shows up, run merge:

```bash
curl "https://krengbible.pauljkim22.workers.dev/admin/merge-index?secret=YOUR_SECRET"
```

This concatenates every `nkrv_search_chunk_*` key into the final `nkrv_search_index`.  Expected output: `totalVerses: ~31000`.

## Checking status

```bash
curl "https://krengbible.pauljkim22.workers.dev/admin/index-status?secret=YOUR_SECRET"
```

Returns the current index size, chunk count, and whether the current isolate has it cached.

## Rebuilding after Bible-text changes

If you ever change verse text (you almost certainly won't), re-run the chunked build with `&refetch=1` to force re-fetch from bskorea.or.kr instead of using the per-chapter KV cache.  Then merge again.

## Routes summary

| Route | Purpose | Notes |
|---|---|---|
| `/esv/?q=...` | ESV passage lookup | Passthrough |
| `/intro/{n}` | AI book intro | KV-cached forever |
| `/commentary/{book}/{ch}` | AI chapter commentary | KV-cached forever |
| `/search/ko?q=&offset=` | Korean search | Uses pre-built index — fast |
| `/search/en?q=&page=` | English search | ESV API |
| `/votd` | Verse of the day | KV-cached until midnight ET |
| `/nkrv/{book}/{ch}` | Korean Bible chapter | KV-cached forever |
| `/admin/build-index` | Build search index chunk | Requires `secret` |
| `/admin/merge-index` | Merge chunks into final index | Requires `secret` |
| `/admin/index-status` | Inspect index state | Requires `secret` |
