---
name: publish-wechat-article
description: Safely manage WeChat Official Account content images, cover assets, drafts, preview delivery, publication jobs, published articles, and result checks through the official server API. Use when the user asks to create, inspect, edit, preview, publish, verify, or delete WeChat content; enforce separate approvals for asset writes, draft mutations, public publication, and deletion.
---

# Publish WeChat Article

## Purpose

Move a reviewed local article package through the official WeChat draft and publication workflow with explicit permissions, credentials hygiene, and status evidence.

## Required Inputs

- Exact account label, type, certification state, and API permission state.
- An approved managed `WECHAT_ACCESS_TOKEN`, a fixed-egress SSH Token Broker, or local `WECHAT_APP_ID` and `WECHAT_APP_SECRET` setup.
- Final title, author, digest, HTML, cover, image map, source URL, comment settings, and copyright status.
- Current-revision visual manifest and quality report with `asset_gate=pass` and `integrated_render_gate=pass`.
- Verified private JPage pair receipt with `remote_render_gate=pass`; its revision and hashes must match the local package before any WeChat preview or draft write.
- Target draft or article identifier for update or delete operations.
- Explicit approval for the exact next write.

## Workflow

1. Read `references/official-api.md` for current endpoint behavior, account restrictions, and permissions. Read `references/market-landscape.md` only when evaluating an external editor, Skill, MCP, CLI, browser helper, or SaaS.
2. Verify the visual quality report and private JPage pair receipt. Stop if any required image is missing or changed, any visual gate is not `pass`, or the receipt revision and hashes differ from the local package.
3. Run `scripts/wechat_api.py doctor` without printing secrets.
4. Verify the public IP allowlist or administrator-confirmation state and the relevant API permissions in the WeChat backend.
5. Prefer an approved managed `WECHAT_ACCESS_TOKEN`; otherwise use the fixed-egress SSH Token Broker. Request a stable token from local AppID/AppSecret only as a compatibility fallback.
6. Upload the reviewed content images and replace their validated local references with returned WeChat URLs only after asset-write approval.
7. Upload the cover as a permanent image asset and record its media identifier only after asset-write approval.
8. Run `scripts/build_article_payload.py` to combine the final HTML fragment and metadata, rejecting unresolved local images or standalone preview HTML.
9. Present the exact article metadata and create or update a draft only after draft-write approval.
10. Read the draft back and inspect it in the WeChat backend or an equivalent preview.
11. Obtain a distinct final approval for this exact public version.
12. Submit the draft, record the publication job identifier, and query status until terminal.
13. Record the returned article identifier or URL on success; report the exact failure state otherwise.
14. Treat follower mass-send as a separate, higher-risk workflow that requires an explicit user request, a separate approval, and the local enable switch.

## Common Commands

```bash
python3 scripts/wechat_api.py doctor
python3 scripts/wechat_api.py draft-list --count 10
python3 scripts/wechat_api.py draft-get --media-id MEDIA_ID
python3 scripts/wechat_api.py upload-content-image --file ./image.png --confirm-write
python3 scripts/wechat_api.py upload-cover --file ./cover.png --confirm-write
python3 scripts/build_article_payload.py --html ./article.wechat.html --title "Title" --author "Author" --digest "Digest" --cover-media-id MEDIA_ID --output ./article.json
python3 scripts/wechat_api.py draft-create --payload ./article.json --confirm-write
python3 scripts/wechat_api.py draft-update --payload ./update.json --confirm-write
python3 scripts/wechat_api.py publish-submit --media-id MEDIA_ID --confirm-publish
python3 scripts/wechat_api.py publish-status --publish-id PUBLISH_ID
# Disabled by default; publication approval does not authorize this command:
WECHAT_ENABLE_MASS_SEND=1 python3 scripts/wechat_api.py mass-send --payload ./mass-send.json --confirm-mass-send
```

## Outputs

- Readiness and permission report.
- Exact approved command and redacted payload summary.
- Draft media identifier or publication job identifier.
- Post-write readback, terminal publication status, and article identifier or URL.
- Residual risks and manual fallback.

## Approval Gates

- Require asset-write approval before each upload batch.
- Require draft-write approval before create, update, preview, or delete.
- Require a distinct final publication approval after draft inspection.
- Require irreversible-action confirmation before deleting published content.
- Require a separate follower-delivery approval and local enable switch before mass-send.
- Never infer approval from earlier research, drafting, rendering, installation, or credential setup.

## Failure Handling

If visual or JPage receipts are missing, stale, or failed, return to `design-wechat-visuals`, `format-wechat-article`, or `jpage-pre-draft-preview` and perform no account write. Otherwise record the endpoint, safe error code, and response message without secrets. For invalid IP, update the authorized allowlist or administrator flow. For unauthorized API behavior, verify account type, certification, and backend permissions. For unavailable publishing automation, keep the content in draft-only or use the manual backend.

## Handoff Rules

Hand off persistent token management, callbacks, schedulers, or hosted collectors to DevOpsEngineer. Hand off public rendering verification to QAEngineer. Hand off article corrections to `draft-deep-tutorial` and `format-wechat-article` before another write.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
