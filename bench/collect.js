#!/usr/bin/env node
// Build a ground-truth set from issues maintainers have already labelled.
//
// The label a maintainer put on their own issue is the closest thing to a
// correct answer that exists at scale, and it is free. Search by label so each
// class is represented, then drop anything carrying a second mapped label —
// ambiguous ground truth is no ground truth.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Deliberately spread across ecosystems: the first run was entirely
// JavaScript-adjacent, which is a poor basis for a default anyone installs.
const REPOS = [
  // JavaScript / TypeScript
  "vercel/next.js", "sveltejs/svelte", "vitejs/vite", "denoland/deno", "oven-sh/bun",
  "nuxt/nuxt", "vuejs/core", "storybookjs/storybook", "supabase/supabase",
  // Python
  "pydantic/pydantic", "fastapi/fastapi", "pandas-dev/pandas", "astral-sh/ruff",
  "psf/black", "scikit-learn/scikit-learn", "python-poetry/poetry", "encode/httpx",
  // Go
  "gohugoio/hugo", "grafana/grafana", "kubernetes/minikube", "cli/cli",
  "go-gitea/gitea", "prometheus/prometheus",
  // Rust
  "rust-lang/rust-analyzer", "tokio-rs/tokio", "serde-rs/serde", "BurntSushi/ripgrep",
  "sharkdp/fd", "rust-lang/cargo",
];

// Recorded alongside each row so precision can be read per ecosystem.
const ECOSYSTEM = {
  "vercel/next.js":"js","sveltejs/svelte":"js","vitejs/vite":"js","denoland/deno":"js",
  "oven-sh/bun":"js","nuxt/nuxt":"js","vuejs/core":"js","storybookjs/storybook":"js",
  "supabase/supabase":"js",
  "pydantic/pydantic":"python","fastapi/fastapi":"python","pandas-dev/pandas":"python",
  "astral-sh/ruff":"python","psf/black":"python","scikit-learn/scikit-learn":"python",
  "python-poetry/poetry":"python","encode/httpx":"python",
  "gohugoio/hugo":"go","grafana/grafana":"go","kubernetes/minikube":"go","cli/cli":"go",
  "go-gitea/gitea":"go","prometheus/prometheus":"go",
  "rust-lang/rust-analyzer":"rust","tokio-rs/tokio":"rust","serde-rs/serde":"rust",
  "BurntSushi/ripgrep":"rust","sharkdp/fd":"rust","rust-lang/cargo":"rust",
};

// The same meaning, spelled a dozen ways across repos.
const SEARCH = {
  bug: ["bug", "Bug", "kind/bug", "type: bug", "type/bug", "C-bug", "T-bug"],
  feature: ["enhancement", "Enhancement", "feature request", "kind/feature", "kind/enhancement",
            "C-enhancement", "C-feature", "C-feature-request", "type/feature", "type/enhancement",
            "Feature Request", "type: feature"],
  docs: ["documentation", "docs", "Docs", "doc", "kind/docs", "area: docs", "A-documentation",
         "T-docs", "type/docs", "component/documentation", "Docs"],
  question: ["question", "Question", "kind/question", "support", "C-support", "C-question",
             "type/question"],
};
const MAP = Object.fromEntries(Object.entries(SEARCH).flatMap(([g, ls]) => ls.map((l) => [l.toLowerCase(), g])));

const token = process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A dropped connection killed two collection runs and took the whole dataset
// with it, so every failure mode here is a retry and the caller never throws.
async function search(q) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=40`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 403 || r.status === 429) { await sleep(10000); continue; }
      if (!r.ok) return [];
      return (await r.json()).items ?? [];
    } catch (e) {
      process.stderr.write(`  retry (${e.code ?? e.name}) ${q}\n`);
      await sleep(3000 * (attempt + 1));
    }
  }
  return [];
}

// A quota per ecosystem, not per class. The first version filled each class
// from whichever repositories came first in the list, which was every
// JavaScript one — Go and Rust were never reached, and the absence looked like
// a property of their label vocabularies rather than of this loop.
const PER_ECOSYSTEM = 50;

const rows = [];
const counts = {};            // `${gold}:${ecosystem}` → kept
const seen = new Set();
const bump = (g, e) => (counts[`${g}:${e}`] = (counts[`${g}:${e}`] ?? 0) + 1);
const got = (g, e) => counts[`${g}:${e}`] ?? 0;

for (const [gold, labels] of Object.entries(SEARCH)) {
  for (const repo of REPOS) {
    const eco = ECOSYSTEM[repo] ?? "other";
    if (got(gold, eco) >= PER_ECOSYSTEM) continue;
    for (const label of labels) {
      if (got(gold, eco) >= PER_ECOSYSTEM) break;
      const items = await search(`repo:${repo} is:issue is:closed label:"${label}"`);
      for (const i of items) {
        if (got(gold, eco) >= PER_ECOSYSTEM) break;
        const key = `${repo}#${i.number}`;
        if (seen.has(key)) continue;
        const mapped = [...new Set((i.labels || []).map((l) => MAP[l.name.toLowerCase()]).filter(Boolean))];
        if (mapped.length !== 1 || mapped[0] !== gold) continue;
        const body = (i.body || "").trim();
        if (body.length < 80) continue;
        seen.add(key);
        rows.push({ repo, ecosystem: eco, number: i.number, title: i.title, body: body.slice(0, 4000), gold });
        bump(gold, eco);
      }
      await sleep(2200);   // the search API allows 30 requests a minute
    }
  }
  const per = Object.entries(counts).filter(([k]) => k.startsWith(`${gold}:`)).map(([k, v]) => `${k.split(":")[1]} ${v}`);
  process.stderr.write(`${gold}: ${per.join(", ")}\n`);
  // Checkpoint after every class, so a dropped connection costs one class, not all four.
  writeFileSync(new URL("./dataset.json", import.meta.url), JSON.stringify(rows, null, 1));
}

console.error("\ntotal", rows.length, counts);
writeFileSync(new URL("./dataset.json", import.meta.url), JSON.stringify(rows, null, 1));
