---
name: note-drafting
description: Draft Xiaohongshu-native title variants, hooks, body copy, hashtags, calls to action, and image briefs from approved facts. Use when a user asks for a Xiaohongshu note, copy rewrite, title optimization, hashtag strategy, or publish-ready note package.
---

# Note Drafting

## Purpose

Draft Xiaohongshu note titles, hooks, body copy, hashtags, image briefs, and variant sets.

## Trigger Conditions

Use this skill when the user asks for copywriting, note drafts, title optimization, hashtag strategy, or publish-ready text.

## Required Inputs

- Topic or product/service context.
- Target audience.
- Desired tone.
- Key facts and claims that are allowed.
- Available images or intended image concept.

## Workflow

1. Identify audience intent and note angle.
2. Draft 5-10 title variants when title optimization matters.
3. Draft body copy with a strong opening, useful middle, and clear CTA.
4. Add hashtag/topic candidates.
5. Create image brief and first-screen visual suggestion.
6. Run safety checks for unsupported claims, clickbait, privacy, and platform fit.

## Outputs

- Title variants.
- Final recommended title.
- Body copy.
- Hashtag candidates.
- Image brief.
- Publishing checklist.

## Approval Gates

Approval is required before publishing the draft.

## Failure Handling

If facts are missing, mark placeholders or ask for the minimum facts needed to avoid fabrication.

## Handoff Rules

Handoff to ProductManager when product claims, target users, or value proposition need product-level decisions.
Handoff approved copy, image roles, evidence needs, and brand constraints to `xiaohongshu-visuals` when finished visual files are required; a drafting brief is not a substitute for visual production.
