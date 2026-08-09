---
name: draft-deep-tutorial
description: Research and draft an original, evidence-backed, reproducible WeChat technology article under a registered editorial category, including complete-map-first architecture breakdowns and open-source project recommendations. Use when an AI, agent, LLM, AI coding, or Vibe Coding topic has been selected and readers need a traceable explanation or adoption decision.
---

# Draft Deep Tutorial

## Purpose

Produce a useful technical article whose setup, claims, examples, and limitations can be traced or reproduced.

## Required Inputs

- Selected topic card with one registered category, reader promise, and original angle.
- Canonical repository, documentation, release, paper, or product pages.
- Target environment, allowed test scope, and available assets.
- Desired tone, length, CTA, and publication window.

## Workflow

1. Read `../plan-tech-series/references/editorial-categories.md` and load only the selected category contract. Read `references/article-quality-gate.md` before research and again before handoff. Read `references/wechat-house-style.md` before outlining or drafting.
2. Freeze the project version, model, date, environment, pricing snapshot, and relevant feature scope.
3. Inspect official documentation and implementation evidence before secondary commentary.
4. Build a claim ledger: claim, source, verification date, direct observation, confidence, and drift risk.
5. Reproduce the core reader workflow when safe. Capture exact commands, inputs, outputs, time, errors, and limitations.
6. Separate direct observations from source-derived instructions and editorial inference.
7. Outline around the category contract and reader promise. For `architecture-map`, place only a short orientation before the complete architecture image, then follow the overview's numbered regions and return to the whole map. For `open-source-recommendation`, lead with the verdict, prove the workflow, compare the same job, disclose adoption risks, and end with a supported rating.
8. Draft original Chinese prose with mobile-readable paragraphs and purposeful scan signals. Use an account introduction only when it improves context; never force the same greeting into every article. Attribute quotations, images, code, benchmarks, and ideas appropriately.
9. Mark visual opportunities while drafting: architecture, workflow, critical operation phases, comparisons, data claims, evidence states, and abstract concepts that become clearer as images. Do not leave image placeholders presented as finished work.
10. Remove generic hype and unsupported superlatives. Explain costs, privacy, permissions, security, lock-in, and failure modes.
11. Run the quality gate, include the section-level visual opportunity map, and list any evidence that must be refreshed on publication day.

## Outputs

- Title candidates and selected working title.
- Article outline and full Markdown draft.
- Selected category and category-specific completion evidence.
- Versioned reproduction log and claim ledger.
- Section-level visual opportunity map plus image, diagram, screenshot, chart, and cover brief.
- Source ledger, known limitations, correction risks, and publication-day recheck list.

## Approval Gates

Require approval before running untrusted code with broad permissions, incurring material cost, using production credentials, sending private code or data to a model, or publishing the draft.

## Failure Handling

If reproduction is unsafe or blocked, publish only an architecture or source analysis and label every unverified workflow. Do not invent output or imply a hands-on test occurred.

## Handoff Rules

Always hand off an approved article revision and its visual opportunity map to `design-wechat-visuals`, which must produce and approve the actual assets before `format-wechat-article`. Hand off product claims to ProductManager, custom interactive visuals to FrontDeveloper, and independent reproduction or public-render verification to QAEngineer.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
