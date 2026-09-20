#!/usr/bin/env node
// Point hush at a repository you already have and watch what it would do.
// Reads open issues, judges each one, prints the table. Writes nothing.

import { ask, JevError } from "./jev.js";
import { DEFAULT_LABELS } from "./labels.js";
import { buildQuestions, buildState, decide, labelsToApply, ABSTAIN } from "./triage.js";
import { existingLabels, openIssueTitles } from "./github.js";
import { execFileSync } from "node:child_process";

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { d: "\x1b[2m", r: "\x1b[0m", g: "\x1b[32m", y: "\x1b[33m", b: "\x1b[1m", c: "\x1b[36m", red: "\x1b[31m" }
  : { d: "", r: "", g: "", y: "", b: "", c: "", red: "" };

const T = { label: 0.8, label_confidence: 0.6, spam: 0.9, needs_info: 0.85, duplicate: 0.85 };

const USAGE = `
${C.b}hush${C.r} — see what it would do to a backlog you already have.

  ${C.c}npx hush-triage${C.r} <owner/repo> [options]

  --limit <n>        how many open issues to judge (default 20, max 100)
  --labels <json>    your label taxonomy, as {"name": "what it means"}
  --no-duplicates    skip the duplicate comparison
  --json             machine-readable output

  ${C.d}TYPESAFE_API_KEY  required — console.typesafe.ai/keys
  GITHUB_TOKEN      optional — falls back to \`gh auth token\`${C.r}

This never writes anything. It is the dry run, not a smaller version of the action.
`;

function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

function parseArgs(argv) {
  const out = { limit: 20, labels: DEFAULT_LABELS, duplicates: true, json: false, repo: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Math.min(100, Math.max(1, parseInt(argv[++i], 10) || 20));
    else if (a === "--labels") out.labels = JSON.parse(argv[++i]);
    else if (a === "--no-duplicates") out.duplicates = false;
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (!a.startsWith("-")) out.repo = a;
  }
  return out;
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s).padEnd(n);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.repo) { console.log(USAGE); process.exit(args.repo ? 0 : 1); }
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo)) { console.error(`${C.red}Expected owner/repo, got "${args.repo}"${C.r}`); process.exit(1); }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) { console.error(`${C.red}TYPESAFE_API_KEY is not set.${C.r} Get one at https://console.typesafe.ai/keys`); process.exit(1); }
  const token = ghToken();
  if (!token) { console.error(`${C.red}No GitHub token.${C.r} Set GITHUB_TOKEN, or install the gh CLI and run \`gh auth login\`.`); process.exit(1); }

  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const res = await fetch(`${api}/repos/${args.repo}/issues?state=open&per_page=${args.limit}&sort=created&direction=desc`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) { console.error(`${C.red}GitHub ${res.status}${C.r} — ${(await res.text()).slice(0, 200)}`); process.exit(1); }
  const issues = (await res.json()).filter((i) => !i.pull_request);
  if (!issues.length) { console.log("No open issues to judge."); return; }

  const [titles, repoLabels] = await Promise.all([
    args.duplicates ? openIssueTitles(token, args.repo, -1) : Promise.resolve([]),
    existingLabels(token, args.repo).catch(() => new Set()),
  ]);

  if (!args.json) {
    console.log(`\n${C.b}${args.repo}${C.r} ${C.d}· ${issues.length} open issues · nothing will be written${C.r}\n`);
  }

  let cost = 0, ms = 0, acted = 0, quiet = 0;
  const rows = [];
  for (const issue of issues) {
    const state = buildState({
      title: issue.title, body: issue.body, author: issue.user?.login ?? "unknown",
      isFirstTimeContributor: ["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"].includes(issue.author_association),
      openTitles: titles.filter((t) => t !== issue.title),
    });
    let answers, usage, took;
    try {
      ({ answers, usage, ms: took } = await ask(apiKey, state, buildQuestions(args.labels, { checkDuplicate: args.duplicates && titles.length > 1 })));
    } catch (err) {
      if (err instanceof JevError) { console.error(`${C.red}${err.message}${C.r}`); process.exit(1); }
      throw err;
    }
    ms += took;
    cost += ((usage.input_tokens ?? 0) / 1e6) * 0.042;
    const decisions = decide(answers, T, args.labels);
    const wanted = labelsToApply(decisions);
    const have = new Set((issue.labels ?? []).map((l) => l.name));
    const now = wanted.filter((l) => !have.has(l));
    acted += now.length ? 1 : 0;
    quiet += now.length ? 0 : 1;
    rows.push({ number: issue.number, title: issue.title, would_apply: now,
      missing_in_repo: wanted.filter((l) => !repoLabels.has(l)), decisions, ms: took });

    if (!args.json) {
      const verdict = now.length ? `${C.g}${now.join(", ")}${C.r}` : `${C.d}—${C.r}`;
      console.log(`${C.d}#${String(issue.number).padEnd(5)}${C.r}${trunc(issue.title, 52)} ${verdict}`);
      for (const d of decisions) {
        const mark = d.action === ABSTAIN ? `${C.d}·${C.r}` : `${C.g}✓${C.r}`;
        console.log(`      ${mark} ${C.d}${d.kind.padEnd(11)}${d.why}${C.r}`);
      }
    }
  }

  if (args.json) { console.log(JSON.stringify({ repo: args.repo, rows }, null, 2)); return; }

  const missing = [...new Set(rows.flatMap((r) => r.missing_in_repo))];
  console.log(`\n${C.b}${acted}${C.r} of ${rows.length} would get a label · ${C.b}${quiet}${C.r} left alone`);
  console.log(`${C.d}${Math.round(ms / rows.length)} ms average · $${cost.toFixed(5)} total${C.r}`);
  if (missing.length) console.log(`${C.y}Labels hush wanted that this repo does not have: ${missing.join(", ")}${C.r}`);
  console.log(`\n${C.d}Happy with it? Add the action: https://github.com/emreozyoruk/hush${C.r}\n`);
}

main().catch((e) => { console.error(`${C.red}${e.message}${C.r}`); process.exit(1); });
