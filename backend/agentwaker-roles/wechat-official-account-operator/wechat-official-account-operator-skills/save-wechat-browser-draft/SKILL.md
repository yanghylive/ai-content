---
name: save-wechat-browser-draft
description: Fill an approved WeChat article package into the logged-in official backend through a controlled browser and stop after saving and verifying a draft. Use for personal, uncertified, or otherwise API-ineligible accounts, or when the user explicitly prefers the backend editor; never automate public publication or follower mass-send.
---

# Save WeChat Browser Draft

## Purpose

Provide a controlled draft-only fallback when official publication APIs are unavailable or inappropriate.

## Required Inputs

- A complete, approved local article package.
- Current-revision visual quality report plus private JPage pair receipt with `asset_gate`, `integrated_render_gate`, and `remote_render_gate` all set to `pass`.
- A user-controlled browser session and manual WeChat backend login.
- Exact account identity, title, author, digest, content, cover, images, source URL, and comment settings.
- Explicit approval to create or update the target draft.

## Workflow

1. Read `references/browser-draft-safety.md` before opening the backend.
2. Validate the local article package, content hash, visual quality report, and JPage pair receipt. Stop if an image or document changed after review or any visual gate is missing or failed.
3. Open the official WeChat backend in a controlled browser. Let the user complete login, QR confirmation, and any administrator checks.
4. Confirm the visible account identity before editing.
5. Navigate to the article editor and present the exact intended draft mutation.
6. After approval, fill title, author, digest, HTML or formatted body, source URL, cover, images, and comment settings.
7. Save as a draft only.
8. Reopen or inspect the saved draft and record title, modification time, visual state, and any fields that did not transfer.
9. Stop before preview delivery, public publication, scheduling, or follower mass-send.

## Outputs

- Draft-save result and visible draft identity.
- Redacted content hash and field checklist.
- Visual defects, manual steps, and unresolved platform warnings.
- Explicit statement that no public publication or mass-send occurred.

## Approval Gates

Require approval immediately before saving or overwriting a draft. Treat preview delivery, scheduling, public publication, and follower mass-send as separate operations that this skill does not perform.

## Failure Handling

If the visual receipts are missing, stale, or failed, return to visual production, formatting, or JPage verification and do not touch the backend. If login, QR confirmation, CAPTCHA, administrator confirmation, originality declaration, editor behavior, or platform warnings block progress, stop and give control to the user. Do not bypass controls or inject cookies. Preserve the local package and report the exact visible blocker.

## Handoff Rules

Hand off final manual publication to the user. Hand off visual verification to QAEngineer. If the account later gains official API permissions and fixed egress, hand off future drafts to `publish-wechat-article`.
## Trigger Conditions

Use this skill when the request matches the workflow described here and remains within the WeChat Official Account Operator boundary.
