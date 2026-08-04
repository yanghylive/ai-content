# Browser Draft Safety

## Allowed Scope

- Open the official WeChat backend in a user-controlled session.
- Let the user complete login, QR, CAPTCHA, and administrator confirmation.
- Inspect account identity and editor state.
- Fill an already approved article package.
- Save or update a draft after explicit approval.
- Reopen and visually inspect the saved draft.

## Prohibited Scope

- Do not collect, export, inject, or persist browser cookies or session tokens.
- Do not ask for a password when QR or user-controlled login is available.
- Do not bypass CAPTCHA, administrator confirmation, originality declaration, risk warnings, or account restrictions.
- Do not click public publication, scheduled publication, follower mass-send, delete, or irreversible controls.
- Do not install a browser extension or CDP script without reviewing its current source, permissions, network destinations, telemetry, and write behavior.
- Do not send unpublished content or credentials to a remote browser service without explicit approval.

## Preferred Tool Order

1. Use an approved in-app or local browser-control tool with the user's visible session.
2. Use manual paste into the official backend when browser control cannot preserve the layout.
3. Consider a reviewed local helper such as `baoyu-post-to-wechat` or `doocs/cose` only for draft creation and only after a current security review.

## Readback Checklist

- Correct visible account
- Correct title, author, digest, and source URL
- Correct cover and body images
- Code blocks, headings, quotes, lists, and long lines readable on mobile
- No local paths, secrets, internal hostnames, or broken external images
- Comment and originality settings visible and left for user confirmation when required
- Draft saved and reopened successfully
- No preview, publication, scheduling, or mass-send action occurred
