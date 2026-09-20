# Does the default threshold hold up?

`hush` ships thresholds. This directory is the attempt to find out whether they
are any good, rather than asserting that they are.

## The ground truth

Maintainers label their own issues. That label is free, exists at scale, and is
the closest thing to a correct answer available — so the benchmark asks hush the
same question and compares.

`collect.js` searches nine large repositories for closed issues carrying exactly
one label that maps onto the default taxonomy, spelled however that project
spells it (`kind/bug`, `type: bug`, `C-bug`). An issue carrying two mapped labels
is dropped: ambiguous ground truth is no ground truth. The result is 440 issues,
110 per class.

`run.js` judges each one and sweeps the threshold.

```bash
export TYPESAFE_API_KEY=...
node bench/collect.js      # rebuild the dataset
node bench/run.js          # judge it — about 90 seconds and two cents
```

## What it says

440 issues, 9 repositories, 193 ms and $0.02 for the whole run.

| threshold | acts on | precision | stays quiet |
|---|---|---|---|
| 0.70 | 392/440 | 74% | 11% |
| **0.80** *(shipped default)* | **368/440** | **76%** | **16%** |
| 0.90 | 327/440 | 78% | 26% |
| 0.95 | 297/440 | 80% | 32% |

The curve is shallow, which is itself worth knowing: raising the bar from 0.80 to
0.95 buys four points of precision and costs sixteen points of coverage. The
default sits where that trade stops being worth it.

## Where it disagrees

Precision is not evenly spread:

| class | precision | decisions |
|---|---|---|
| bug | **97%** | 96 |
| feature | 86% | 96 |
| docs | 78% | 89 |
| question | **38%** | 87 |

Nearly every disagreement is one class. Reading the cases explains why: repos do
not use `question` as a category, they use it as a workflow state — "this is
support, not our bug tracker". Several issues labelled `question` by their
maintainers are textbook defect reports with version numbers and reproduction
steps:

> `deno fmt` erroneously balks at tagged templates due to HTML confusion
> — labelled `question`, hush said `bug` at 1.00

**Excluding `question`, precision is 87% across 281 decisions**, and `bug` — the
label that matters most and gets applied most — is 97%.

So the honest summary is: hush is good at recognising what an issue *is*, and
cannot know that your project files support requests under `question`. If your
repo uses a label as a workflow state, write that into its description. The
description is the question the model answers, and these numbers are what it
costs to leave it vague.

## What sharpening the words was worth

The first run scored 73%. Reading the confusions showed that all three common
ones came from definitions that said what a label *is* without saying what it is
*not* — a support question written as a malfunction, a documentation gap reported
as a defect, a missing capability filed as a bug. Rewriting the four descriptions
in [`src/labels.js`](../src/labels.js) to name the boundary moved it to 76%, and
`bug` to 97%.

That is the practical lesson for anyone configuring this: the thresholds are a
blunt instrument, and the label descriptions are the sharp one.

## What this is not

- Not a measure of whether hush is *useful*, only of whether it agrees with
  maintainers who had more context than it did.
- Nine repositories in one ecosystem, all JavaScript-adjacent.
- Closed issues, which skew toward the ones that were resolvable.
- The abstention rate here is for the label question alone. In the action, spam,
  needs-more-info and duplicate carry their own thresholds.

`dataset.json` and `results.json` are committed, so the numbers above can be
recomputed without spending anything.
