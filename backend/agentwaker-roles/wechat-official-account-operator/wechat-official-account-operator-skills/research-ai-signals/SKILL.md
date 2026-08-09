---
name: research-ai-signals
description: Discover, verify, normalize, deduplicate, and rank current AI, agent, foundation-model, AI coding, and Vibe Coding signals for a Chinese WeChat technology account. Use for source discovery, daily or weekly scans, GitHub/X/Telegram monitoring, trend triage, project watchlists, or evidence-backed topic recommendations.
---

# Research AI Signals

## Purpose

Build a current, traceable candidate queue from primary sources and high-signal discovery channels without turning social popularity into proof.

## Required Inputs

- Content pillars and target readers.
- Time window and desired output: watchlist, brief, deep article, comparison, or series.
- Optional project, keyword, account, channel, repository, or source constraints.

## Workflow

1. Read `references/source-policy.md` for source tiers, verification rules, and platform constraints.
2. Read `references/source-registry.json` only when choosing or collecting sources.
3. Read `references/discovery-queries.md` when constructing GitHub, official X API, Hacker News, Reddit, paper, or Chinese reader-demand queries.
4. Set a bounded time window and keyword set in both English and Chinese-market terminology when useful.
5. Run `scripts/collect_feeds.py` for open RSS or Atom sources and `scripts/collect_github_projects.py` for official repository-search candidates. Add current web, official X API, Hacker News, compliant Reddit, and user-provided signals when useful. Do not collect public Telegram channel history.
6. Canonicalize the project, announcement, release, paper, or claim behind repeated coverage.
7. For a selected GitHub project, run `scripts/inspect_github_project.py OWNER/REPOSITORY` to capture a dated release, commit, issue, and pull-request activity snapshot. Then inspect representative items manually.
8. Verify important claims against a repository, official documentation, release, paper, model card, advisory, or direct first-party statement.
9. Record publication time, verification time, source tier, canonical URL, evidence URL, and access limitations.
10. Run `scripts/rank_signals.py` or apply the same rubric manually.
11. Route each item to discard, watch, short brief, deep tutorial, comparison, update, or series.

## Outputs

- Deduplicated candidate list with score and score reasons.
- Source and evidence ledger with verification dates.
- Recommended disposition and original article angle.
- Confidence, missing evidence, reproduction needs, and drift risks.

## Approval Gates

No approval is required for public, read-only research. Require approval before logging into a user identity, joining a private channel, installing an unreviewed collector, writing to a platform, or sending unpublished material to a third party.

## Failure Handling

If X, Telegram, a feed, or a website is unavailable, record the access failure and continue with durable primary sources. Ask for exported or pasted material when a private or login-bound signal is essential. Never bypass access controls.

## Handoff Rules

Hand off to `plan-tech-series` after candidates are ranked. Hand off to `draft-deep-tutorial` when one topic has enough primary evidence and a viable reproduction plan. Hand off to ProductManager when the topic depends on unresolved product positioning or commercial claims.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
