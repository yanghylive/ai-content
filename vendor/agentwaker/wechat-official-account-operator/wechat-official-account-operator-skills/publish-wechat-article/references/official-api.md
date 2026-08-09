# Official WeChat API Notes

Verified against current official documentation on 2026-07-10. Recheck account permissions, limits, request fields, and lifecycle notices before a live write.

## Capability Map

| Capability | Endpoint | Official documentation | Gate |
|------------|----------|------------------------|------|
| Stable access token | `POST /cgi-bin/stable_token` | https://developers.weixin.qq.com/doc/service/api/base/api_getstableaccesstoken | Local secret configuration; no token output |
| Body image upload | `POST /cgi-bin/media/uploadimg` | https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage | Asset-write approval |
| Permanent cover asset | `POST /cgi-bin/material/add_material?type=image` | https://developers.weixin.qq.com/doc/service/api/material/permanent/api_addmaterial | Asset-write approval |
| Draft create | `POST /cgi-bin/draft/add` | https://developers.weixin.qq.com/doc/service/api/material/draft/api_draft_add | Draft-write approval |
| Draft update | `POST /cgi-bin/draft/update` | https://developers.weixin.qq.com/doc/service/api/material/draft/api_draft_update | Draft-write approval |
| Draft list and read | `POST /cgi-bin/draft/batchget`, `draft/get` | https://developers.weixin.qq.com/doc/service/guide/product/draft.html | Read-only |
| Mobile preview | `POST /cgi-bin/message/mass/preview` | https://developers.weixin.qq.com/doc/service/api/notify/message/api_preview.html | Preview-write approval |
| Publication submit | `POST /cgi-bin/freepublish/submit` | https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit | Distinct public-publication approval |
| Publication status | `POST /cgi-bin/freepublish/get` | https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_get | Read-only |
| Follower mass send | `POST /cgi-bin/message/mass/sendall` | https://developers.weixin.qq.com/doc/service/api/notify/message/api_sendall.html | Extra high-risk approval and local enable switch |
| Article summary | `POST /datacube/getarticlesummary` | https://developers.weixin.qq.com/doc/service/api/wedata/news/api_getarticlesummary | Read-only; permission dependent |

Subscription-account documentation is now separated from service-account documentation. Use the account-specific documentation and verify the permission list shown in the WeChat backend.

## Token and Network

- Prefer the stable-token endpoint over legacy token retrieval.
- Keep AppID and AppSecret in a server-side environment or secret manager. Never pass AppSecret as a CLI option.
- For a fixed-egress deployment, the bundled client can retrieve a cached token through a forced-command SSH account. The broker remains loopback-only and the local operator stores only a dedicated SSH private key.
- WeChat can reject token requests from a public IP that is not on the account allowlist or has not completed the administrator-confirmation flow.
- A dynamic residential public IP is a poor production caller. Use a trusted fixed-egress server, an approved secret service, or an official gateway design.
- For multiple customer accounts, use WeChat Open Platform third-party authorization instead of collecting each customer's AppSecret.

## Image Roles

- Upload article-body images through `media/uploadimg`. Current documentation limits this endpoint to JPG or PNG below 1 MB. The returned URL belongs in the HTML content.
- Upload a cover through permanent material management. Record the returned `media_id` as the article cover identifier.
- Do not leave local image paths or arbitrary external image URLs in the final draft payload.
- Record content-image URL, original local file hash, cover media identifier, rights status, and approval.

## Draft, Preview, Publication, and Delivery Are Different

1. **Draft create or update** changes content in the backend but is not public.
2. **Preview** sends a review copy to a target account identity. It is not a public preview URL and is permission and quota limited. Current documentation describes enterprise-certification constraints and a daily limit; verify both before use.
3. **Publication submit** creates an asynchronous publication job. Success means accepted, not published.
4. **Publication status** returns a terminal success or failure and, on success, the article identifier and URL details.
5. **Mass send** delivers to followers and is not equivalent to publication. It can require administrator confirmation and can consume or invalidate the draft identifier. Keep it disabled by default.

Do not infer publication or mass-send approval from draft approval.

## Publication Status

Interpret the current `publish_status` values from the official page:

- `0`: success
- `1`: publishing
- `2`: originality failure
- `3`: ordinary failure
- `4`: platform review rejection
- `5`: all articles deleted by the user after success
- `6`: all articles blocked by the platform after success

On success, capture `publish_id`, `article_id`, item URLs, content hash, approval identity, and completion time. On failure, capture the safe error code, failed item index when supplied, and remediation.

## Account Restrictions

The current publication guide states that, from July 2025, personal-entity accounts, uncertified enterprise accounts, and account types that cannot certify lose the publication-interface permission. Do not assume `freepublish` exists for a personal or uncertified account. Keep a controlled browser-to-draft fallback and final manual publication for accounts without the official permission.

## Scheduling

`freepublish/submit` has no scheduled-publication timestamp. A scheduled workflow requires an external scheduler that calls the endpoint at the approved time, or a manual/backend/browser process. Persistent scheduling, secret storage, callbacks, and fixed egress belong to a deployed service with DevOps ownership.

## CLI Safety

The bundled CLI:

- Reads credentials only from environment variables.
- Supports a fixed-egress SSH Token Broker without exposing an HTTP endpoint publicly.
- Requires confirmation flags for every write class.
- Requires `WECHAT_ENABLE_MASS_SEND=1` in addition to `--confirm-mass-send`.
- Requires `WECHAT_ENABLE_PUBLISHED_DELETE=1` in addition to `--confirm-delete`.
- Allows an HTTP API base only for localhost tests.
- Does not log request payloads or access tokens.

The flags prove only that a human-approved command was intentionally constructed. The agent must still present the exact target and redacted payload summary before executing it.
