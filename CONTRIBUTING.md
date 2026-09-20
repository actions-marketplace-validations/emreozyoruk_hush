# Contributing

## Running the tests

```bash
node --test
```

The decision layer in `src/triage.js` is pure — given Jev's answers and a set of
thresholds it returns verdicts, with no network and no GitHub. Every threshold
rule is tested there, so a change in behaviour should show up as a changed test
rather than as a surprise on someone's repository.

## Trying it against the real model

```bash
export INPUT_TYPESAFE_API_KEY=...        # from console.typesafe.ai/keys
export INPUT_GITHUB_TOKEN=$(gh auth token)
export GITHUB_REPOSITORY=you/your-repo
export GITHUB_EVENT_PATH=test/fixtures/issue.opened.json
node src/index.js
```

`apply` defaults to false, so this prints the table and touches nothing.

## What a good change looks like

- **A verdict you disagree with is a bug report, not a pull request.** Open an
  issue with the table hush produced. The probabilities are the evidence; without
  them a threshold change is a guess.
- **Abstention is the feature.** A change that makes hush act more often needs to
  show what it stops getting wrong, not only what it starts getting right.
- No dependencies. The action runs the files in `src/` directly on Node, and that
  is what keeps it auditable by the maintainers who install it.
