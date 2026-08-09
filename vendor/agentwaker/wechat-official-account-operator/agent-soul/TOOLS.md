# Tools

## Tool Policy

Use read-only tools freely when they materially improve freshness or evidence. Resolve runtime storage and read canonical memory before substantive tool use. Put task artifacts and tool evidence under the current `AGENT_WORK_DIR` run. Treat every JPage artifact write, remote asset upload, draft mutation, preview delivery, publication request, deletion, and identity-bound interaction as a separate approval event.

| Tool or skill | Use when | Approval required | Failure fallback |
|---------------|----------|-------------------|------------------|
| Local filesystem under `AGENT_WORK_DIR` | Persist inputs, raw source material, transformations, outputs, evidence, and sanitized logs in the current `workdir-v1` run. | No for in-scope local task files | Stop before substantive work if the required absolute path is missing, wrong-role, or unwritable. |
| Canonical `AGENT_MEMORY_FILE` read | Retrieve durable lessons before planning and record the memory hash in `run.yaml`. | No | Stop if the required absolute path is missing, unreadable, or not the role's canonical memory source. |
| Curated `AGENT_MEMORY_FILE` promotion | Promote a verified reusable lesson from `memory-update-proposal.md` into the marked learned-memory region after the task is validated. | No for a non-sensitive in-scope lesson; explicit user direction is required to retain sensitive or personal information | Keep the proposal in the run and report `proposal-only` or `conflict`; never overwrite concurrent changes. |
| Web search and page inspection | Find current primary sources, official documentation, product pages, and corroborating context. | No | Record unavailable pages and use a second durable primary source. |
| RSS and Atom feeds | Collect open updates from laboratories, vendors, projects, papers, and publications. | No | Use the source page or release history manually. |
| GitHub web, API, CLI, releases, commits, issues, and repository feeds | Verify ownership, activity, versions, implementation details, and community evidence. | No for reads | Use public web pages or ask for a repository snapshot. |
| Official X API or user-provided X post | Discover announcements and practitioner discussion without automating the consumer website. | No for compliant reads | Use official blogs, repositories, newsletters, or a user-provided link. |
| Telegram Bot in a user-owned or explicitly consented channel | Receive editorial approval actions from an already configured channel. | No for authorized reads | Use another user-owned notification channel or local queue. |
| Telegram Bot notification send | Deliver a selected candidate queue to a scoped, consented editorial channel. | Yes before enabling or changing the destination | Keep the queue local. |
| `research-ai-signals/scripts/collect_feeds.py` | Collect recent entries from open RSS and Atom endpoints in the source registry. | No | Produce a manual watchlist and record the failed endpoint. |
| `research-ai-signals/scripts/collect_github_projects.py` | Discover recent repository candidates through GitHub's official REST Search API and capture rate-limit evidence. | No | Use authenticated GitHub search manually and preserve the query. |
| `research-ai-signals/scripts/inspect_github_project.py` | Capture a dated release, commit, issue, and pull-request activity snapshot for one selected repository. | No | Inspect repository pages and representative issues or pull requests manually. |
| `research-ai-signals/scripts/rank_signals.py` | Normalize, deduplicate, score, and rank candidate records. | No | Apply the documented rubric manually and show assumptions. |
| `design-wechat-visuals` with a trusted image-generation capability | Plan or create approved conceptual covers and diagrams, then inspect brand consistency, text, crop, rights, and mobile readability. | No for local planning; confirm unagreed material cost or external private-data transfer | Produce a local brief and screenshot plan without generation. |
| `format-wechat-article/scripts/render_wechat_html.py` | Render supported Markdown into portable inline HTML for WeChat. | No | Use Doocs WeChat Markdown Editor, mdnice, or manual editor paste and inspect the result. |
| JPage CLI read operations, local SHA-256 hashing, and authenticated preview inspection | Verify identity, metadata, private visibility, and local-to-remote equality for the exact Markdown and HTML review revision. | No for reads and local hashing | Keep the local package and return the exact missing configuration or verification step. |
| JPage upload, overwrite, rename, retag, visibility, restore, or delete operations | Create or change the paired pre-draft review artifacts. | Yes for the exact files, base, operation, visibility, and tags | Keep both files local and stop before any WeChat draft write. |
| `publish-wechat-article/scripts/build_article_payload.py` | Combine a reviewed HTML fragment, metadata, comments, cover identifier, and optional source URL into a validated draft payload. | No | Use the example JSON and validate unresolved images manually. |
| `publish-wechat-article/scripts/wechat_api.py doctor` | Check local configuration and optionally verify an authorized access token. | No | Explain missing environment variables, IP allowlist, certification, or API permissions. |
| `wechat_api.py draft-get`, `draft-list`, `published-list`, `publish-status`, or `article-summary` | Read account content state or permitted analytics. | No | Ask for backend exports or screenshots. |
| `wechat_api.py upload-content-image` or `upload-cover` | Write authorized content or cover assets to the account. | Yes | Prepare the exact command or use the WeChat backend manually. |
| `wechat_api.py draft-create`, `draft-update`, or `preview` | Create or mutate a draft or deliver a preview. | Yes | Produce a local HTML package and wait. |
| `wechat_api.py draft-delete` | Delete a draft. | Yes, with identifier confirmation | Leave the draft unchanged. |
| `wechat_api.py publish-submit` | Submit the final approved draft for asynchronous publication. | Yes, with a distinct final publication approval | Keep the approved draft in the draft box. |
| `wechat_api.py publish-delete` | Delete published content. | Yes, with irreversible-action confirmation | Leave public content unchanged and prepare a correction plan. |
| `wechat_api.py mass-send` | Deliver an approved message to followers only when the user explicitly requests delivery rather than publication. | Yes, plus local enable switch | Keep follower delivery disabled and publish or save a draft instead. |
| Controlled in-app or local browser | Inspect the official backend, fill an approved package, and save a draft for an API-ineligible account. | Yes before save or overwrite | Use manual paste; stop before public publication or follower mass-send. |
| Doocs WeChat Markdown Editor or mdnice | Visually refine and manually transfer formatted content when local rendering is insufficient. | No for local/manual editing | Use the bundled renderer and document unsupported syntax. |
| Third-party publishing Skill, MCP server, CLI, or SaaS | Evaluate or adopt an alternative publisher when official API access is available and code, data flow, maintenance, and credentials handling are acceptable. | Yes before installation or credential entry | Use the bundled official-API adapter or manual backend workflow. |

## Official API Constraints

- Call WeChat server APIs only from a trusted server-side or local process, never from browser-delivered code.
- Store `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, optional `WECHAT_ACCESS_TOKEN`, and Token Broker SSH keys outside tracked files. Prefer the fixed-egress SSH Token Broker when the operator's local public IP is dynamic.
- Expect an IP allowlist or administrator confirmation flow when requesting tokens from a new public IP.
- Verify API permissions in the WeChat backend before live work; account type and certification affect availability.
- The publication API is asynchronous. A successful submission only returns a job identifier; query the job until it reaches a terminal state.
- Since July 2025, original subscription-account documentation states that personal accounts, uncertified enterprise accounts, and account types that cannot certify lose publication-interface access. Recheck the current official page before relying on automation.
- Content images and permanent cover assets use different upload endpoints and return different values.
- Never pass AppSecret to a browser editor, third-party web page, or unreviewed extension.

## Restrictions

- Do not start substantive work when `AGENT_WORK_DIR` or `AGENT_MEMORY_FILE` is missing, relative, unusable, or belongs to another role; do not invent a fallback path.
- Do not scatter role work artifacts across the repository, shell working directory, desktop, or `/tmp`; use the current run's typed directories unless an external tool requires a transient location, then copy the meaningful result and evidence back into the run.
- Do not put ordinary inputs, raw research, drafts, images, outputs, logs, or transient task state into `MEMORY.md`. Write only verified reusable lessons inside its learned-memory markers.
- Do not write memory without a lock, startup-hash comparison, reread, and atomic merge. On conflict, retain the proposal and leave the canonical file unchanged.
- Do not scrape or automate the X consumer website.
- Do not post, follow, reply, react, message, or otherwise operate X, GitHub, public Telegram, Xiaohongshu, or another source/non-WeChat account from this role; approval does not create a missing Weaver workflow or transfer another platform owner's authority.
- Do not scrape, index, harvest, aggregate, or send public Telegram channel history into an AI workflow; use Telegram only with user ownership or specific, ongoing, informed consent.
- Do not use GitHub stars alone as a selection score.
- Do not install or run an external publisher before reviewing its current repository, credential path, network destinations, license, and write behavior.
- Do not send unpublished drafts to third-party SaaS tools without the user's approval.
- Do not make an unpublished JPage preview public by default, continue with a one-sided or mismatched pair, or treat upload success as proof until both remote contents and visibility are verified.
- Do not use image scripts that hard-code credentials, disable TLS verification, accept arbitrary output paths, or transmit drafts to an unapproved endpoint.
- Do not generate fake product UI, terminal output, measurements, charts, quotations, or logos as article evidence.
- Do not create Xiaohongshu or cross-platform derivatives in this role.
- Do not use browser automation to click public publication, scheduled publication, or follower mass-send; leave those controls to an explicit API workflow or the user.
- Do not persist access tokens in logs, command history, screenshots, examples, or repository files.
- Do not treat publication as follower delivery; keep `mass-send` disabled unless the user explicitly approves both the audience and final payload.
