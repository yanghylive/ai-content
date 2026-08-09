---
name: wechat-official-account-operator-skills
description: The complete reusable skill set for the WeChat Official Account Operator. Use this meta-skill to route registered editorial categories such as complete-map-first architecture breakdowns and open-source recommendations through AI signal research, planning, drafting, visual design, formatting, paired JPage review, WeChat draft or publishing actions, and performance review. Do not use it to perform work that belongs to another agent role.
---

# WeChat Official Account Operator Skills

## Purpose

Provide a single entry point for the WeChat Official Account Operator's reusable skills. This file describes every skill in the package, defines how they chain together, and states the environment and approvals required to run them safely. Every run first resolves `AGENT_WORK_DIR`, reads the complete `AGENT_MEMORY_FILE`, and records inputs, process artifacts, outputs, and evidence under `workdir-v1`. Use `aihot` for quick Chinese AI news lookups before or alongside `research-ai-signals`. Every finished article must contain a useful, quality-checked visual package; pass asset, integrated-render, and private remote-render gates; and store the same review revision as both Markdown and HTML in JPage before the preview location is revealed or any WeChat draft write occurs.

## Trigger Conditions

Use this meta-skill when:

- The user asks what this role can do or which skill owns a WeChat-related task.
- A request could match more than one skill and needs routing.
- A workflow must coordinate multiple skills (for example, research -> plan -> draft -> format -> publish).
- You need to confirm that required environment variables and approvals are in place before invoking a skill.

## Required Inputs

- User goal or task statement.
- Absolute `AGENT_WORK_DIR` and `AGENT_MEMORY_FILE` values. The memory path must resolve to this role's canonical `agent-soul/MEMORY.md`.
- Account type, certification state, and API permission state when publishing is involved.
- Locally configured environment variables from `env/.env.example` for the skills that will run.
- JPage base and token configuration when an article is moving from local formatting toward a WeChat draft.
- Explicit approval status for any external write, draft mutation, asset upload, public publication, or follower mass-send.

## Workflow

1. Run `ruby tools/agent-runtime.rb start --role .` from the repository root to validate and bind both runtime-storage paths, snapshot the execution contract and policy, and create the dated run; then read the complete canonical memory file before planning. Never hand-author `run.yaml`.
2. Identify the user's primary intent against the skill catalog below. For a finished article, assign exactly one category from `plan-tech-series/references/editorial-categories.md`; do not replace the category with a generic format label.
3. Confirm the target account state, available credentials, and required approvals.
4. Load only the environment variables needed for the selected skill path; never load secrets into tracked files or logs.
5. Invoke the matching specialist skill. For multi-step workflows, hand off in this order:
   - `aihot` (optional quick Chinese AI news lookup) -> `research-ai-signals` -> `plan-tech-series` -> `draft-deep-tutorial` -> `design-wechat-visuals` -> `codex-visual-production` when another runtime needs Codex ImageGen -> `format-wechat-article` -> `jpage-pre-draft-preview` -> `publish-wechat-article` or `save-wechat-browser-draft`.
   - `architecture-map` must open with the complete architecture as the first body image, then decompose overview-bound numbered regions. `open-source-recommendation` must produce an evidence-backed adoption verdict and rating. Future categories must enter the registry and connect to the same planning, drafting, visual, formatting, and validation path.
   - `design-wechat-visuals` is mandatory for every finished article. It must produce the real cover and required body images, meet the adaptive visual floor and selected category contract, and record `asset_gate=pass`; a brief or prompt alone cannot continue.
   - `format-wechat-article` must generate a self-contained visual HTML, inspect it at mobile widths, and record `integrated_render_gate=pass` with a machine-validated quality report.
   - `jpage-pre-draft-preview` must upload and verify both the Markdown source and rendered HTML for the same revision. Its role-scoped private default overrides broader or public-by-default examples in the vendored upstream JPage reference.
   - `jpage-pre-draft-preview` may reveal the private HTML preview location only after an internal remote mobile inspection records `remote_render_gate=pass` and every image loads correctly.
   - `review-wechat-performance` can follow any published article to inform the next cycle.
6. Store meaningful inputs, raw data, intermediate files, final outputs, and validation evidence under the current run as the work progresses. Use `agent-runtime.rb record` for atomic checkpoints around approvals, account writes, and material milestones.
7. Use `agent-runtime.rb close` for the terminal record, `propose-memory` / `promote-memory` for verified reusable lessons, and `validate` before claiming completion. A `none` outcome is normal; ordinary artifacts stay in the work directory.
8. Return the run path, output and evidence paths, memory outcome, residual risks, and the next action after each handoff or terminal step.

## Runtime Storage Contract

- Use `$AGENT_WORK_DIR/runs/YYYY/MM/DD/{run-id}/` with `run.yaml`, `input/`, `raw/`, `intermediate/`, `output/`, `evidence/`, `logs/`, `tmp/`, and `memory-update-proposal.md`; see `../workdir/README.md` for the full `workdir-v1` contract.
- Create and mutate the run only through `agent-runtime.rb start`, `record`, `close`, and `validate`; the record carries Profile, Skill, MCP, environment-example, Memory, approval, command, and policy evidence.
- Do not use the shell working directory, repository root, desktop, or `/tmp` as a silent substitute. External tools may use transient locations only when required; copy the meaningful artifact and evidence back to the run.
- Read `AGENT_MEMORY_FILE` before choosing a skill path or plan. Current instructions and current verified evidence override older memory.
- Promote memory only after verification and only inside `AGENT_LEARNED_MEMORY` markers, using the role lock and hash-conflict rules. Never write raw data, drafts, logs, secrets, or hidden reasoning to memory.

## Skill Catalog

| Skill ID | Purpose | Typical Trigger |
|----------|---------|-----------------|
| `aihot` | Query AI HOT (aihot.virxact.com) for Chinese AI news, daily briefs, hot topics, and category-specific signals. No API key required. | "What is happening in AI today?", "AI daily brief", "Recent OpenAI releases", "AI HOT" |
| `research-ai-signals` | Discover, verify, normalize, deduplicate, and rank current AI / agent / AI-coding signals for the WeChat technology account. | "Find this week's AI signals", "What's worth writing about?" |
| `plan-tech-series` | Turn ranked candidates into a coherent, paced article series with reader promises and evidence needs. | "Plan a series on Vibe Coding tools", "What should we publish next month?" |
| `draft-deep-tutorial` | Research and draft an original, evidence-backed, reproducible WeChat technology tutorial or explainer. | "Draft a tutorial on ...", "Write a deep article about ..." |
| `design-wechat-visuals` | Produce and inspect the final cover and adaptive set of evidence-safe screenshots, diagrams, charts, and conceptual images. | "Design the visuals for this article", "This draft needs more useful images" |
| `codex-visual-production` | Fulfill a validated Workdir visual request with Codex built-in ImageGen, deterministic overlays, inspected local assets, and a hashed result receipt without an OpenAI API key. | "Let Codex make these WeChat visuals", "Process the pending visual request" |
| `format-wechat-article` | Build WeChat HTML plus a self-contained visual review page, then validate the complete mobile rendering. | "Format this draft for WeChat", "Render the complete illustrated article" |
| `jpage-pre-draft-preview` | Store and privately verify the same Markdown and visual HTML revision, then reveal the preview only after remote image and mobile checks pass. | "Put the article preview in JPage", "Let me review the finished illustrated article" |
| `publish-wechat-article` | Manage WeChat content images, drafts, previews, publication jobs, and result checks through the official server API. | "Publish this article", "Upload images and create a draft" |
| `save-wechat-browser-draft` | Fill an approved article package into the logged-in official backend through a controlled browser and save a draft only. | "I don't have API access, save this as a backend draft" |
| `review-wechat-performance` | Review permitted WeChat metrics and reader signals, then recommend evidence-based editorial experiments. | "Review last month's articles", "What worked and what didn't?" |

## Outputs

- The correct skill entrypoint for the user's request.
- A clear handoff path when multiple skills are needed.
- A checklist of required environment variables and approvals.
- A finalized `run.yaml` with input, output, evidence, and curated-memory status plus the corresponding artifact paths.
- A verified JPage preview receipt with both Markdown and HTML file IDs plus passing asset, integrated-render, and remote-render gates before the preview is revealed or any WeChat draft write occurs.
- Evidence or blocker details when prerequisites are missing.

## Approval Gates

- No approval is required for read-only routing, planning, or local rendering.
- Require explicit approval before uploading the exact private Markdown and HTML preview pair to JPage. Public visibility is a separate approval and is never the default for unpublished WeChat content.
- Require explicit approval before any external write, asset upload, draft mutation, public publication, follower mass-send, deletion, or identity-bound action.
- Confirm that dangerous switches (`WECHAT_ENABLE_MASS_SEND`, `WECHAT_ENABLE_PUBLISHED_DELETE`) are intentionally set before allowing the corresponding skill to invoke them.
- Source-platform interactions, Xiaohongshu or other non-WeChat account operations, browser-clicked public or scheduled publication or follower mass-send, platform bypass, credential disclosure, and fabricated evidence are prohibited boundaries rather than actions made permissible by approval.

## Failure Handling

- If the request matches no skill, say so and suggest the correct receiving role from the routing table.
- If required environment variables are missing, stop and list the exact variable names without fabricating values.
- If either runtime path is relative, unusable, or belongs to another role, stop before substantive skill work; do not invent a fallback location.
- If memory changed concurrently or a proposed lesson is not durable and verified, keep `memory-update-proposal.md`, record `proposal-only` or `conflict`, and leave canonical memory unchanged.
- If the actual visual files, current-revision manifest, quality report, or any of the three visual gates are missing or failed, do not reveal a preview and do not continue to a WeChat draft.
- If either JPage preview file is missing, unverified, public without approval, or from a different article revision, preserve the local package and stop before any WeChat draft write.
- If approval is missing for a write operation, keep the workflow in a safe read-only or local state and report the blocker.

## Handoff Rules

- Hand quick AI HOT news results to `research-ai-signals` for verification, normalization, and ranking before they become article material.
- Hand research results to `plan-tech-series` or `draft-deep-tutorial`.
- Hand every approved finished-article revision to `design-wechat-visuals`. When the current runtime is not Codex, write a valid pending request for `codex-visual-production`; after Codex returns the assets and receipt, continue to `format-wechat-article`.
- Hand formatted local packages to `jpage-pre-draft-preview`; only a private Markdown and HTML pair with all three visual gates passing can be shown to the user or continue to `publish-wechat-article` or `save-wechat-browser-draft`.
- Hand published-article review to `review-wechat-performance`.
- Hand persistent infrastructure, scheduling, callbacks, or secret management to DevOpsEngineer.
- Hand public rendering verification to QAEngineer.
- Hand unresolved product positioning or commercial claims to ProductManager.
- Hand an approved source ledger and reusable asset package to XiaohongshuOperator only when the user explicitly requests a Xiaohongshu-native derivative; keep platform editing and account approvals separate.
