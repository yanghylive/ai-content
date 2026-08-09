# Vibe Coding Editorial Backlog

Verified as a planning snapshot on 2026-07-10. Recheck repository ownership, release activity, license, product naming, pricing, and lifecycle before publication.

## Current Fast-track Case Study

**Bun v1.4 Rust rewrite** is a strong AI-coding process article rather than a tool review. Start from the [official engineering article](https://bun.com/blog/bun-in-rust), [public rewrite pull request](https://github.com/oven-sh/bun/pull/30412), [repository](https://github.com/oven-sh/bun), and [v1.3.14 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14). Test the frozen Zig release against a dated Rust canary on the same machine, then use [AsyncLocalStorage issue #33806](https://github.com/oven-sh/bun/issues/33806) as a concrete regression probe. The durable angle is how large-scale agent-generated code becomes reviewable through independent review, language-independent tests, partitioned worktrees, and human gates. Do not repeat internal model, token, cost, test, or performance claims as independently verified without external evidence.

## Recommended First Twelve Series

1. **Terminal coding agents on one repository** - Compare [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Pi](https://github.com/earendil-works/pi), [OpenCode](https://github.com/anomalyco/opencode), [Kimi Code](https://github.com/MoonshotAI/kimi-code), and [Crush](https://github.com/charmbracelet/crush) on the same scoped task.
2. **MCP, ACP, Agent Skills, and AGENTS.md** - Explain which connection, client, procedure, and repository-instruction problem each standard solves.
3. **OpenHands Agent Canvas** - Explain the move from one software-engineering agent to a self-hosted multi-agent control surface.
4. **Google's interactive and asynchronous routes** - Compare Gemini CLI, Antigravity, and Jules by control loop and execution environment.
5. **From Windsurf to Devin Desktop and Cascade** - Trace the product and workflow transition without relying on outdated Windsurf material.
6. **The Roo Code succession problem** - Explain lifecycle risk and the relationship among Cline, Kilo, the retired Roo project, and newer successors.
7. **Spec-driven development as a Vibe Coding control system** - Use GitHub Spec Kit, AGENTS.md, tests, and review gates on one real feature.
8. **Continuous AI for repository maintenance** - Use GitHub Agentic Workflows to define periodic issue, pull-request, and maintenance jobs with permissions and cost controls.
9. **AI app builders on one product brief** - Compare Dyad, bolt.diy, Lovable, Bolt, v0, and Replit for code ownership, backend, deployment, export, and lock-in.
10. **An agent is not a sandbox** - Compare E2B, Daytona, and Vercel open-agents as execution and isolation architectures.
11. **The coding-agent context stack** - Compare Context7, Serena, Repomix, MCP, CLI, and Skills for accuracy and token cost.
12. **Chinese AI coding ecosystem** - Cover Qwen Code, Kimi Code, Trae Agent, CodeBuddy, and Qoder with access, cost, language, model, and workflow differences.

## Open-source Project Queue

| Project | Canonical source | Stable article angle |
|---------|------------------|----------------------|
| OpenAI Codex CLI | https://github.com/openai/codex | Local sandbox, approvals, repository instructions, CLI/IDE/cloud boundaries |
| Gemini CLI | https://github.com/google-gemini/gemini-cli | Search, MCP, GitHub automation, and Google's wider agent strategy |
| Pi | https://github.com/earendil-works/pi | Minimal extensible agent harness and the security cost of minimalism |
| OpenCode | https://github.com/anomalyco/opencode | Model-independent TUI, LSP, sessions, and workflow portability |
| Crush | https://github.com/charmbracelet/crush | Terminal experience, model switching, LSP, MCP, Skills, and architecture |
| Kimi Code | https://github.com/MoonshotAI/kimi-code | Parallel subagents, hooks, plugins, ACP, and migration from the older CLI |
| Qwen Code | https://github.com/QwenLM/qwen-code | Adapting an agent harness to a model family, authentication, and cost |
| Mistral Vibe | https://github.com/mistralai/mistral-vibe | Agents, subagents, Skills, MCP, AGENTS.md, and spend limits in a small CLI |
| Cline | https://github.com/cline/cline | Human approval, CLI/SDK expansion, and worktree-based multi-agent work |
| Kilo Code | https://github.com/Kilo-Org/kilocode | Ecosystem lineage across IDE, CLI, cloud, and collaboration surfaces |
| OpenHands | https://github.com/OpenHands/OpenHands | Agent SDK, server, Canvas, self-hosting, and multi-agent orchestration |
| Zed | https://github.com/zed-industries/zed | An open editor as a neutral ACP client for multiple agents |
| Continue | https://github.com/continuedev/continue | The shift from chat assistant to source-controlled AI checks in CI |
| Trae Agent | https://github.com/bytedance/trae-agent | Modular SWE-agent research, trajectories, model support, and MCP |
| Aider | https://github.com/aider-ai/aider | Git-first editing, repository map, lint/test/commit, and architectural legacy |
| SWE-agent | https://github.com/SWE-agent/SWE-agent | Agent-computer interface, trajectory design, and SWE-bench evaluation |

## Open-source App Builder Queue

| Project | Canonical source | Stable article angle |
|---------|------------------|----------------------|
| Dyad | https://github.com/dyad-sh/dyad | Local-first, privacy, BYOK, license boundaries, and app-builder usability |
| bolt.diy | https://github.com/stackblitz-labs/bolt.diy | Multi-model app building, Electron, MCP, backend integration, and WebContainer licensing |
| Open Lovable | https://github.com/firecrawl/open-lovable | Site capture, sandbox execution, and React generation as an architecture example |
| Onlook | https://github.com/onlook-dev/onlook | Visual-first React editing and current project-health evaluation |
| Vercel open-agents | https://github.com/vercel-labs/open-agents | Web UI, durable workflow, sandbox, and GitHub integration for a cloud coding agent |

## Closed Product Queue

Use official documentation and be explicit that public repositories may be issue trackers or source-available components rather than open-source products.

- Claude Code: https://www.anthropic.com/product/claude-code
- Cursor: https://docs.cursor.com/chat/overview
- GitHub Copilot coding agent: https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository/
- Google Antigravity: https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/
- Jules: https://jules.google/docs/
- Devin Desktop and Cascade: https://docs.devin.ai/desktop/cascade/cascade
- Factory Droid: https://factory.ai/news/droid-computers
- Amp: https://ampcode.com/news/neo
- JetBrains Junie: https://junie.jetbrains.com/docs/
- Tencent CodeBuddy: https://www.codebuddy.cn/docs/ide/Introduction
- Alibaba Qoder: https://help.aliyun.com/zh/lingma/qoder-cn/product-overview/what-is-xx
- Replit Agent: https://docs.replit.com/learn/build-with-agent
- Lovable: https://docs.lovable.dev/features/agent-mode
- Bolt: https://bolt.new/
- v0: https://v0.dev/docs/introduction

## Protocol and Infrastructure Queue

| Topic | Canonical source | Article question |
|-------|------------------|------------------|
| MCP servers and registry | https://github.com/modelcontextprotocol/servers | Why is a reference server not automatically production-ready? |
| Agent Client Protocol | https://agentclientprotocol.com/get-started/introduction | How does an editor talk to multiple agents, and how is that different from MCP? |
| Agent Skills | https://agentskills.io/home | When should a workflow become a Skill instead of an MCP tool or prompt? |
| AGENTS.md | https://github.com/agentsmd/agents.md | How do directory scopes and inheritance keep repository instructions maintainable? |
| GitHub Spec Kit | https://github.com/github/spec-kit | Does Spec -> Plan -> Tasks -> Implement outperform unstructured prompting on one feature? |
| GitHub Agentic Workflows | https://github.com/github/gh-aw | How can natural-language workflows compile into permission-bound GitHub Actions? |
| Context7 | https://github.com/upstash/context7 | When do current versioned docs improve accuracy enough to justify context cost? |
| GitHub MCP Server | https://github.com/github/github-mcp-server | How should toolsets and least privilege constrain repository automation? |
| Playwright MCP | https://github.com/microsoft/playwright-mcp | When is CLI plus Skills cheaper than MCP schemas, and how does prompt injection change the risk? |
| Serena | https://github.com/oraios/serena | How does symbol-level retrieval compare with text search and repository packing? |
| E2B | https://github.com/e2b-dev/E2B | What does a cloud agent sandbox need beyond a container? |
| Daytona | https://github.com/daytonaio/daytona | How do snapshots, persistence, LSP, VNC, and governance change agent execution? |
| Repomix | https://github.com/yamadashy/repomix | When is packing a repository effective, and when should an agent use semantic retrieval? |

## Skills and Plugin Discovery Queue

Prefer official collections:

- Anthropic Agent Skills: https://github.com/anthropics/skills
- Anthropic official Claude plugins: https://github.com/anthropics/claude-plugins-official
- OpenAI plugins: https://github.com/openai/plugins
- GitHub awesome-copilot: https://github.com/github/awesome-copilot
- Vercel Agent Skills: https://github.com/vercel-labs/agent-skills
- Vercel Skills CLI: https://github.com/vercel-labs/skills
- Pi Skills: https://github.com/badlogic/pi-skills
- Kilo Marketplace: https://github.com/Kilo-Org/kilo-marketplace

Use community awesome lists only for discovery, then return to the canonical project:

- https://github.com/VoltAgent/awesome-agent-skills
- https://github.com/hesreallyhim/awesome-claude-code
- https://github.com/filipecalegario/awesome-vibe-coding
- https://github.com/bradAGI/awesome-cli-coding-agents
- https://github.com/punkpeye/awesome-mcp-servers
- https://github.com/joylarkin/AI-Coding-Landscape

## Lifecycle Watchlist

- Roo Code announced its end in May 2026; verify the final repository notice and successor state before any recommendation: https://github.com/RooCodeInc/Roo-Code
- Vibe Kanban announced a 2026 sunset; treat it as a lifecycle case study, not an active recommendation: https://github.com/BloopAI/vibe-kanban/releases
- The older Kimi CLI is moving to Kimi Code; use the current repository as primary: https://github.com/MoonshotAI/kimi-code
- The older OpenAI Skills repository is deprecated; use the current OpenAI plugins repository: https://github.com/openai/plugins
- Windsurf material can be stale after the Devin Desktop and Cascade transition; start from current Devin documentation.
- Aider and Onlook remain useful historical or architectural subjects, but verify current release velocity before presenting them as fast-moving projects.

## Standard Single-project Article

Use this spine: problem -> real task -> architecture and tool calls -> setup -> safety and permissions -> cost and context -> open-source and commercial boundaries -> two alternatives -> best-fit reader -> current lifecycle state.
