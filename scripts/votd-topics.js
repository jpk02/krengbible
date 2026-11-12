/*
 * votd-topics.js — how each photo search topic has fared, as the worker sees
 * it when it chooses topics for the picker's board (votdTopicStats and
 * votdPickTopics in worker/index.js, which this runs as they are).
 *
 * Reads the kept and blocked records saved by `wrangler kv key get` into a
 * folder, and prints:  how many records carry a topic at all, and for every
 * topic in play this season, kept / blocked / the chance of being drawn.
 *
 * READ-ONLY.  Usage:  node scripts/votd-topics.js <folder with used.json,
 * rejected.json, queue.json, archive.json>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const read = (f) => {
  try {
    const t = fs.readFileSync(path.join(dir, f), 'utf8').trim();
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};

// The worker's own topic lists and functions, lifted from its source so this
// cannot drift from what the worker actually does.
const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'index.js'), 'utf8');
const grab = (start) => {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`not found: ${start}`);
  const open = src.slice(i).search(/[[{]/) + i;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (!depth) return src.slice(i, k + 1);
    }
  }
  throw new Error(`unclosed: ${start}`);
};
const code = [
  grab('const VOTD_TOPICS_ALL_YEAR ='),
  grab('const VOTD_TOPICS_BY_SEASON ='),
  grab('function votdSeason('),
  grab('function votdTopics('),
  grab('function votdTopicStats('),
  'return { VOTD_TOPICS_ALL_YEAR, VOTD_TOPICS_BY_SEASON, votdSeason, votdTopics, votdTopicStats };',
].join(';\n');
const W = new Function(code)();

const used = read('used.json') || {};
const rejected = read('rejected.json') || {};
const queue = read('queue.json') || [];
const archive = read('archive.json') || [];

const lines = [];
const usedVals = Object.values(used);
const chosen = usedVals.filter((e) => e && e.note !== 'auto-rolled');
const rejVals = Object.values(rejected);
const withTopic = (list) => list.filter((x) => x && x.topic).length;
lines.push(
  `blocked: ${rejVals.length} total, ${withTopic(rejVals)} with a topic (counted)`,
);
lines.push(
  `kept: used ${chosen.length} chosen (${withTopic(chosen)} with a topic) + ` +
    `queue ${queue.length} (${withTopic(queue)}) + archive ${archive.length} (${withTopic(archive)}); ` +
    `auto-rolled, not counted: ${usedVals.length - chosen.length}`,
);

const stats = W.votdTopicStats(used, rejected, queue, archive);
const season = W.votdSeason();
const pool = W.votdTopics();
let kept = 0, judged = 0;
for (const st of stats.values()) { kept += st.kept; judged += st.kept + st.blocked; }
const overall = (kept + 1) / (judged + 2);
lines.push(`season: ${season}; topics in play: ${pool.length}; overall keep rate ${(overall * 100).toFixed(1)}%`);

// The weights votdPickTopics gives each topic in play, as a share of a draw.
const PRIOR = 10;
const rows = pool.map((t) => {
  const st = stats.get(t) || { kept: 0, blocked: 0 };
  const n = st.kept + st.blocked;
  const rate = (st.kept + PRIOR * overall) / (n + PRIOR);
  const dropped = n >= 20 && rate < overall * 0.4;
  return { t, ...st, rate, w: dropped ? 0 : rate, dropped };
});
const total = rows.reduce((s, r) => s + r.w, 0);
rows.sort((a, b) => b.w - a.w);
for (const r of rows) {
  lines.push(
    `${r.dropped ? 'DROPPED ' : ''}${r.t}: kept ${r.kept}, blocked ${r.blocked}, ` +
      `share ${total ? ((100 * r.w) / total).toFixed(1) : '0'}%`,
  );
}

// Topics with records that are not in play this season.
const others = [...stats].filter(([t]) => !pool.includes(t));
lines.push(
  `other topics (not in play now): ${others.length}; ` +
    others.map(([t, st]) => `${t} ${st.kept}/${st.blocked}`).join(' | '),
);

for (const l of lines) console.log(l);
