# Technology Series Framework

## Reader Journey

Build each pillar as a learning path:

1. Establish the vocabulary and problem taxonomy.
2. Explain the protocol, architecture, or evaluation foundation.
3. Walk through one representative project at a time.
4. Compare adjacent tools on one reproducible task.
5. Explain security, privacy, cost, lock-in, and failure modes.
6. Revisit the category when releases or lifecycle changes alter the recommendation.

## Article Formats

| Format | Best use | Required evidence |
|--------|----------|-------------------|
| Signal brief | Time-sensitive release with clear primary evidence | Official release plus one practical implication |
| Concept explainer | Confused terminology or ecosystem structure | Canonical specifications and examples |
| Installation guide | Stable, repeatable onboarding problem | Frozen version and direct reproduction |
| Deep tutorial | Valuable end-to-end reader job | Direct workflow, commands, outputs, limits, and source ledger |
| Architecture teardown | Important system design or protocol | Documentation, code, diagrams, and implementation boundaries |
| Comparison | Reader must choose between adjacent tools | Same task, environment, model, budget, and scoring rubric |
| Failure analysis | Hype or adoption hides material risks | Reproducible failure, security evidence, or lifecycle facts |
| Update | Previous article has drifted | Clear change log and impact on the old conclusion |
| Opinion | Evidence supports a broader editorial conclusion | Transparent facts, assumptions, counterarguments, and conflicts |

## Backlog Card

Keep one card per article:

```yaml
id: stable-slug
pillar: ai-coding
category: architecture-map | open-source-recommendation
status: watch | selected | reproducing | drafting | review | formatted | draft | published | update-needed
reader: target reader
reader_promise: one concrete transformation
why_now: current change or durable unmet need
original_angle: what this article adds beyond existing coverage
format: deep-tutorial
canonical_project: owner/repository or official product identifier
primary_url: durable primary source
supporting_urls: []
rights_status: verified | review-needed
reproducibility_status: not-started | partial | complete | blocked
frozen_version: ""
environment: ""
assets: []
prerequisites: []
next_article: ""
publication_day_rechecks: []
```

Load `editorial-categories.md` after selecting `category`. Future categories enter that registry before they appear in backlog cards.

## Sequencing Rules

- Explain MCP, ACP, Agent Skills, and AGENTS.md before comparing tools that depend on them.
- Explain approval, sandbox, and repository-instruction boundaries before recommending autonomous workflows.
- Publish individual project tutorials before a definitive multi-tool comparison.
- Use the same repository and task for a comparison series.
- Alternate time-sensitive posts with durable tutorials so the account does not become a release feed.
- Keep at least two verified reserve topics rather than filling dates with weak candidates.
- Revisit a category after a major ownership, license, architecture, pricing, or lifecycle change.

## Pacing

Choose pace from available reproduction capacity. A durable default is one deep article plus one lighter signal or follow-up per week. Do not assign a deep tutorial date until primary evidence and a viable test environment exist.
