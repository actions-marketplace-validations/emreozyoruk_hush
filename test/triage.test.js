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

// ── inputs ──────────────────────────────────────────────────────────────────
import { envName, readBool, readInput, readNum } from "../src/inputs.js";

test("a dashed input keeps its dashes, the way GitHub passes it", () => {
  assert.equal(envName("typesafe-api-key"), "INPUT_TYPESAFE-API-KEY");
  assert.equal(readInput("typesafe-api-key", { "INPUT_TYPESAFE-API-KEY": "k" }), "k");
});

test("an underscored variant still works, for running the file by hand", () => {
  assert.equal(readInput("typesafe-api-key", { INPUT_TYPESAFE_API_KEY: "k" }), "k");
});

test("a missing input is empty, not undefined", () => {
  assert.equal(readInput("nope", {}), "");
});

test("booleans and numbers fall back rather than turning into NaN", () => {
  assert.equal(readBool("apply", false, {}), false);
  assert.equal(readBool("apply", false, { "INPUT_APPLY": "true" }), true);
  assert.equal(readNum("label-threshold", 0.8, {}), 0.8);
  assert.equal(readNum("label-threshold", 0.8, { "INPUT_LABEL-THRESHOLD": "0.95" }), 0.95);
});

// ── pull requests ───────────────────────────────────────────────────────────
import { DEFAULT_PR_LABELS, buildPRQuestions, buildPRState, decidePR } from "../src/pr.js";

const PT = { kind: 0.8, kind_confidence: 0.6, risky: 0.8, untested: 0.85, undescribed: 0.85 };

test("a risky change is flagged for a careful review", () => {
  const ds = decidePR({ risky: { noul: 0.93 } }, PT, DEFAULT_PR_LABELS);
  assert.equal(find(ds, "risky").value, "needs-careful-review");
});

test("an ordinary change is not", () => {
  assert.equal(find(decidePR({ risky: { noul: 0.4 } }, PT, DEFAULT_PR_LABELS), "risky").action, ABSTAIN);
});

test("behaviour without a test asks for one, above the bar", () => {
  assert.equal(find(decidePR({ untested: { noul: 0.91 } }, PT, DEFAULT_PR_LABELS), "untested").value, "needs-tests");
  assert.equal(find(decidePR({ untested: { noul: 0.7 } }, PT, DEFAULT_PR_LABELS), "untested").action, ABSTAIN);
});

test("a pull request kind needs probability and confidence, like an issue label", () => {
  assert.equal(find(decidePR({ kind: { choice: "fix", probabilities: { fix: 0.9 }, confidence: 0.8 } }, PT, DEFAULT_PR_LABELS), "kind").value, "fix");
  assert.equal(find(decidePR({ kind: { choice: "fix", probabilities: { fix: 0.9 }, confidence: 0.2 } }, PT, DEFAULT_PR_LABELS), "kind").action, ABSTAIN);
});

test("the diff's shape is what the model is shown", () => {
  const s = buildPRState({
    title: "Add retry to the client", body: "", author: "ada", isFirstTimeContributor: true,
    files: [{ filename: "src/client.ts", additions: 40, deletions: 2 }], additions: 40, deletions: 2, commits: 3,
  });
  assert.match(s, /src\/client\.ts \(\+40 −2\)/);
  assert.match(s, /3 commit\(s\), 1 file\(s\), \+40 −2/);
  assert.match(s, /first contribution/);
  assert.match(s, /\(none — the author left the description empty\)/);
});

test("a long diff is truncated, and says so", () => {
  const files = Array.from({ length: 80 }, (_, i) => ({ filename: `f${i}.ts`, additions: 1, deletions: 0 }));
  assert.match(buildPRState({ title: "t", body: "b", author: "a", files, additions: 80, deletions: 0, commits: 1 }),
    /first 50 of 80/);
});

test("the pull request question set asks the three a reviewer wants flagged", () => {
  const q = buildPRQuestions(DEFAULT_PR_LABELS);
  assert.deepEqual(Object.keys(q).sort(), ["kind", "risky", "undescribed", "untested"]);
  assert.ok("none" in q.kind.criteria);
});
