---
name: jpage-pre-draft-preview
description: Upload and privately verify the same revision of a WeChat article's Markdown source and self-contained visual HTML after all required images pass asset and integrated-render gates. Use after format-wechat-article and before exposing a preview location or invoking publish-wechat-article or save-wechat-browser-draft; never reveal a preview with missing, stale, unreviewed, or broken images.
---

# JPage Pre-Draft Preview

## Purpose

Create a traceable, private JPage pair for every WeChat article before it enters the WeChat draft box. The Markdown is the editable source and the self-contained HTML is the canonical visual review surface. Both remote files and the remote mobile rendering must be verified before the preview location is shown to the user or the workflow continues to a WeChat draft write.

## Scope and Upstream Precedence

- This English wrapper is authoritative inside the WeChat Official Account Operator.
- `references/upstream-skill.zh.md` is the vendored JPage v1.6.6 reference from the user-provided bundle. Use it only for current CLI, upload, file-management, and rendering mechanics.
- This wrapper overrides the upstream global trigger and its public-by-default examples. A pre-draft WeChat preview is private by default and never inherits `isPublic=true` or `--public` automatically.
- The bundled reveal.js assets are preserved for upstream completeness, but slides and presentation generation are outside this pre-draft article workflow.

## Trigger Conditions

Use this skill when:

- `format-wechat-article` has produced the current article Markdown and rendered WeChat HTML.
- The user asks to preview, review, archive, or move a WeChat article toward the WeChat draft box.
- A downstream draft workflow needs proof that both pre-draft representations are already stored in JPage.

Do not use this skill for unrelated JPage administration, general websites, Xiaohongshu artifacts, public landing pages, or WeChat draft/publication writes themselves.

## Required Inputs

- The final local Markdown path for the current review revision.
- The self-contained `article.jpage.html` produced from that Markdown revision with reviewed images embedded.
- Current-revision `visual-manifest.json` and `visual-quality-report.json` showing `asset_gate=pass`, `integrated_render_gate=pass`, and matching Markdown, HTML, manifest, and asset hashes.
- A shared article stem and revision label for pairing the two files.
- Locally configured JPage values in `wechat-official-account-operator/env/.env`.
- Explicit approval to upload the exact Markdown and HTML files to the stated JPage base.

## Environment Contract

| Variable | Requirement |
|----------|-------------|
| `JPAGE_BASE` | JPage service base URL. The repository example uses `https://jpage.cn`; the local ignored file may override it. |
| `JPAGE_TOKEN` | Preferred JPage CLI credential. Never print, log, or commit it. |
| `MCP_TOKEN` | Optional compatibility credential when the selected JPage entrypoint uses it instead of `JPAGE_TOKEN`. |
| `JPAGE_TOKEN_URL` | Optional human-facing location for obtaining or rotating a token. The CLI does not consume this value directly. |
| `JPAGE_DEFAULT_VISIBILITY` | Must be `private` for this workflow unless the user separately approves public visibility. |
| `JPAGE_DEFAULT_TAGS` | Comma-separated tags applied to both preview files after upload. |

The role-local environment file is below the role root, so the JPage CLI will not discover it automatically from most working directories. Load it into the current process without echoing values:

```bash
ROLE_ROOT="$(git rev-parse --show-toplevel)/wechat-official-account-operator"
set -a
. "$ROLE_ROOT/env/.env"
set +a
```

Then verify configuration with read-only commands:

```bash
jpage --version
jpage whoami --base "$JPAGE_BASE"
jpage ls --base "$JPAGE_BASE" --limit 5
```

## Workflow

1. Run only after `format-wechat-article` has produced both files and a passing visual quality report, and before revealing a preview location or performing any API or browser-based WeChat draft write.
2. Load the ignored role environment file and confirm that `JPAGE_BASE` plus one supported token source are present without displaying their values.
3. Rerun `validate_visual_package.py --target jpage-preview`. Confirm that its report is current, its article revision matches the Markdown and HTML, every required asset hash matches, and both local gates pass.
4. Confirm that the Markdown and HTML use the same article stem and revision label. Compute a SHA-256 digest for each local file and compare them with the quality report.
5. Inspect both files for credentials, private notes not intended for the reviewer, unresolved local paths, blocked-image markers, unsupported claims, and accidental third-party data. The HTML must contain no relative, missing, or unreviewed image source.
6. Confirm `JPAGE_DEFAULT_VISIBILITY=private`. Present the exact base, two source paths, names, visibility, and tags, then obtain approval for this remote upload pair.
7. Upload both files without `--public`:

   ```bash
   jpage upload "$MARKDOWN_PATH" --base "$JPAGE_BASE"
   jpage upload "$HTML_PATH" --base "$JPAGE_BASE"
   ```

8. Capture both returned file IDs. Apply `JPAGE_DEFAULT_TAGS` to each ID when configured, and keep the pair under the same article stem and revision.
9. Read back file metadata and hash the authenticated remote content without printing it. Verify file name, type, private visibility, and content digest for both files.
10. Open the authenticated private HTML internally at narrow 375 px and 390 px widths. Confirm the page loads, every reviewed image renders, no image is broken or substituted, and captions, labels, crops, code, and text rhythm remain readable. This internal verification is not the user preview.
11. Record `remote_render_gate=pass` only after that inspection. Record a preview receipt containing all three visual gates, the base URL, article revision, Markdown and HTML file IDs and authenticated locations, local and remote hashes, visibility, tags, approval, and verification result.
12. Only after the remote gate passes may the authenticated HTML preview location be shown to the user or the package be handed to `publish-wechat-article` or `save-wechat-browser-draft`. One successful upload or a Markdown-only check is not completion.

## Outputs

- A private JPage Markdown source artifact and a private, self-contained HTML visual preview for the same article revision.
- A paired preview receipt with both file IDs, authenticated preview URLs, hashes, visibility, tags, `asset_gate`, `integrated_render_gate`, `remote_render_gate`, and verification state.
- A clear gate result: ready for a WeChat draft write, or blocked before any draft mutation.

## Approval Gates

- Local rendering, hashing, secret scanning, and read-only JPage checks do not require approval.
- Uploading the private Markdown and HTML pair is an external write and requires approval for the exact files and JPage base.
- Public visibility requires a separate explicit approval. Never infer it from approval to create a private preview or a WeChat draft.
- Overwrite, rename, visibility change, template instantiation, restore, and deletion each require approval for the exact target.

## Failure Handling

- If JPage configuration or authentication is missing, keep both local files and stop before any WeChat draft write. List only the missing variable names.
- If the visual manifest or quality report is missing, stale, failed, or from another revision, do not upload and do not expose a preview location.
- If only one file uploads, mark the pair incomplete, inspect current remote state before retrying, and do not create or update a WeChat draft.
- If local and remote hashes differ, treat the preview as stale or corrupted and upload a new private revision after confirming the action.
- If any remote image is missing, substituted, unreadable, or visually broken, keep the preview private and undisclosed, return to formatting or visual production, and repeat all affected gates.
- If the CLI is unavailable, use the upstream MCP upload mechanics only when an approved JPage MCP connection exists, preserving private visibility and the same dual-file verification gate.
- If JPage returns no shareable URL for a private file, return its file ID and authenticated preview location; do not make it public merely to obtain an anonymous link.

## Handoff Rules

- Hand a verified pair receipt and the unchanged local article package to `publish-wechat-article` or `save-wechat-browser-draft`.
- Return content or rendering corrections to `draft-deep-tutorial` and `format-wechat-article`, then create a new paired preview revision.
- Hand persistent token rotation, secret storage, or hosted automation to DevOpsEngineer.
- Hand independent preview rendering verification to QAEngineer when required.
