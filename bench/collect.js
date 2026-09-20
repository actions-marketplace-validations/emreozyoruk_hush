#!/usr/bin/env node
// Build a ground-truth set from issues maintainers have already labelled.
//
// The label a maintainer put on their own issue is the closest thing to a
// correct answer that exists at scale, and it is free. Search by label so each
// class is represented, then drop anything carrying a second mapped label —
// ambiguous ground truth is no ground truth.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REPOS = [
  "vercel/next.js", "sveltejs/svelte", "vitejs/vite", "denoland/deno", "withastro/astro",
  "prisma/prisma", "tailwindlabs/tailwindcss", "remix-run/react-router", "biomejs/biome",
  "oven-sh/bun", "supabase/supabase", "TanStack/query", "nuxt/nuxt", "expo/expo",
  "storybookjs/storybook", "pnpm/pnpm", "rollup/rollup", "vuejs/core",
];

// The same meaning, spelled a dozen ways across repos.
const SEARCH = {
  bug: ["bug", "kind/bug", "type: bug", "C-bug"],
  feature: ["enhancement", "feature request", "kind/feature", "C-feature"],
  docs: ["documentation", "docs", "kind/docs", "area: docs"],
  question: ["question", "kind/question", "support"],
};
const MAP = Object.fromEntries(Object.entries(SEARCH).flatMap(([g, ls]) => ls.map((l) => [l.toLowerCase(), g])));

const token = process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=40`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 403 || r.status === 429) { await sleep(8000); continue; }
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  }
  return [];
}

const TARGET = 110;
const rows = [];
const counts = { bug: 0, feature: 0, docs: 0, question: 0 };
const seen = new Set();

outer:
for (const [gold, labels] of Object.entries(SEARCH)) {
  for (const repo of REPOS) {
    if (counts[gold] >= TARGET) continue;
    for (const label of labels) {
      if (counts[gold] >= TARGET) break;
      const items = await search(`repo:${repo} is:issue is:closed label:"${label}"`);
      for (const i of items) {
        if (counts[gold] >= TARGET) break;
        const key = `${repo}#${i.number}`;
        if (seen.has(key)) continue;
        const mapped = [...new Set((i.labels || []).map((l) => MAP[l.name.toLowerCase()]).filter(Boolean))];
        if (mapped.length !== 1 || mapped[0] !== gold) continue;
        const body = (i.body || "").trim();
        if (body.length < 80) continue;
        seen.add(key);
        rows.push({ repo, number: i.number, title: i.title, body: body.slice(0, 4000), gold });
        counts[gold]++;
      }
      await sleep(2200);   // the search API allows 30 requests a minute
    }
  }
  process.stderr.write(`${gold}: ${counts[gold]}\n`);
  if (rows.length > 500) break outer;
}

console.error("\ntotal", rows.length, counts);
writeFileSync(new URL("./dataset.json", import.meta.url), JSON.stringify(rows, null, 1));
