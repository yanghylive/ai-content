---
name: review-wechat-performance
description: Review permitted WeChat article metrics, reader questions, correction signals, and content patterns, then recommend evidence-based editorial experiments. Use for article retrospectives, series reviews, title or format analysis, reader-intent analysis, update decisions, and choosing the next topic without inventing causal conclusions.
---

# Review WeChat Performance

## Purpose

Convert available account evidence into a small number of testable editorial decisions.

## Required Inputs

- Article identifiers, publication dates, formats, pillars, goals, and intended readers.
- Permitted API data, backend exports, screenshots, or user-provided metrics.
- Comparison window and any distribution or campaign context.

## Workflow

1. Read `references/performance-framework.md` for the metric dictionary and inference rules.
2. Define the review window and normalize for article age, distribution timing, topic, format, and audience size where possible.
3. Separate observed metrics, reader language, editorial interpretation, and causal hypothesis.
4. Compare each result to its original reader promise and content goal, not only to account-wide averages.
5. Identify correction needs, evergreen update opportunities, follow-up questions, and series drop-off.
6. Recommend one or two controlled next experiments with a clear change, expected signal, and evaluation window.
7. Update the backlog without erasing weak results or inconvenient evidence.

## Outputs

- Metric and reader-signal summary.
- Article and series diagnosis with uncertainty.
- Corrections and evergreen update queue.
- One or two next experiments and the recommended next article.

## Approval Gates

No approval is required for authorized read-only analysis. Require approval before changing, deleting, republishing, replying, or otherwise writing through the account.

## Failure Handling

If quantitative data is unavailable, perform a qualitative review of the article, reader questions, and stated goal. List the missing data and avoid numerical or causal claims.

## Handoff Rules

Hand off the next content decision to `plan-tech-series`, corrections to `draft-deep-tutorial`, formatting changes to `format-wechat-article`, and any approved account mutation to `publish-wechat-article`.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
