#!/usr/bin/env node
// Measure the thresholds instead of asserting them.
//
// For every issue a maintainer already labelled, ask hush the same question and
// compare. Sweeping the threshold shows the trade the maintainer is actually
// making: how much precision each point of coverage costs.

import { readFileSync, writeFileSync } from "node:fs";
import { ask } from "../src/jev.js";
import { buildQuestions, buildState, decide } from "../src/triage.js";
import { DEFAULT_LABELS as LABELS } from "../src/labels.js";


const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error("TYPESAFE_API_KEY is not set"); process.exit(1); }

const rows = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf8"));
console.error(`judging ${rows.length} issues…`);

const CONCURRENCY = 8;
const out = [];
let done = 0, cost = 0, ms = 0;

async function judge(row) {
  const state = buildState({ title: row.title, body: row.body, author: "contributor", isFirstTimeContributor: false });
  const q = buildQuestions(LABELS, { checkDuplicate: false });
  const r = await ask(key, state, q);
  ms += r.ms;
  cost += ((r.usage.input_tokens ?? 0) / 1e6) * 0.042;
  const a = r.answers.label ?? {};
  out.push({
    repo: row.repo, number: row.number, gold: row.gold,
    choice: a.choice ?? null,
    p: a.probabilities?.[a.choice] ?? 0,
    confidence: typeof a.confidence === "number" ? a.confidence : 0,
  });
  if (++done % 25 === 0) process.stderr.write(`  ${done}/${rows.length}\n`);
}

const queue = [...rows];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await judge(queue.shift());
}));

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(out, null, 1));

// ── the sweep ────────────────────────────────────────────────────────────────
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const line = (a, b, c, d, e) =>
  `| ${String(a).padEnd(9)} | ${String(b).padStart(9)} | ${String(c).padStart(9)} | ${String(d).padStart(10)} | ${String(e).padStart(9)} |`;

console.log(`\n${rows.length} issues, ${new Set(rows.map((r) => r.repo)).size} repositories, labelled by their own maintainers.`);
console.log(`${Math.round(ms / rows.length)} ms average · $${cost.toFixed(4)} total\n`);
console.log(line("threshold", "acts on", "correct", "precision", "silent"));
console.log(`|${"-".repeat(11)}|${"-".repeat(11)}|${"-".repeat(11)}|${"-".repeat(12)}|${"-".repeat(11)}|`);

const CONF = 0.6;
for (const t of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
  const acted = out.filter((r) => r.choice && r.choice !== "none" && r.p >= t && r.confidence >= CONF);
  const right = acted.filter((r) => r.choice === r.gold).length;
  const prec = acted.length ? right / acted.length : 0;
  console.log(line(t.toFixed(2), `${acted.length}/${out.length}`, right, pct(prec), pct(1 - acted.length / out.length)));
}

// Per class and per ecosystem, because the average hides both.
const at = (t, c) => out.filter((r) => r.choice && r.choice !== "none" && r.p >= t && r.confidence >= c);
const prec = (rs) => (rs.length ? rs.filter((r) => r.choice === r.gold).length / rs.length : 0);
const shipped = at(0.8, 0.6);
const gold = new Map(rows.map((r) => [`${r.repo}#${r.number}`, r]));

console.log("\nBy class, at the shipped default:");
for (const g of ["bug", "feature", "docs", "question"]) {
  const sub = shipped.filter((r) => r.gold === g);
  if (sub.length) console.log(`  ${g.padEnd(9)} ${String(sub.filter((r) => r.choice === r.gold).length).padStart(4)}/${String(sub.length).padEnd(4)} ${pct(prec(sub))}`);
}
const eco = {};
for (const r of shipped) {
  const e = gold.get(`${r.repo}#${r.number}`)?.ecosystem ?? "other";
  (eco[e] ??= []).push(r);
}
if (Object.keys(eco).length > 1) {
  console.log("\nBy ecosystem, at the shipped default:");
  for (const [e, rs] of Object.entries(eco).sort((a, b) => b[1].length - a[1].length)) {
    const noQ = rs.filter((r) => r.gold !== "question");
    console.log(`  ${e.padEnd(9)} ${String(rs.length).padStart(4)} decisions  ${pct(prec(rs))}   ${pct(prec(noQ))} excluding question`);
  }
}
const noQ = shipped.filter((r) => r.gold !== "question");
console.log(`\nExcluding question: ${noQ.filter((r) => r.choice === r.gold).length}/${noQ.length} = ${pct(prec(noQ))}`);

// What it gets wrong when it does act, at the shipped default.
const d = out.filter((r) => r.choice && r.choice !== "none" && r.p >= 0.8 && r.confidence >= 0.6);
const wrong = d.filter((r) => r.choice !== r.gold);
const pairs = wrong.reduce((a, r) => ((a[`${r.gold} → ${r.choice}`] = (a[`${r.gold} → ${r.choice}`] || 0) + 1), a), {});
console.log(`\nAt the shipped default (0.80 / 0.60): ${wrong.length} of ${d.length} disagreed with the maintainer.`);
for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(3)}  ${k}`);
