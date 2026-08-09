---
name: design-wechat-visuals
description: Produce and verify the final cover, diagrams, screenshots, charts, and in-article images for every WeChat Official Account article before formatting or preview. Use after an article revision is stable enough for visual production, when existing article visuals are sparse or weak, or whenever a draft needs an adaptive visual-coverage scan, actual image generation, evidence-safe captures, a machine-readable manifest, and an asset quality gate; do not use for Xiaohongshu or cross-platform content.
---

# Design WeChat Visuals

## Purpose

Turn an approved WeChat article into a coherent set of finished, high-quality visual files that explain the content, preserve evidence, and match the account brand. A brief, prompt, or missing-image list is not completion. Do not create account drafts, upload assets, or expose a preview link.

## Required Inputs

- Approved topic, outline, or article draft.
- Selected editorial category and its contract from `../plan-tech-series/references/editorial-categories.md`.
- Stable article slug and revision shared by the Markdown, manifest, and later preview HTML.
- Reader promise and the claims that visuals must clarify.
- Available screenshots, charts, diagrams, logos, and their rights status.
- Current WeChat cover crop shown by the backend when a cover is required.
- Any explicit budget, image count, text, or visual constraints.
- A local article package directory where final assets and the manifest can be stored.

## Workflow

1. Read `../plan-tech-series/references/editorial-categories.md` and load the selected category contract. Read `references/brand-system.md` and bind the package to `green-black-white-tech` before choosing a cover or body-visual route. For `architecture-map`, also read `references/architecture-infographic-system.md` before drawing anything.
2. Read `references/visual-quality-gate.md` and `references/visual-brief-template.md`. Use `references/visual-manifest.example.json` only as a compact schema example.
3. Scan every H2 section. Record whether the reader needs a screenshot, architecture or workflow diagram, comparison, chart, conceptual illustration, or an explicitly justified text-only section.
4. Apply the article-type floor in `visual-quality-gate.md`. The cover and decorative assets do not count, and two consecutive text-only H2 sections require an approved waiver.
5. Prefer real screenshots for product interfaces, commands, errors, and measured results; original diagrams for structure and flow; source-bound charts for data; and generated concepts for covers or abstract explanation. Never generate evidence-looking UI, terminal output, charts, logos, or benchmarks.
6. Select one category treatment inside the green-black-white system. Let black and white carry the composition and use green only for active paths, verified states, selected regions, and editorial verdicts. Prefer deterministic diagrams and real evidence over generated conceptual scenes.
7. Produce the actual final files. Generate at least two cover compositions unless the user has already selected a precise reference direction; for other conceptual assets, iterate until one passes the gate. Select the strongest candidate, remove accidental or incorrect text, and add essential labels deterministically. For diagrams and charts, preserve an editable source and export the reviewed publishable image as PNG.
   - For `architecture-map`, use structured data plus deterministic SVG, HTML/CSS, Mermaid-derived SVG, Graphviz, Figma components, or another code-native vector route. Produce the complete architecture overview first. Give it stable numbered regions, names, colors, arrows, boundaries, dependencies, storage, and a legend. Derive every local architecture or workflow explanation from that overview by highlighting or zooming the relevant region; preserve the overview's IDs, names, colors, and relationship semantics. Record the overview and detail bindings in the manifest. Do not use ImageGen for the overview or its detail diagrams.
   - For `open-source-recommendation`, prioritize a workflow or capability map, real evidence for the minimal use case, and a same-job comparison or decision visual. Do not substitute decorative launch graphics for adoption evidence.
   - When the current runtime lacks a suitable image generator but Codex is available as a separate task surface, write a v1 request for `codex-visual-production` inside the current run and stop at `pending_codex`. Do not request or invent an OpenAI API key and do not describe the asynchronous handoff as an MCP or API call.
8. Inspect each final file at original size, article width, the current backend crop, and a narrow mobile thumbnail. Check factual accuracy, exact text, AI artifacts, composition, contrast, brand consistency, crop safety, watermark, rights, privacy, and evidence status. Reject generic AI motifs, beige product staging, three-dimensional paper or toy scenes, decorative metaphors, card piles, and any asset that fails to explain the article.
9. Create `visual-manifest.json`, bind every review to the final file SHA-256, and record alt text, `▲` caption, placement, dimensions, requirements, hard-check results, and quality scores. Mark `asset_gate=pass` only when every required asset is `approved` and no placeholder remains.
10. Hand the finished assets, human-readable brief, and manifest to `format-wechat-article`. That skill must build and validate the integrated page before `jpage-pre-draft-preview` may upload or reveal anything.

## Outputs

- WeChat-only visual direction and cover treatment.
- Final cover and all required body-image files.
- Human-readable visual brief plus machine-readable `visual-manifest.json` bound to the article revision.
- Editable diagram or chart sources when applicable, and generation or capture provenance.
- Final asset paths, hashes, dimensions, alt text, captions, rights notes, quality scores, and crop-readiness evidence.
- `asset_gate=pass`, or an explicit blocked result listing missing or rejected assets. A blocked result cannot continue to preview.

## Approval Gates

- No approval is required for a local visual brief or manifest.
- Confirm before a paid or unusually large generation batch when cost was not already agreed.
- Confirm before sending unpublished text, private screenshots, source code, or internal data to any external generation service.
- Treat uploading a generated or captured asset to WeChat as a separate write owned by the publishing skill.

## Failure Handling

- If the current cover crop is unknown, produce a crop-safe master and mark backend verification as required.
- If a screenshot contains private data, redact it locally or replace it with a clearly labeled schematic.
- If generated text is inaccurate, remove it and add the label in the article layout instead of repeatedly regenerating decorative text.
- If an asset lacks clear rights, omit it or create an original explanatory alternative.
- If the adaptive visual floor cannot be met with useful assets, stop with a reasoned gap report or obtain an explicit density waiver; never fill the gap with decoration.
- If any required asset fails factual, technical, mobile, rights, privacy, or quality review, regenerate, recapture, or redesign it and keep `asset_gate=fail`.

## Handoff Rules

- Always hand final local assets and the current-revision manifest to `format-wechat-article`; visual production is no longer an optional branch for a finished article.
- Hand custom interactive diagrams or code-native visualizations to FrontDeveloper.
- Hand account uploads, draft mutations, and publication to the relevant WeChat publishing skill.
- Do not create Xiaohongshu cards, notes, covers, publishing tasks, or cross-platform derivatives in this skill.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
