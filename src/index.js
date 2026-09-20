// The action entrypoint. Reads the workflow inputs, asks Jev once, and applies
// only what it is sure about.

import { readFileSync, appendFileSync } from "node:fs";
import { ask } from "./jev.js";
import { DEFAULT_LABELS } from "./labels.js";
import { buildQuestions, buildState, decide, labelsToApply, abstained, ABSTAIN } from "./triage.js";
import { addLabels, comment, existingLabels, openIssueTitles } from "./github.js";
import { readBool as bool, readInput as input, readNum as num } from "./inputs.js";


function summary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) { try { appendFileSync(path, lines.join("\n") + "\n"); } catch { /* summaries are a nicety */ } }
  console.log(lines.join("\n"));
}

async function main() {
  const apiKey = input("typesafe-api-key");
  const token = input("github-token");
  if (!apiKey) throw new Error("typesafe-api-key is required");
  if (!token) throw new Error("github-token is required");

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("no GITHUB_EVENT_PATH — hush runs on issue events");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const issue = event.issue;
  if (!issue) throw new Error("this event carries no issue — trigger hush on `issues`");
  if (issue.pull_request) { summary(["### hush", "", "Skipped: this is a pull request."]); return; }

  const repo = process.env.GITHUB_REPOSITORY;
  const apply = bool("apply", false);
  const shouldComment = bool("comment", false);
  const checkDuplicate = bool("check-duplicates", true);

  let labels = DEFAULT_LABELS;
  const raw = input("labels").trim();
  if (raw) {
    try { labels = JSON.parse(raw); } catch (e) { throw new Error(`labels must be a JSON object: ${e.message}`); }
  }

  const thresholds = {
    label: num("label-threshold", 0.8),
    label_confidence: num("label-confidence-threshold", 0.6),
    spam: num("spam-threshold", 0.9),
    needs_info: num("needs-info-threshold", 0.85),
    duplicate: num("duplicate-threshold", 0.85),
  };

  const openTitles = checkDuplicate ? await openIssueTitles(token, repo, issue.number) : [];
  const state = buildState({
    title: issue.title,
    body: issue.body,
    author: issue.user?.login ?? "unknown",
    isFirstTimeContributor: ["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"].includes(issue.author_association),
    openTitles,
  });
  const questions = buildQuestions(labels, { checkDuplicate: checkDuplicate && openTitles.length > 0 });

  const { answers, usage, model, ms } = await ask(apiKey, state, questions);
  const decisions = decide(answers, thresholds, labels);

  // Never invent a label, and never re-apply one the issue already carries.
  const present = new Set((issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)));
  const repoLabels = await existingLabels(token, repo);
  const wanted = labelsToApply(decisions);
  const toApply = wanted.filter((l) => repoLabels.has(l) && !present.has(l));
  const missing = wanted.filter((l) => !repoLabels.has(l));

  const rows = decisions.map((d) => {
    const verdict = d.action === ABSTAIN ? "stayed quiet" : `→ \`${d.value}\``;
    return `| ${d.kind} | ${verdict} | ${d.why} |`;
  });
  const head = [
    "### hush",
    "",
    `\`${model}\` · ${ms} ms · ${usage.input_tokens ?? "?"} input tokens · ${apply ? "**applying**" : "**dry run** (set `apply: true` to let it act)"}`,
    "",
    "| question | verdict | why |",
    "|---|---|---|",
    ...rows,
  ];
  if (missing.length) head.push("", `> Not applied — these labels do not exist in the repo: ${missing.map((m) => `\`${m}\``).join(", ")}`);
  if (!toApply.length) head.push("", "Nothing to apply.");
  summary(head);

  if (!apply || !toApply.length) return;

  await addLabels(token, repo, issue.number, toApply);
  if (shouldComment) {
    const quiet = abstained(decisions);
    const body = [
      `Labelled by [hush](https://github.com/marketplace/actions/hush): ${toApply.map((l) => `\`${l}\``).join(", ")}.`,
      "",
      ...decisions.filter((d) => d.action !== ABSTAIN).map((d) => `- **${d.value}** — ${d.why}`),
      quiet.length ? `\nStayed quiet on: ${quiet.map((d) => d.kind).join(", ")}.` : "",
      "\n<sub>A maintainer's labels are never removed. Thresholds live in the workflow file.</sub>",
    ].join("\n");
    await comment(token, repo, issue.number, body);
  }
}

main().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
