# AI Content Commercial Interaction Guardrails

## Hard Rule

Customer interaction commercial value means:

- The shipped result must be real customer handling: read customer comments/messages/conversations and reply or send automatically.
- "Task created", "status changed", "record saved", or "test passed" is not a customer-interaction commercial result by itself.
- Agent-S is the primary executor for desktop customer interaction.
- Default user mode is auto-send. Approval is only for uncertain targets, risky content, missing permissions, or explicit user choice.
- The frontend customer-interaction pages must trigger real user workflows, not engineering-only simulations.
- Local-engine may coordinate permission, policy, state, evidence, and audit, but it must not replace Agent-S as the desktop execution path.
- WeChat desktop tasks must not bypass Agent-S/local-controller unless the user explicitly requests a non-Agent-S implementation.
- Do not turn customer-interaction work into test reports, acceptance paperwork, record-page polish, or explanatory shells unless the user explicitly asks.
- Tests are only verification after the customer-facing capability is implemented. Do not make the work about tests.

## Before Editing

Before changing customer interaction code, state:

- What user-facing commercial capability is being improved.
- Whether Agent-S remains in the execution path.
- Whether auto-send remains the default.
- What is intentionally not being changed.

If the change removes Agent-S from a WeChat or desktop interaction path, stop and ask first.

## Non-Negotiable Rejection Rules

Reject or stop any change that:

- Makes WeChat session, WeChat group broadcast, Moments, or other desktop-app interaction stop calling Agent-S from the frontend path.
- Makes `local-engine` the primary executor for WeChat or desktop customer interaction.
- Changes the default customer interaction mode away from `auto-send`.
- Treats a task lifecycle or execution record as equivalent to a real customer reply/send.
- Pulls old acceptance-document context into customer-interaction work when the user is asking for commercial customer handling.

## Relevant Areas

- Frontend customer interaction: `frontend/src/app/(dashboard)/workbench`
- Agent-S frontend hook: `frontend/src/lib/ops-workbench/hooks/use-agent-s-state.ts`
- Agent-S routing prompts: `frontend/src/lib/ops-workbench/router.ts`
- Local-engine support only: `backend/src/modules/local-engine`
