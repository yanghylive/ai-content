---
name: codex-visual-production
description: Fulfill a pending WeChat visual request through Codex's built-in ImageGen entitlement without an OpenAI API key or separate image API integration. Use when Kimi or another text agent has written a valid visual-request.json into the current WeChat Workdir v1 run and Codex must generate conceptual raster backgrounds, add deterministic Chinese typography, inspect candidates, and return hashed local assets and a visual-result.json; do not use outside Codex, for evidence fabrication, or as a synchronous API/MCP promise.
---

# Codex Visual Production

## Purpose

Turn a validated WeChat visual request from Kimi or another runtime into inspected local assets by using Codex's built-in ImageGen entitlement and deterministic local rendering, without an OpenAI API key.

## Trigger Conditions

Use only when the current Codex task has a valid WeChat Workdir v1 run containing `input/visual-request.json` with `status: pending_codex`.

## Required Inputs

- Bound `AGENT_WORK_DIR` and the current run's `run.yaml`.
- A protocol v1 request with frozen article revision, placements, exact copy, art direction, avoid list, candidate budget, and generated-concept evidence policy.
- User approval before private or unpublished inputs are sent to the built-in generator.

## Contract

Operate only inside the current WeChat run resolved by `AGENT_WORK_DIR`. Read `references/request-schema.md`, then validate `input/visual-request.json` with `scripts/visual_inbox.py` before generating anything.

Treat this as an asynchronous file handoff:

1. Kimi or another agent writes the request and stops at `status: pending_codex`.
2. Codex validates and claims the request.
3. Codex uses its built-in `imagegen` skill/tool when that capability is actually available.
4. Codex stores generated sources under `intermediate/visuals/`, deterministic final images under `output/assets/`, and inspection evidence under `evidence/visuals/`.
5. Codex completes the request with exact paths, SHA-256 values, provenance, review state, and residual issues.

Never require or read `OPENAI_API_KEY`. The Codex product entitlement is not an API and must not be exposed as one. If built-in ImageGen is unavailable, leave the request pending and report `codex_imagegen_unavailable`.

## Workflow

1. Run `python3 scripts/visual_inbox.py validate --request "$AGENT_WORK_DIR/input/visual-request.json" --platform wechat`.
2. Run `compile`. It must reject vague visual contracts and write `intermediate/visuals/compiled-prompt.json` plus `compiled-prompt.txt`. Never hand a free-form upstream prompt directly to ImageGen.
3. Inspect the passing compiler receipt, then run `claim` with executor `codex`. Claim rejects missing or stale compiled prompts.
4. Read `design-wechat-visuals` and apply its brand, density, evidence, crop, manifest, and integrated-render rules.
5. Use ImageGen only for conceptual raster subjects, scenes, light, texture, or edits. Generate no evidence-looking interface, terminal, benchmark, logo, or unverifiable result.
6. Keep Chinese headlines, exact claims, diagrams, screenshots, and data deterministic. Add them locally after selecting a background. For `architecture-map`, route the complete overview and all overview-bound detail figures to the code-native architecture infographic system; ImageGen may support only a separate abstract cover background.
7. Inspect every candidate at full size, article width, current cover crop, and mobile thumbnail. Reject generic AI motifs, template sameness, artifacts, or insufficient relationship to the article.
8. Store the selected files inside the current run. Run `complete` with the final files and a review summary.
9. Hand `evidence/visual-result.json` and ordered assets back to `design-wechat-visuals` for the normal manifest and render gates.

## Commands

```bash
python3 scripts/visual_inbox.py validate \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat

python3 scripts/visual_inbox.py compile \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat

python3 scripts/visual_inbox.py claim \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat --executor codex

python3 scripts/visual_inbox.py complete \
  --request "$AGENT_WORK_DIR/input/visual-request.json" \
  --platform wechat \
  --asset "$AGENT_WORK_DIR/output/assets/cover.png" \
  --review "$AGENT_WORK_DIR/evidence/visuals/review.md"
```

## Outputs

- Conceptual source candidates under `intermediate/visuals/`.
- Deterministically rendered and inspected final assets under `output/assets/`.
- A local review record and `evidence/visual-result.json` containing paths, hashes, provenance, and completion time.
- A deterministic prompt compiler receipt and final ImageGen prompt bound to the request hash.

## Approval Gates

- Do not perform JPage, WeChat asset, draft, preview, publication, or mass-send writes.
- Confirm before sending private text, screenshots, code, or internal data to ImageGen.
- Do not claim subscription cost, quota, or unlimited availability; record only observed capability and completion.
- A request is complete only when every declared final path exists inside the run and its hash is recorded.

## Failure Handling

- If ImageGen is unavailable, do not claim completion; preserve or restore `pending_codex` and report `codex_imagegen_unavailable`.
- If validation, rights, privacy, crop, copy, or visual review fails, keep the request blocked or processing with the exact reason and no fabricated asset.
- If the request contains credentials or escapes the run, reject it before generation.

## Handoff Rules

Return the result receipt and ordered files to `design-wechat-visuals`. Only its normal manifest, integrated-render, and remote-render gates may continue toward preview or a WeChat draft.
