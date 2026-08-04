---
name: plan-tech-series
description: Turn ranked AI and Vibe Coding projects into a coherent, paced WeChat article series with an explicit editorial category, reader promise, prerequisites, evidence needs, and sequencing. Use for content calendars, project backlogs, architecture-map articles, open-source recommendations, learning paths, comparison plans, or deciding what the technology account should publish next.
---

# Plan Technology Series

## Purpose

Transform an unordered project list into a durable reader journey that can be published one project at a time.

## Required Inputs

- Account positioning, readers, and content pillars.
- Ranked candidate list or named projects.
- Desired pace, time horizon, and available reproduction capacity.
- Existing articles, if any, to prevent repetition and broken prerequisites.

## Workflow

1. Read `references/editorial-categories.md` to select one primary category and load its execution contract. Read `references/series-framework.md` for formats, sequencing, and backlog fields.
2. Read `references/vibe-coding-backlog.md` when planning the AI-coding pillar.
3. Define the reader transformation for the series, not just the topic category.
4. Group projects by job: terminal agent, IDE agent, autonomous engineer, app builder, specification workflow, protocol, context system, evaluation, security, or operations.
5. Publish foundations before comparisons and comparisons before confident recommendations.
6. Assign one primary category. Use `architecture-map` when the article must open with a defensible complete architecture and decompose that same map; use `open-source-recommendation` when the reader needs an adoption verdict. Do not use a generic format as a substitute for the category contract.
7. Map the article to a supporting format: concept, installation, deep tutorial, architecture, comparison, benchmark, failure analysis, update, or opinion.
8. Give every article one reader promise, one original angle, one evidence package, one reproduction plan, and one next article. For `architecture-map`, record the overview boundary and expected numbered regions. For `open-source-recommendation`, record the comparison job and rating evidence.
9. Mix timely items with durable tutorials; keep a reserve queue for weakly verified trends.
10. Mark sponsorship, access, asset, environment, and account dependencies.

## Outputs

- Ordered series map and editorial backlog.
- Article cards with category, promise, angle, format, sources, reproduction, assets, risks, and prerequisites.
- Suggested pace and reserve topics.
- Explicit next topic and reason.

## Approval Gates

No approval is required for planning. Require approval before scheduling through an external service or changing live account content.

## Failure Handling

If audience or pace is missing, produce a provisional sequence and label the assumptions. If evidence is weak, place the item in the watch queue instead of assigning a publication date.

## Handoff Rules

Hand off a selected card to `draft-deep-tutorial`. Hand off visual or interactive asset requirements to FrontDeveloper. Hand off persistent scheduling or automation infrastructure to DevOpsEngineer.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
