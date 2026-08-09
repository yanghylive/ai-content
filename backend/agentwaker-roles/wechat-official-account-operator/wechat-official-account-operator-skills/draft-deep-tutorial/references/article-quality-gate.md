# Deep Article Quality Gate

## Before Research

- State one target reader and one reader promise.
- Identify the canonical project, current owner, official repository or product page, documentation, license, and release source.
- Freeze the tested version, date, operating system, architecture, model, provider, and budget boundary.
- Define the smallest real task that can prove or falsify the article's central claim.
- Review the code, credential, privacy, network, and cost risks before reproduction.

## Claim Ledger

Track every material claim:

| Field | Meaning |
|-------|---------|
| Claim | Exact factual statement the article intends to make |
| Source | Primary URL and optional corroborators |
| Verified at | Date and time of the check |
| Observation | Direct local evidence, if any |
| Confidence | High, medium, or low |
| Drift risk | What can change before publication |
| Rights | Permission or attribution status for reused material |

## Reproduction Log

Record:

- Exact installation and authentication method.
- Version and environment output.
- Input repository or fixture and starting commit.
- Commands, prompts, approvals, tools, and model selection.
- Expected and observed output.
- Test or validation result.
- Time, token, credit, or monetary cost when available.
- Errors, retries, manual intervention, and unresolved limitations.
- Cleanup and credential revocation when relevant.

## Draft Gate

- The article declares one category from `plan-tech-series/references/editorial-categories.md` and follows its sequence.
- The title matches the actual result and does not promise an untested outcome.
- The opening explains why this matters now without generic hype.
- The opening reaches the task or change within two short paragraphs without forcing a repeated account greeting.
- The mental model is understandable before the command sequence begins.
- Every command is scoped, copyable, version-aware, and safe enough for the stated reader.
- Direct observations, source-derived steps, inference, and opinion are distinguishable.
- Benchmarks include method, environment, baseline, and source.
- Pricing and availability have a verification date and regional caveat when needed.
- Security, privacy, permissions, lock-in, license, and failure modes are not hidden at the end.
- Alternatives are compared on the same job rather than feature-list marketing.
- Quotations are short, attributed, and necessary. Images and code have usable rights.
- Paragraphs and scan signals remain readable on a narrow mobile viewport.
- Every screenshot or diagram has useful alt text, a standalone `▲` caption, and a recorded rights status.
- Every H2 section has an explicit visual decision covering architecture, workflow, evidence, comparison, data, or concept needs.
- The article meets the adaptive visual floor in `design-wechat-visuals/references/visual-quality-gate.md`; the cover and decorative filler do not count.
- No two consecutive H2 sections remain text-only without a reasoned, approved density waiver.
- All promised visual slots are handed to `design-wechat-visuals`; placeholders cannot pass as finished assets.
- The article adds original explanation, reproduction, comparison, or synthesis.
- The conclusion tells the reader who should use the project, who should not, and what to try next.
- An `architecture-map` article places the complete architecture as the first body image before any H2, keeps the orientation brief, decomposes the same numbered regions with bound derivatives, and returns to the whole-system path.
- An `open-source-recommendation` article leads with a verdict and ends with a defensible `S`, `A`, `B`, or `Watch` rating supported by reproduction, alternatives, maturity, activity, license, maintenance, security, privacy, cost, and adoption risk.

## Publication-day Recheck

Recheck the latest release, ownership, license, repository state, product name, pricing, availability, model support, authentication, key commands, links, known security issues, and any project sunset or migration notice.
