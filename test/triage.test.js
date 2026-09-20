// Offline tests. The decision layer is pure, so the thresholds can be proven
// without spending a request.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, buildState, buildQuestions, labelsToApply, ABSTAIN } from "../src/triage.js";

const LABELS = { bug: "a defect", feature: "a request", docs: "documentation" };
const T = { label: 0.8, label_confidence: 0.6, spam: 0.9, needs_info: 0.85, duplicate: 0.85 };
const find = (ds, kind) => ds.find((d) => d.kind === kind);

test("a confident label is applied", () => {
  const ds = decide({ label: { choice: "bug", probabilities: { bug: 0.94, feature: 0.04, docs: 0.02 }, confidence: 0.8 } }, T, LABELS);
  assert.equal(find(ds, "label").action, "label");
  assert.equal(find(ds, "label").value, "bug");
});

test("a split distribution abstains even when one option leads", () => {
  const ds = decide({ label: { choice: "bug", probabilities: { bug: 0.52, feature: 0.44 }, confidence: 0.9 } }, T, LABELS);
  assert.equal(find(ds, "label").action, ABSTAIN);
});

test("high probability with low confidence abstains", () => {
  const ds = decide({ label: { choice: "bug", probabilities: { bug: 0.95 }, confidence: 0.2 } }, T, LABELS);
  assert.equal(find(ds, "label").action, ABSTAIN);
});

test('"none of these" is never turned into a label', () => {
  const ds = decide({ label: { choice: "none", probabilities: { none: 0.99 }, confidence: 0.99 } }, T, LABELS);
  assert.equal(find(ds, "label").action, ABSTAIN);
});

test("an option the repo never offered is refused", () => {
  const ds = decide({ label: { choice: "wontfix", probabilities: { wontfix: 0.99 }, confidence: 0.99 } }, T, LABELS);
  assert.equal(find(ds, "label").action, ABSTAIN);
  assert.match(find(ds, "label").why, /unknown option/);
});

test("spam needs a high bar", () => {
  assert.equal(find(decide({ spam: { noul: 0.88 } }, T, LABELS), "spam").action, ABSTAIN);
  assert.equal(find(decide({ spam: { noul: 0.97 } }, T, LABELS), "spam").value, "spam");
});

test("a maybe-duplicate stays quiet", () => {
  assert.equal(find(decide({ duplicate: { noul: 0.6 } }, T, LABELS), "duplicate").action, ABSTAIN);
});

test("every verdict explains itself with the number behind it", () => {
  const ds = decide({ spam: { noul: 0.4 }, needs_info: { noul: 0.91 } }, T, LABELS);
  for (const d of ds) assert.match(d.why, /\d+%/);
});

test("missing answers produce no decisions rather than guesses", () => {
  assert.deepEqual(decide({}, T, LABELS), []);
});

test("labels to apply are unique and only the confident ones", () => {
  const ds = decide(
    { spam: { noul: 0.99 }, needs_info: { noul: 0.1 }, label: { choice: "bug", probabilities: { bug: 0.9 }, confidence: 0.9 } },
    T, LABELS,
  );
  assert.deepEqual(labelsToApply(ds).sort(), ["bug", "spam"]);
});

test("the state carries the issue and the open titles it must compare against", () => {
  const s = buildState({ title: "Crash on save", body: "steps…", author: "ada", isFirstTimeContributor: true, openTitles: ["Crash when saving"] });
  assert.match(s, /Crash on save/);
  assert.match(s, /first-time contributor/);
  assert.match(s, /1\. Crash when saving/);
});

test("an empty body is stated, not left blank", () => {
  assert.match(buildState({ title: "t", body: "", author: "a" }), /\(empty\)/);
});

test("the duplicate question is only asked when there is something to compare with", () => {
  assert.ok(!("duplicate" in buildQuestions(LABELS, { checkDuplicate: false })));
  assert.ok("duplicate" in buildQuestions(LABELS, { checkDuplicate: true }));
});

test("the label question always offers a way out", () => {
  assert.ok("none" in buildQuestions(LABELS, { checkDuplicate: false }).label.criteria);
});
