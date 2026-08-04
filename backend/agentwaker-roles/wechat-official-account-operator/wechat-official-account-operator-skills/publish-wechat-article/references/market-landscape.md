# WeChat Publishing Tool Landscape

Security and capability snapshot verified on 2026-07-10. Re-audit current code, releases, license, credential flow, telemetry, network destinations, and write behavior before installing or using any external tool.

## Recommended Building Blocks

| Project | Best role | Important boundary |
|---------|-----------|--------------------|
| `jiji262/wechat-publisher` | Skill and Python reference for Markdown themes, images, covers, and safe draft creation | Prefer its draft-first design, but replace legacy token use and plaintext secret examples before production. https://github.com/jiji262/wechat-publisher |
| `@wenyan-md/mcp` | Markdown-to-WeChat draft MCP with themes, remote images, multiple accounts, and remote deployment | Treat it as a draft tool, not a public publisher; trust and host the MCP endpoint yourself. https://github.com/caol64/wenyan-mcp |
| `doocs/md` | Strong technology-article renderer with code, math, diagram, and theme support | Its MCP renders HTML; combine it with an audited draft or official-API adapter. https://github.com/doocs/md |
| `baoyu-post-to-wechat` | Browser/CDP fallback that avoids AppSecret and fixed-IP API requirements | Restrict automation to editor fill and draft save; complete a current script audit before use. https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-post-to-wechat |
| `doocs/cose` | Move formatted Doocs content into a logged-in official editor and save a draft | Browser DOM and session dependent; never assume it can safely publish. https://github.com/doocs/cose |

## Conditional Tools

| Project | Use only when | Risk to review |
|---------|---------------|----------------|
| Wechatsync | Multi-platform syndication is a real requirement | Backend cookies, non-public interfaces, broad extension permissions, optional telemetry, and localhost exposure. https://github.com/wechatsync/Wechatsync |
| AGI Super Team WeChat Toolkit | A source example for Wenyan or official draft create/update | It does not implement public publication. https://github.com/aAAaqwq/AGI-Super-Team/tree/main/skills/wechat-toolkit |
| wechat-auto-publishing | Studying current backend UI automation | License clarity, cookie handling, publish-button behavior, and failure recovery need review. https://github.com/16Miku/wechat-auto-publishing |

## Do Not Adopt Without a New Security Fix and Audit

- `tc6-01/weixin-mcp`: the reviewed snapshot sent credentials and content over plaintext HTTP to a hard-coded third-party address. https://github.com/tc6-01/weixin-mcp
- `BobGod/wechat-publisher-mcp`: the reviewed snapshot did not match current official behavior for cover format, preview, status, and URL handling. https://github.com/BobGod/wechat-publisher-mcp
- `xwang152-jack/wechat-official-account-mcp`: the reviewed snapshot had publication-status and deletion issues and exposed AppSecret through CLI process arguments. https://github.com/xwang152-jack/wechat-official-account-mcp
- Public remote Wenyan MCP instances: do not provide AppSecret or unpublished content unless the operator, deployment, and data handling are explicitly trusted.

This is a dated code-review conclusion, not a permanent allegation. Recheck the latest commit before repeating it publicly.

## Commercial Editors

- 135 Editor: strong manual layout, draft synchronization, multiple accounts, and scheduled workflows; no suitable public Agent REST or MCP interface was found. https://www.135editor.com/books/chapter/1/25
- Yiban: deep browser-plugin integration with the WeChat backend; long-lived preview links are vendor functionality, not an official WeChat API. https://yiban.io/help
- Xiumi: useful manual layout tool; its enterprise synchronization interface is aimed at sending Xiumi content to third-party CMS systems, not general Agent control of Xiumi or WeChat. https://xiumi.us/

Use these as human editing workbenches. Do not reverse-engineer their private page APIs as the production Agent backend.

## Recommended Architecture

1. Render with the bundled conservative renderer, Doocs, or a self-hosted Wenyan instance.
2. Use the bundled official-API client for a certified account with fixed egress and an audited secret path.
3. Default to draft creation, readback, and human inspection.
4. Require a separate public-publication approval and status confirmation.
5. For an account without official publication permission, use a controlled browser only to fill and save the draft; publish manually.
6. Keep follower mass-send disabled unless the user explicitly enables and approves it as a separate operation.
7. Save a redacted audit record: content hash, asset identifiers, draft identifier, reviewer, approval time, publication job, article identifier, final URL, and failure reason.
