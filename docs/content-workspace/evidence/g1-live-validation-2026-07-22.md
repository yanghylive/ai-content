# Content Workspace G1 Live Validation

- Date: 2026-07-22 (America/Los_Angeles)
- Frontend: `http://localhost:3010/content/workspace`
- Backend: `http://127.0.0.1:3011`
- Runtime database: desktop SQLite database under `ai-content-desktop`
- Validation account: isolated local QA fixture; no existing account password or target article content was changed
- Cleanup: QA drafts, sessions, memberships, tenant and user were removed after validation; post-cleanup counts were all zero

## Persistent workflow

The live browser created an isolated draft and completed steps 1 through 3.

- Draft ID: `cmrx0htu900ipi9hk3pnbwt6e`
- Brief goal persisted after reload.
- One outline node persisted independently from the body.
- Editing an outline cleared its confirmation.
- `Continue: Draft` was disabled until the outline was confirmed, then enabled.
- The URL restored `step=outline` and later `step=draft` after full reloads.
- The body persisted after the 800 ms autosave debounce and a full reload.
- SQLite readback: `outline_items=1`, `outline_confirmed=1`, `workspace_step=draft`, `workspace_revision=10`, `content_length=60`.
- The requested existing article `cmrvj07qk001zfyb8dfvmraqe` remained untouched: brief/outline stayed null and revision stayed `1`.

## Responsive measurements

| Viewport | Result | Key measurements |
| --- | --- | --- |
| 1440x900 | Pass | queue 280 px, editor 502 px, context 320 px; toolbar hidden; document scroll width 1440 px |
| 1024x900 | Pass | editor 710 px; queue/context panels hidden; toolbar visible; footer stays inside editor; document scroll width 1024 px |
| 390x844 | Pass | editor 340 px; toolbar visible; fixed footer bottom 844 px; steps 338 px; document scroll width 390 px |

Mobile drawer checks:

- Queue drawer opens from the left at 332 px wide.
- Context drawer opens from the right at 332 px wide.
- Pressing Enter on the focused queue button opens the queue dialog.
- Queue and context drawers expose named dialogs and named close buttons.

## Evidence

- `docs/content-workspace/evidence/g1-workspace-1440.png`
- `docs/content-workspace/evidence/g1-workspace-1024.png`
- `docs/content-workspace/evidence/g1-workspace-390.png`
- `docs/content-workspace/evidence/g1-workspace-390-queue-drawer.png`
- `docs/content-workspace/evidence/g1-workspace-390-context-drawer.png`

## Automated verification

- Frontend state and responsive tests: 15/15 passed.
- Frontend TypeScript: passed.
- Targeted frontend ESLint: passed.
- Backend article/controller/Prisma suites: 29/29 passed.
- Live backend validation: invalid workspace payload returned 400, same-value retry kept the revision stable, and the rejected write preserved both revision and brief data.
- Content workspace contract gate: 41/41 passed after the G1-to-G2 status transition.
- Navigation zero-loss guard: 13/13 passed.
- Publish boundary guard: passed.
- Backend Nest build: passed.
- Frontend production Webpack build: passed, including `/content/workspace`.
- Browser console: no new JavaScript errors from the content workspace. A pre-existing HeroUI tenant-select warning remains outside the G1 route implementation.

The collapsed Next.js development indicator appears in local screenshots at the lower-left corner. It is development tooling and is not included in production builds.
