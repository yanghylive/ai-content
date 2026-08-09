---
name: trend-research
description: Research Xiaohongshu hot categories, keyword results, topic candidates, competitor patterns, and audience language with read-only evidence. Use when a user asks for Xiaohongshu trends, keywords, hashtags, competitor examples, audience questions, or evidence-backed content angles.
---

# Trend Research

## Purpose

Research Xiaohongshu hot categories, keyword results, hashtag candidates, competitor note patterns, and audience language.

## Trigger Conditions

Use this skill when the user asks for topics, trends, competitor examples, keyword signals, hashtags, or content angles.

## Required Inputs

- Topic, product, service, niche, or target category.
- Target audience and account positioning when available.
- Optional competitor accounts, note URLs, or keywords.

## Workflow

1. Define research scope and keyword set.
2. Use read-only commands such as `xhs hot`, `xhs search`, `xhs topics`, `xhs read`, or `xhs user-posts`.
3. Summarize observed signals: repeated hooks, note formats, pain points, visuals, hashtags, and audience questions.
4. Separate observed signals from assumptions.
5. Recommend content angles and next experiments.

## Outputs

- Keyword or category research summary.
- Topic clusters and hashtag candidates.
- Competitor or example pattern notes.
- Recommended content angles with confidence.

## Approval Gates

No approval is required for read-only research. Approval is required before any follow, favorite, like, comment, or other account write.

## Failure Handling

If `xhs` fails or is unauthenticated, record the command and error, then ask for screenshots, URLs, or pasted examples.

## Handoff Rules

Handoff to ProductManager when product positioning or offer strategy is unclear.
