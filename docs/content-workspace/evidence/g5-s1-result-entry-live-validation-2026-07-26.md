# Content Workspace G5 S1 Live Validation

- Date: 2026-07-26 (America/Los_Angeles)
- Frontend: `http://localhost:3010`
- Backend: `http://localhost:3011`
- Scope: `CW-G5-RESULT-ENTRY`, `UX-01`, `CW-D007`
- Result: accepted

## Scope and drift control

- The shared Astryx shell, layout, sidebar, editor, reducer, save state machine, authentication, tenant boundary and publishing boundary were unchanged in S1.
- The only new user flow is the result-oriented entry: create, rewrite, multiplatform and prepare.
- `UX-14` and `UX-15` remain deferred. Brand scope remains the authenticated tenant; no client-supplied brand, material or citation identifiers were accepted.
- S0 backup: `.local-backups/content-workspace-s1/s0-result-entry-baseline-20260725.tar.gz`
- S0 backup SHA-256: `f2a816065b0ba91e296d2ad386d589e33ca4a1d8f9de55cff7f8d35c63cf45b5`

## Runtime flow

- The authenticated home page exposed exactly four result links:
  - `/content/workspace?intent=create`
  - `/content/workspace?intent=rewrite`
  - `/content/workspace?intent=multiplatform`
  - `/content/workspace?intent=prepare`
- Each intent opened the matching Astryx form with a goal default, one selected platform and the low-emphasis `/content/optimization` fallback.
- `/solutions` linked “写内容和做素材” to `/content/workspace?intent=create`.
- A legacy deep link with `intent=create&step=outline` rendered the existing content workspace instead of the new intent form.
- One real QA submission selected `小红书` and entered `为本地生活服务品牌写一篇可审核的首发内容`.
- The single `POST /api/articles/drafts` returned an editable deep link with `step=brief`.
- SQLite readback confirmed `contentType=xiaohongshu`, `workspaceStep=brief`, `workspaceRevision=1`, `platforms=["xiaohongshu"]`, and `fieldSources.goal/platforms.source=task_intent`.
- A full reload restored the goal, audience, selected platform, action and constraints from the persisted brief.
- Browser console errors attributable to S1: `0`.

## Responsive evidence

All three surfaces had exact document widths at the tested viewports; no horizontal overflow was observed.

| Surface | 1440 px | 1024 px | 390 px |
| --- | ---: | ---: | ---: |
| Home result entries | 1440 | 1024 | 390 |
| Intent form | 1440 | 1024 | 390 |
| Created brief | 1440 | 1024 | 390 |

Evidence files:

- `g5-s1-home-results-1440.png`, `g5-s1-home-results-1024.png`, `g5-s1-home-results-390.png`
- `g5-s1-intent-form-1440.png`, `g5-s1-intent-form-1024.png`, `g5-s1-intent-form-390.png`
- `g5-s1-created-brief-1440.png`, `g5-s1-created-brief-1024.png`, `g5-s1-created-brief-390.png`

## Automated verification

- Full content-workspace guard suite: `74/74` passed.
- S1 result-entry contract tests: `9/9` passed.
- Backend article/controller/service target suite: `39/39` passed.
- TypeScript, targeted ESLint and production build: passed; production build emitted `142` routes.
- Astryx Doctor: `7 pass / 0 warn / 0 fail`.
- Astryx migration guard, navigation zero-loss guard and workspace contract guard: passed.
- The S1 contract guard rejects frozen shell/layout changes as out of scope.

## Cleanup

- The QA user, sessions and both QA drafts were removed after validation.
- Post-cleanup counts: `users=0`, `sessions=0`, `QA articles=0`.
- No existing user account, target article, tenant, brand, material or publishing record was changed.

## Gate decision

`UX-01` is accepted for S1 result-oriented entry and atomic intent draft creation. S2 must start from a new active work item and must not reopen or broaden the frozen S1 paths without a new decision record.
