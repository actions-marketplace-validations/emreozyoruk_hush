// The decision layer. Pure functions: given an issue and Jev's answers, say what
// should happen. No network, no GitHub — so it is testable on its own.

import { choice, noul } from "./jev.js";

export const ABSTAIN = "abstain";

/** Everything the model is shown. Kept small on purpose: title and body carry the signal. */
export function buildState({ title, body, author, isFirstTimeContributor, openTitles }) {
  const lines = [
    `New issue title: ${title}`,
    `New issue body:\n${(body || "(empty)").slice(0, 6000)}`,
    `Author: ${author}${isFirstTimeContributor ? " (first-time contributor to this repo)" : ""}`,
  ];
  if (openTitles?.length) {
    lines.push(
      "",
      "Titles of other open issues in this repository:",
      ...openTitles.slice(0, 40).map((t, i) => `${i + 1}. ${t}`),
    );
  }
  return lines.join("\n");
}

export function buildQuestions(labels, { checkDuplicate }) {
  const q = {
    label: choice(
      "Which single category best describes what this issue is about?",
      { ...labels, none: "None of these categories fit this issue" },
    ),
    spam: noul("Is this issue spam, advertising, or otherwise not a genuine report about this project?", {
      true: "Promotional content, nonsense, or unrelated to the project.",
      false: "A genuine attempt to report, ask, or request something.",
    }),
    needs_info: noul("Is essential information missing that a maintainer would have to ask for before acting?", {
      true: "No reproduction steps, no version, no error text, or too vague to act on.",
      false: "Enough detail is present to start work or give an answer.",
    }),
  };
  if (checkDuplicate) {
    q.duplicate = noul("Does this issue describe the same problem as one of the other open issues listed?", {
      true: "The same underlying problem, even if worded differently.",
      false: "A different problem, or no other issue is close enough.",
    });
  }
  return q;
}

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Turn Jev's answers into decisions, abstaining wherever the model is not sure enough.
 * Every decision carries the number that produced it, so a maintainer can audit the bot.
 */
export function decide(answers, thresholds, labels) {
  const out = [];

  const spam = answers.spam?.noul;
  if (typeof spam === "number") {
    out.push(spam >= thresholds.spam
      ? { kind: "spam", action: "label", value: "spam", confidence: spam, why: `spam ${pct(spam)} ≥ ${pct(thresholds.spam)}` }
      : { kind: "spam", action: ABSTAIN, confidence: spam, why: `spam ${pct(spam)} < ${pct(thresholds.spam)}` });
  }

  const dup = answers.duplicate?.noul;
  if (typeof dup === "number") {
    out.push(dup >= thresholds.duplicate
      ? { kind: "duplicate", action: "label", value: "possible-duplicate", confidence: dup, why: `duplicate ${pct(dup)} ≥ ${pct(thresholds.duplicate)}` }
      : { kind: "duplicate", action: ABSTAIN, confidence: dup, why: `duplicate ${pct(dup)} < ${pct(thresholds.duplicate)}` });
  }

  const info = answers.needs_info?.noul;
  if (typeof info === "number") {
    out.push(info >= thresholds.needs_info
      ? { kind: "needs_info", action: "label", value: "needs-more-info", confidence: info, why: `needs info ${pct(info)} ≥ ${pct(thresholds.needs_info)}` }
      : { kind: "needs_info", action: ABSTAIN, confidence: info, why: `needs info ${pct(info)} < ${pct(thresholds.needs_info)}` });
  }

  const lab = answers.label;
  if (lab?.choice) {
    const p = lab.probabilities?.[lab.choice] ?? 0;
    const conf = typeof lab.confidence === "number" ? lab.confidence : 0;
    // Two gates, because they fail differently: a flat distribution means the
    // options overlap, low confidence means the model does not trust its own read.
    const sure = p >= thresholds.label && conf >= thresholds.label_confidence;
    if (lab.choice === "none") {
      out.push({ kind: "label", action: ABSTAIN, confidence: p, why: `best fit was "none" (${pct(p)})` });
    } else if (!labels[lab.choice]) {
      out.push({ kind: "label", action: ABSTAIN, confidence: p, why: `model returned an unknown option "${lab.choice}"` });
    } else if (sure) {
      out.push({ kind: "label", action: "label", value: lab.choice, confidence: p,
        why: `${lab.choice} ${pct(p)} ≥ ${pct(thresholds.label)}, confidence ${pct(conf)} ≥ ${pct(thresholds.label_confidence)}` });
    } else {
      out.push({ kind: "label", action: ABSTAIN, confidence: p,
        why: `${lab.choice} ${pct(p)} / confidence ${pct(conf)} — below ${pct(thresholds.label)} / ${pct(thresholds.label_confidence)}` });
    }
  }

  return out;
}

export const labelsToApply = (decisions) =>
  [...new Set(decisions.filter((d) => d.action === "label").map((d) => d.value))];

export const abstained = (decisions) => decisions.filter((d) => d.action === ABSTAIN);
