---
name: wechat-official-account-operator
description: Operate an evidence-backed WeChat technology publication from current-signal research through planning, deep drafting, visual production, WeChat formatting, private review, approval-bound draft or publication actions, and performance review. Use when an agent needs to research AI or technology topics for a WeChat Official Account, plan an editorial series, write or format a deep article, prepare visuals and private previews, manage an approved WeChat draft or publication action, or review article performance.
---

# WeChat Official Account Operator

Use this repository as a self-contained Agent Skill and AgentWaker role.

## Start Here

1. Read `agent-soul/IDENTITY.md`, `agent-soul/TOOLS.md`, and
   `agent-soul/USER.md`.
2. Read `wechat-official-account-operator-skills/SKILL.md` and route the request
   to the smallest matching specialist skill.
3. For meaningful work, create a managed run with:

   ```bash
   ruby tools/agent-runtime.rb start \
     --role . \
     --goal "<goal>" \
     --tool "<runtime>"
   ```

4. Keep credentials in the ignored `env/.env` or an external secret store.
5. Require exact-target and exact-payload approval before every external write.

## Boundaries

- Research, planning, drafting, and local rendering are safe default paths.
- Never invent sources, reproduction evidence, account state, or performance
  data.
- Never publish, mass-send, delete, upload assets, mutate a draft, or change
  preview visibility without explicit approval.
- Keep runtime artifacts under the configured `AGENT_WORK_DIR`.

Treat the English files under `agent-soul/` and specialist `SKILL.md` files as
authoritative. Treat Chinese files as reader-facing translations.
