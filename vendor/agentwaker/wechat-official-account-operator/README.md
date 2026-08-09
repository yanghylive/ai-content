# WeChat Official Account Operator

[中文说明](README.zh-CN.md)

Weaver is an open-source AgentWaker role for evidence-backed WeChat Official
Account operations. It covers AI-signal research, editorial planning, deep
technical tutorials, visual production, WeChat-compatible formatting, private
review, approval-bound draft/publication actions, and performance review.

## What is included

- A complete AgentWaker role profile under `agent-soul/`
- English and Chinese role detail pages
- Reusable skills for research, planning, drafting, visuals, formatting,
  JPage review, WeChat draft/publication, and performance analysis
- Official WeChat API helpers and an optional SSH token broker
- Local tests for renderers, collectors, visual packages, and API helpers

## Safety model

Research and local rendering are read-only by default. Every external write,
asset upload, draft mutation, preview send, public publication, mass delivery,
or deletion requires explicit approval for the exact target and payload.
Credentials, cookies, access tokens, unpublished material, and runtime output
must stay outside Git.

## Quick start

### Requirements

| Scope | Requirement |
|---|---|
| Core role, lifecycle, and validation | Git, Ruby 2.6+, Python 3.9+ |
| JPage private preview | Node.js 20+, `@code2rich/jpage`, and an operator-owned token |
| Official WeChat API actions | An eligible account, required API permissions, credentials, and an approved IP allowlist or token broker |
| SSH token broker | Linux with systemd, OpenSSH, Python 3.9+, and curl |
| Browser draft fallback or generated visuals | A compatible agent runtime with an authorized browser or image-generation tool |

### Standalone checkout

1. Clone this repository:

   ```bash
   git clone https://github.com/code2rich/agentwaker-wechat-official-account-operator.git
   cd agentwaker-wechat-official-account-operator
   ```

2. Copy `env/.env.example` to `env/.env` and fill only the integrations you
   intend to use. The real file is ignored by Git.
3. Set absolute runtime paths from the repository root:

   ```bash
   export AGENT_WORK_DIR="$PWD/workdir"
   export AGENT_MEMORY_FILE="$PWD/agent-soul/MEMORY.md"
   ```

4. Start a tracked run:

   ```bash
   ruby tools/agent-runtime.rb start \
     --role . \
     --goal "Draft an evidence-backed WeChat article" \
     --tool codex
   ```

5. Read `wechat-official-account-operator-skills/SKILL.md` to route a task to
   the appropriate specialist skill.

### Install as an Agent Skill

The repository root contains `SKILL.md`, so a Skill-compatible client can use
the whole checkout without separating its runtime files:

```bash
git clone \
  https://github.com/code2rich/agentwaker-wechat-official-account-operator.git \
  ~/.agents/skills/wechat-official-account-operator
```

If your client uses a different Skill directory, clone the repository there
instead. Keep the entire repository together: specialist skills rely on the
adjacent `agent-soul/`, `tools/`, `workdir/`, and `schemas/` directories.

The shared capabilities, schemas, runtime policy, lifecycle tool, and standalone
validator are bundled in this repository. The role can also be embedded in a
larger [AgentWaker](https://github.com/code2rich/agentwaker) team.

## Local tests

```bash
find wechat-official-account-operator-skills -name 'test_*.py' -type f -print0 |
  sort -z |
  xargs -0 -n1 python3
```

Individual test files can also be run directly. Most tools use the Python
standard library; optional integrations document their own dependencies.

Validate the role and bundled shared capabilities:

```bash
ruby tools/validate-capabilities.rb
ruby tools/validate-role.rb . --phase standalone
```

## Repository layout

```text
.
├── agent-soul/                         # Authoritative role definition
├── capabilities/                       # Bundled shared capabilities
├── schemas/                            # Profile, runtime, and capability schemas
├── tools/                              # Lifecycle and validation tools
├── wechat-official-account-operator-skills/
│   ├── SKILL.md                        # Skill router
│   └── */                              # Specialist skills and tools
├── env/.env.example                    # Safe configuration template
├── mcp/mcp.json                        # MCP configuration
├── workdir/                            # Ignored runtime workspace
├── capabilities.yaml                  # Shared capability declarations
└── agent-persona.html                  # Human-readable visual profile
```

## License

The project is released under the [MIT License](LICENSE). Bundled third-party
assets retain their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions and issue reports are welcome.
