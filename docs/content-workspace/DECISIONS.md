# Content Workspace Decision Log

This log records product or implementation decisions that change how the frozen
content-workspace contract is interpreted. Contract changes without a matching
decision entry are not allowed.

## CW-D001 - Baseline hierarchy

- Date: 2026-07-21
- Status: Accepted
- Requirements: UX-02, UX-03, UX-04, UX-13
- Decision: The commercial UX prototype is the product-level baseline, the
  content-workspace prototype is the feature-level baseline, and the development
  plan is the implementation and acceptance contract.
- Consequence: A later document may add detail but must not silently replace or
  reduce an earlier commitment.

## CW-D002 - Publishing boundary

- Date: 2026-07-21
- Status: Accepted
- Requirements: UX-12
- Decision: The workspace creates a publish preparation only. External publishing
  remains a separate confirmation step in the distribution center.
- Consequence: Direct publishing imports, APIs, or commands remain forbidden in
  the content-workspace route.

## CW-D003 - Astryx integration boundary

- Date: 2026-07-24
- Status: Accepted
- Requirement: UX-14
- Decision: Migrate the existing frontend to Astryx React components in verified
  stages. Astryx CLI 0.1.7 is the implementation authority for templates,
  component contracts, and migration checks. Phase 1 installs and wires the
  Astryx foundation and migrates the login surface. HeroUI remains only as a
  compatibility layer for routes that have not yet migrated.
- Reason: The user reconfirmed that the original goal is an actual Astryx UI
  migration, not a HeroUI implementation that merely cites CLI guidance.
- Consequence: Every report must name the surfaces that use real Astryx imports.
  The whole application must not be described as migrated until the dashboard
  shell, content workspace, and remaining mapped routes pass their own gates.

## CW-D004 - Reopen G1 semantic acceptance

- Date: 2026-07-23
- Status: Accepted
- Requirements: UX-05, UX-06, UX-08, UX-13
- Decision: Reopen a corrective G1.1 gate and pause G2 because brief provenance,
  outline confirmation invariants, and the single-action mobile contract were
  accepted before their product semantics were actually verified.
- Consequence: UX-05, UX-06, and UX-13 return to `partial` until new runtime
  evidence exists. Local deterministic rule previews must be disclosed as such
  and must not create or impersonate a persisted AI optimization version.

## CW-D005 - Reopen G1.1 for dynamic action and legacy provenance

- Date: 2026-07-24
- Status: Accepted
- Requirements: UX-05, UX-08, UX-13
- Decision: Reopen G1.1 and pause G2 again. A visible workspace may expose at
  most one primary action. A historical brief without field provenance must say
  that its source was not recorded instead of guessing or using a vague label.
- Reason: The first G1.1 evidence did not cover an open rule preview, existing
  version-row actions, or a non-empty historical brief without `fieldSources`.
- Consequence: UX-05 and UX-13 return to `partial` until combination-state tests
  and new runtime evidence cover pending rule previews, version-row actions, and
  non-empty historical briefs without `fieldSources`. UX-08 remains `partial`.

## CW-D006 - Include the dashboard shell in the Astryx migration

- Date: 2026-07-25
- Status: Accepted
- Requirement: UX-01
- Decision: Include the today workspace and global navigation shell in the
  Astryx frontend migration. Phase 2 migrates only the AppShell, TopNav, SideNav,
  and MobileNav presentation layer while retaining authentication, tenancy,
  business-tool execution, route aliases, and every existing feature entry.
- Reason: The user asked for the 3010 frontend UI to be rebuilt with Astryx.
  Migrating the shared shell first reaches every functional page while the
  navigation zero-loss guard constrains drift.
- Consequence: Page content remains on the compatibility layer until its own
  migration gate. Shell completion cannot be claimed if any protected route,
  alias, account action, or mobile navigation behavior is lost.

## CW-D007 - Freeze the shell and restore the result-entry objective

- Date: 2026-07-25
- Status: Accepted
- Requirement: UX-01
- Decision: Stop expanding the shared shell and freeze the accepted D006 scope.
  The current G5 slice returns to result-oriented task entry. S1 adds only four
  content outcomes and atomic `workspaceIntent` draft creation. Intent v1 accepts
  `task`, `goal`, and `platforms`; all legacy entries remain available.
- Reason: The active work item still used shell work to satisfy task navigation,
  while brand and material references do not yet have a verified shared tenant
  boundary.
- Consequence: The authenticated tenant remains the implicit brand scope. S1
  must not accept `brandId`, `materialIds`, or citation identifiers. Persisted
  material references remain deferred until their tenancy and authorization
  contract is complete.

## CW-D008 - Close S1 and isolate the S2 rollout slice

- Date: 2026-07-26
- Status: Accepted
- Requirements: UX-01, UX-15
- Decision: Close and accept S1 result-oriented entry and atomic
  `workspaceIntent` draft creation. The next active work item covers only
  UX-15 feature flags, event metrics, rollout and rollback preparation. The
  accepted S1 paths and all legacy entries are frozen during S2.
- Reason: The contract guard must not let active work select an already
  accepted requirement. Separating the completed slice from the next slice
  keeps implementation, evidence and schedule boundaries auditable.
- Consequence: S2 cannot switch the default entry before feature-flag and
  rollback evidence exists. UX-14 stays accepted, and brand, material and
  citation scope does not expand as part of rollout work.

## CW-D009 - Implement the bounded S2 rollout slice

- Date: 2026-07-26
- Status: Accepted
- Requirements: UX-15
- Decision: S2 implements only rollout configuration, stable cohort assignment,
  and event-dictionary wiring for the result entry. The
  `NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED` flag defaults to off and
  `NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT` defaults to 0.
  Stable bucketing uses only the authenticated `auth/me` user identifier in
  memory; user, tenant, and brand identifiers are never persisted in events or
  draft requests. Events are first exposed through browser `CustomEvent` and
  `sessionStorage` as a readable metrics handoff; this does not claim a live
  48-hour rollout. `NEXT_PUBLIC_*` values are build-time values, so rollback is
  a rebuild/deploy with the flag disabled or the percentage set to 0, which
  restores the legacy entry behavior.
- Reason: Establish a verifiable rollout and rollback boundary before choosing
  a production metrics backend or switching the default entry.
- Consequence: Only the rollout module, its tests, and flag/event wiring in the
  three existing entry files are in scope. The shared shell, legacy route set,
  editor, save state machine, backend schema, and publishing boundary remain
  frozen. The 10%/48-hour observation, production metrics panel and rollback
  drill are still outstanding acceptance work.

## CW-D010 - Open the S3 observation and rollback slice

- Date: 2026-07-26
- Status: Accepted
- Requirements: UX-15
- Decision: Close the S2 rollout code-preparation slice and open S3 for the
  event export report, operations runbook, and closed/10%/rollback evidence.
  S3 does not modify the S1 entry, rollout module, article API, backend schema,
  or production telemetry backend. The report accepts only the five frozen
  events and rejects user, tenant, brand, goal, article, material, and citation
  fields. `NEXT_PUBLIC_*` switches are operated through the documented
  build/deploy steps. A real 48-hour observation window must record start and
  end timestamps; until it completes, UX-15 remains `in_progress`.
- Reason: S2 already has a usable flag and local event handoff. Formalizing
  observation and rollback first keeps the next implementation slice narrow and
  reviewable before opening a production telemetry work item.
- Consequence: The active work item is limited to `docs/content-workspace/` and
  rollout report scripts. S1, the Astryx shell, legacy entries, editor, save
  state machine, and publishing boundary remain frozen.

## Change protocol

Every new entry must include a stable ID, date, affected requirement IDs, status,
decision or open question, reason, and user-visible consequence. An accepted
decision must be reflected in `contract.json` in the same change.

## CW-D011 - 修复灰度开关的构建期读取

- Date: 2026-07-26
- Status: Accepted
- Requirement: UX-15
- Decision: S3 运行烟测发现 rollout 模块用动态 `process.env` 对象读取
  `NEXT_PUBLIC_*`，客户端构建后不会注入这两个开关，导致已认证用户也只能
  落到 `flag_off`。允许在 rollout 模块内将两个 public env 改为直接引用并
  保留默认关闭、稳定分桶、匿名事件和旧入口边界；不允许修改任何 UI、路由、
  草稿语义或后端接口。
- Reason: 没有这项窄修复就无法真实验证 10% 灰度态；修复的是构建期配置
  可达性，不是扩大产品功能范围。
- Consequence: S3 继续保持 UX-15 `in_progress`。修复后必须重启构建并重新
  实测关闭、10% 和回滚三态；48 小时窗口仍不得模拟或提前验收。
