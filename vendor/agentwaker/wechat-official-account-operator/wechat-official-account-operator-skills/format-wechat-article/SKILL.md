---
name: format-wechat-article
description: Convert an approved, visually complete technical Markdown article into WeChat-compatible HTML and a self-contained JPage review document, then validate mobile readability, image integrity, metadata, and source notes. Use for WeChat editing, Markdown conversion, layout cleanup, article packaging, or pre-draft formatting only after design-wechat-visuals has produced final assets and an asset-gate manifest.
---

# Format WeChat Article

## Purpose

Prepare portable, inspectable HTML and metadata without writing to the user's WeChat account or revealing an unverified preview.

## Required Inputs

- Approved Markdown draft.
- Selected title, author, digest, source URL, CTA, and comment preference.
- Final cover and content image files; placeholders are not accepted.
- Current-revision `visual-manifest.json` with `asset_gate=pass` and all required assets approved.
- Theme choice and any brand constraints.

## Workflow

1. Read `../plan-tech-series/references/editorial-categories.md`, `references/wechat-formatting.md`, and `../design-wechat-visuals/references/visual-quality-gate.md` for category, syntax, package, and visual-gate requirements.
2. Reject a missing or stale manifest, missing or unsupported `article.category`, any required asset not marked approved, an image hash mismatch, unresolved placeholder, missing alt text or `▲` caption, or a Markdown image order that differs from the manifest. For `architecture-map`, also reject an H2 before the overview, an overlong orientation, a first body image that is not the declared complete overview, or any architecture/workflow detail that is not bound to the same overview regions.
3. Run `scripts/render_wechat_html.py INPUT.md --output article.wechat.html --theme green-tech` for the WeChat fragment. Keep the legacy themes available only for an explicitly requested alternate treatment; they are not the account default.
4. Run the renderer again with `--standalone --embed-local-images` to create `article.jpage.html`. This is the canonical visual review surface and must embed the exact reviewed image bytes.
5. Inspect the integrated standalone page at normal article width and narrow 375 px and 390 px mobile widths. Confirm image loading, order, sharpness, labels, captions, crop, text rhythm, headings, code, links, and source notes.
6. Only after actual inspection, record `integrated_render_gate=pass` in the current-revision manifest and run `../design-wechat-visuals/scripts/validate_visual_package.py --target jpage-preview` to create `visual-quality-report.json`.
7. Keep the gate closed unless the validator exits `0`, the report says `gate: pass`, and its manifest, Markdown, HTML, and asset hashes match the current package.
8. Create an image map that distinguishes local reviewed files from later WeChat-uploaded URLs, then package the Markdown, both HTML forms, manifest, quality report, title, author, digest, cover, source ledger, and readiness report.

## Outputs

- WeChat-compatible inline HTML.
- Self-contained `article.jpage.html` containing the exact reviewed images.
- Metadata and image map.
- `visual-quality-report.json` with `asset_gate=pass` and `integrated_render_gate=pass` bound to the current revision.
- Formatting readiness report and unsupported-syntax warnings.
- Optional manual fallback instructions for Doocs WeChat Markdown Editor or mdnice.

## Approval Gates

No approval is required for local rendering or local preview. Require approval before uploading images, creating or updating a WeChat draft, or sending unpublished content to a third-party editor.

## Failure Handling

If the bundled renderer cannot preserve a required construct, simplify it, convert it to an approved image, or use a reviewed manual editor. If any image is missing, stale, blocked, low quality, or unresolved, return to `design-wechat-visuals` and do not produce a preview-ready package. Never claim platform compatibility without visual inspection for complex layouts.

## Handoff Rules

Hand the complete, gate-passing local package only to `jpage-pre-draft-preview`. Return any cover, diagram, screenshot, chart, visual-density, or quality failure to `design-wechat-visuals`. Hand custom interactive asset work to FrontDeveloper.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
