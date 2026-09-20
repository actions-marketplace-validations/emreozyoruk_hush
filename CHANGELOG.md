# Changelog

## 1.0.0 — 2026-09-20

First release.

**Issues.** Four questions in one request — category, spam, needs-more-info and
possible-duplicate — each applied only above a threshold you set. Below it, the
action leaves the issue alone and records the number that decided it in the job
summary.

**Pull requests.** A different set, because a pull request is a change rather
than a claim: kind (`fix` `feature` `docs` `refactor` `chore` `test`), plus
`needs-careful-review`, `needs-tests` and `needs-description`. The model is shown
the shape of the diff — file list with per-file line counts, commit count,
whether this is a first contribution — not the diff body.

**CLI.** `npx hush-triage owner/repo` runs the same judgement over a backlog you
already have and writes nothing, so the question "what would this do to my
issues?" is one command rather than an installation.

**Thresholds are measured, not asserted.** 800 closed issues across eleven
repositories, each carrying one label its own maintainers applied: 75% agreement
at the shipped 0.80, 98% on `bug`, 88% excluding `question` — a class repositories
use as a workflow state rather than a category. It holds across ecosystems, 88%
on JavaScript and 87% on Python. Dataset, method and raw results in `bench/`.

**Safety.** Reports without acting by default. Never creates a label, never
removes one, never touches a label a person set, never applies a label the
repository does not already have.

No dependencies; the action runs the files in `src/` directly on Node.
