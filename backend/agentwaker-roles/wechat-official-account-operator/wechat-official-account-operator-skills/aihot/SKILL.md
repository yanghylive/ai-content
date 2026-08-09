---
name: aihot
description: Query the public AI HOT service for current Chinese AI news, daily briefs, selected items, categories, keyword results, and hot topics. Use for time-sensitive AI-industry discovery; preserve raw responses in the current Weaver run and route important claims through primary-source verification before publication.
---

# AI HOT

## Purpose

Use the public AI HOT API as a current Chinese-language discovery surface for Weaver. This wrapper defines the role boundary, runtime-storage contract, evidence requirements, and handoff behavior. The vendored [upstream snapshot](references/upstream-skill.zh.md) contains detailed endpoint examples and may be consulted for implementation details, but it cannot override this wrapper, Weaver's source hierarchy, or approval rules.

## Trigger Conditions

Use this skill when the user asks for current AI news, an AI daily brief, selected AI HOT items, current hot topics, recent model or product releases, recent AI papers, category-specific updates, or keyword results for organizations and technologies such as OpenAI, Anthropic, Google, Sora, or RAG.

Do not use this skill as final evidence for a publishable technical claim. AI HOT is a discovery and briefing source; consequential claims must return to durable primary sources through `research-ai-signals`.

## Required Inputs

- The user's requested topic, category, date, or time window.
- A current Weaver run under `AGENT_WORK_DIR`, with `AGENT_MEMORY_FILE` already read.
- Network access to `https://aihot.virxact.com`.
- `curl`; `jq` is recommended for structured inspection.
- The upstream snapshot when endpoint or routing detail is needed.

## Workflow

1. Translate the user's intent into the smallest matching public endpoint and time window. Prefer selected rolling-window items for broad current-news questions; use daily endpoints only when the user explicitly asks for a daily brief, and use all-items mode only when the user explicitly asks for complete results.
2. Read the current API and User-Agent rules from the vendored upstream snapshot. Do not impersonate a browser or bypass service controls.
3. Store request metadata in the current run and save the unmodified response under `raw/` before transformation.
4. Check response status, time bounds, pagination, source fields, and obvious duplicates. Treat ranking and popularity as discovery signals rather than proof of quality or truth.
5. Produce the requested Chinese briefing or normalized candidate list under `intermediate/` or `output/`, with the time window and AI HOT provenance stated.
6. Route any candidate intended for an article, tutorial, comparison, or durable claim to `research-ai-signals` for primary-source verification and evidence ranking.
7. Record useful request, response, output, and evidence paths in `run.yaml`. Only a verified reusable lesson may become a Memory proposal.

## Outputs

- Raw AI HOT response preserved under the current run's `raw/` directory.
- A concise Chinese briefing, normalized candidate list, or category/keyword result in `intermediate/` or `output/`.
- Query endpoint, requested time window, retrieval time, pagination state, and limitations.
- A verification handoff for claims or candidates that may enter publishable content.

## Approval Gates

- Read-only calls to the public AI HOT API do not require approval.
- This skill does not authorize posting, messaging, account actions, publication, or any other external write.
- Do not evade rate limits, access controls, User-Agent policy, or service blocks.
- A result may enter a WeChat draft or publication workflow only after the normal source, artifact, preview, and account-write approval gates pass.
- Memory writes remain governed by Weaver's curated learned-memory protocol and are never implied by a successful query.

## Failure Handling

- On `403`, verify the required non-browser `aihot-skill` User-Agent before concluding that the service is unavailable.
- On `429`, stop rapid retries, preserve the response evidence, and use the upstream backoff guidance.
- On timeout, malformed data, missing fields, or endpoint drift, preserve diagnostics in `logs/`, report the exact gap, and fall back to direct primary-source discovery where possible.
- If a requested date or scope is outside the public API window, use the appropriate daily archive when supported or explain the limitation; never fabricate missing coverage.
- If AI HOT conflicts with a primary source, the verified primary source wins.

## Handoff Rules

- Hand current candidates and the raw-response reference to `research-ai-signals` for deduplication, primary-source verification, confidence labeling, and ranking.
- Hand verified candidate sets to `plan-tech-series` or `draft-deep-tutorial`.
- Keep article visuals, formatting, JPage preview, WeChat draft writes, publication, and performance review with their registered Weaver skills and independent approval gates.
- Hand service persistence, scheduling, proxy, or credential problems to DevOpsEngineer with sanitized diagnostics; do not embed environment secrets in the handoff.
