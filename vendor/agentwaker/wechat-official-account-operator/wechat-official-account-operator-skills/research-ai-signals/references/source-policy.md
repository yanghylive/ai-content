# Source Policy

## Source Tiers

| Tier | Role | Examples | Editorial use |
|------|------|----------|---------------|
| P0 / tier 1 | Primary evidence | Official documentation, repository, release, changelog, paper, model card, security advisory | May support factual claims after date and scope verification. |
| P1 / tier 2 | Expert curation | Independent technical authors and newsletters with attributable links and methods | Use for interpretation and discovery; trace important facts back to P0. |
| P2 / tier 3 | Community signal | GitHub velocity, Hacker News, Reddit, official X API results | Use to learn what practitioners discuss; never treat popularity as proof. |
| P3 / tier 4 | Chinese reader and translation signal | Chinese technology media, developer communities, question sites | Use to identify local questions and angles; verify technical facts elsewhere. |
| Tier 5 | Weak lead | Reposts, anonymous screenshots, unattributed summaries, scraped copies | Do not publish from this source alone. |

Use an approximate collection mix of 55% P0, 20% P1, 15% P2, and 10% P3. Adjust for the article type, but never let social or media volume outnumber the evidence behind the underlying event.

## Required Candidate Fields

Keep these fields for every selected topic:

- `primary_url`
- `supporting_urls`
- `rights_status`
- `why_now`
- `china_angle`
- `reproducibility_status`
- `published_at`
- `verified_at`
- `canonical_event`
- `canonical_project`

## Verification Rules

1. Resolve a project to its canonical organization, repository, documentation, license, and current release.
2. Resolve a paper by DOI when available, otherwise by version-independent arXiv identifier and then a durable paper graph identifier.
3. Remove tracking parameters and prefer the declared canonical article URL.
4. Merge posts that point to the same repository, release, paper, or product announcement within a 72-hour event window.
5. Count an official blog post, X post, and GitHub release about one launch as one event with multiple corroborators.
6. Recheck version, activity, pricing, availability, license, and product lifecycle on the publication date.
7. Preserve corrections, transfers, repository renames, project sunsets, and successor projects.

## Platform Rules

### GitHub

- Use Trending and total stars only for discovery.
- Prefer release feeds, commit and release history, independent contributors, issue and pull-request health, installation evidence, and recent velocity.
- Use authenticated REST access when automating. Observe the general and Search-specific rate-limit response headers and back off.
- Store repository `node_id` as the durable project key when available; fold ordinary forks into the upstream project.

### Hacker News

- Prefer the official Firebase API for Top, Best, and Show stories.
- Use discussion as a question and adoption signal, not factual proof.
- Cache results and poll politely even when a limit is not documented.

### Reddit

- Use OAuth, a unique User-Agent, rate-limit headers, and deletion synchronization.
- Do not build production collection on anonymous JSON or RSS behavior.
- Keep only focused communities and return every important claim to a primary source.

### X

- Use the official X API for automated collection. Do not scrape or automate the consumer website.
- Use Recent Search only within its current documented window and budget; verify the current access tier and pricing before enabling it.
- Store the minimum identifiers and metadata required for editorial triage and honor deletion and policy requirements.
- Verify an institutional account through the organization's own website or official help page; a verification badge alone is insufficient.

### Telegram

- Do not scrape, index, harvest, aggregate, or send public-channel history into an AI workflow.
- Do not treat Telegram public channels as the default source layer.
- Use a Bot only in a user-owned or explicitly consented channel for editorial notifications and approval actions.
- Accept a specific user-provided post or export only when the user has the right to provide it, then verify important claims through durable sources.

### Chinese Sites and WeChat Articles

- Use public media websites and official project pages before attempting platform-bound article collection.
- Do not assume a generic official API exists for reading arbitrary WeChat Official Account history.
- Preserve original author, original URL, first publication time, and reuse permission.
- Make original verification, reproduction, and analysis the substance of the article; automated rewriting is not original reporting.

## Candidate Scoring

The bundled script uses a 100-point model:

| Component | Weight |
|-----------|-------:|
| Relevance to account pillars | 20 |
| Evidence quality and sufficiency | 18 |
| Source-tier quality | 15 |
| Reader utility | 15 |
| Technical depth | 12 |
| Novelty relative to the backlog | 8 |
| Recency | 7 |
| Reproduction readiness | 5 |
| Promotional risk | up to -10 |

Route `>= 78` to a deep tutorial only when primary evidence exists. Route `65-77` to a brief or series candidate, `50-64` to watch, and `< 50` to discard. A high score cannot override missing rights, unsafe reproduction, a fake repository, an unclear license, or an unverifiable core claim.

## Project Health Checks

Track 1-, 3-, and 7-day changes rather than total stars alone. Review releases, commits, contributors, forks, issues, pull requests, documentation, license, installation success, and cross-community discussion. Apply explicit penalties for a large historical star count with no current activity, a single viral post, vendor-only benchmarks, unclear licensing, irreproducible setup, empty templates, or star farming.
