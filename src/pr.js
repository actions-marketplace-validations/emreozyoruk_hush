// Pull requests are judged differently from issues.
//
// An issue is a claim about the project. A pull request is a change to it, and
// the questions a maintainer actually has are about the change: how big is it,
// does it touch anything dangerous, did the author test it, and is it even
// describing what it does. None of those are answerable from a title.

import { choice, noul } from "./jev.js";

export const DEFAULT_PR_LABELS = {
  fix: "Repairs behaviour that was wrong. Touches existing logic to make it correct.",
  feature: "Adds behaviour the project did not have. New capability, new surface.",
  docs: "Changes documentation, comments, examples or the README. No behaviour change.",
  refactor: "Rearranges code without intending to change what it does: renames, extractions, moves.",
  chore: "Dependencies, build config, CI, formatting, version bumps. Housekeeping, not product.",
  test: "Adds or changes tests only.",
};

/** A pull request described the way a reviewer first meets one. */
export function buildPRState({ title, body, author, isFirstTimeContributor, files, additions, deletions, commits }) {
  const paths = files.map((f) => `${f.filename} (+${f.additions} −${f.deletions})`);
  const shown = paths.slice(0, 50);
  return [
    `Pull request title: ${title}`,
    `Description:\n${(body || "(none — the author left the description empty)").slice(0, 4000)}`,
    `Author: ${author}${isFirstTimeContributor ? " (first contribution to this repository)" : ""}`,
    `Size: ${commits} commit(s), ${files.length} file(s), +${additions} −${deletions}`,
    "",
    `Files changed${paths.length > shown.length ? ` (first ${shown.length} of ${paths.length})` : ""}:`,
    ...shown.map((p) => `- ${p}`),
  ].join("\n");
}

export function buildPRQuestions(labels) {
  return {
    kind: choice("What kind of change is this pull request?", { ...labels, none: "None of these describe it" }),

    // The three a reviewer wants flagged before they open the diff.
    risky: noul("Does this change touch something where a mistake is expensive to undo?", {
      true: "Migrations, authentication, permissions, payments, deletion paths, public API signatures, release or deploy config, or cryptographic code.",
      false: "Ordinary application code, documentation, tests, or configuration with a contained blast radius.",
    }),
    untested: noul("Does this change behaviour without adding or updating a test for it?", {
      true: "Logic changed and no test file in the diff covers the new behaviour.",
      false: "Tests accompany the change, or nothing behavioural changed (docs, formatting, dependency bumps).",
    }),
    undescribed: noul("Would a reviewer have to read the diff to find out what this pull request does?", {
      true: "The description is empty, a template left unfilled, or says less than the title.",
      false: "The description explains the change well enough to review against.",
    }),
  };
}

const pct = (n) => `${Math.round(n * 100)}%`;
export const ABSTAIN = "abstain";

export function decidePR(answers, thresholds, labels) {
  const out = [];
  const gate = (key, kind, label, threshold) => {
    const v = answers[key]?.noul;
    if (typeof v !== "number") return;
    out.push(v >= threshold
      ? { kind, action: "label", value: label, confidence: v, why: `${kind.replace("_", " ")} ${pct(v)} ≥ ${pct(threshold)}` }
      : { kind, action: ABSTAIN, confidence: v, why: `${kind.replace("_", " ")} ${pct(v)} < ${pct(threshold)}` });
  };
  gate("risky", "risky", "needs-careful-review", thresholds.risky);
  gate("untested", "untested", "needs-tests", thresholds.untested);
  gate("undescribed", "undescribed", "needs-description", thresholds.undescribed);

  const k = answers.kind;
  if (k?.choice) {
    const p = k.probabilities?.[k.choice] ?? 0;
    const conf = typeof k.confidence === "number" ? k.confidence : 0;
    if (k.choice === "none") out.push({ kind: "kind", action: ABSTAIN, confidence: p, why: `best fit was "none" (${pct(p)})` });
    else if (!labels[k.choice]) out.push({ kind: "kind", action: ABSTAIN, confidence: p, why: `unknown option "${k.choice}"` });
    else if (p >= thresholds.kind && conf >= thresholds.kind_confidence)
      out.push({ kind: "kind", action: "label", value: k.choice, confidence: p,
        why: `${k.choice} ${pct(p)} ≥ ${pct(thresholds.kind)}, confidence ${pct(conf)} ≥ ${pct(thresholds.kind_confidence)}` });
    else out.push({ kind: "kind", action: ABSTAIN, confidence: p,
      why: `${k.choice} ${pct(p)} / confidence ${pct(conf)} — below ${pct(thresholds.kind)} / ${pct(thresholds.kind_confidence)}` });
  }
  return out;
}
