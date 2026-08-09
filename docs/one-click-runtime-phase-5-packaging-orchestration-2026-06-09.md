# AI Content One-Click Desktop - Phase 5 Packaging Orchestration

Updated: 2026-06-09 05:01:00 PDT

## Goal

Phase 5 closes the desktop packaging and startup boundary for the no-Python one-click installer.

The packaged app must not require the user to install Python, Postgres, Redis, Node, or Chrome. Runtime automation should use the Node/CDP implementation and bundled Playwright Chromium.

## Completed In This Pass

1. Packaged Electron startup now defaults to Node runtime adapters.
   - `KAYPAL_NODE_AGENT_RUNTIME=1` is set in `desktop/backend.env`.
   - `desktop/main.js` treats packaged builds as Node runtime mode by default.

2. Python dependency installer path is disabled.
   - `desktop/installer/deps-manifest.json` now has no required deps.
   - `desktop/installer-helper/resources/deps-manifest.json` now has no required deps.
   - Installer helper dependency order is derived from the manifest, not hardcoded Python.
   - The helper UI no longer hardcodes `Python 3.12`.

3. Python sidecar packaging was removed.
   - `desktop/package.json` no longer packages `sidecars/agent-s-executor`.
   - `desktop/package.json` no longer packages `installer/wheelhouse/**`.
   - Windows full-build script no longer runs Agent-S smoke or wheelhouse preparation.

4. Resource guards were flipped to protect the new architecture.
   - `check-commercial-assets` now requires frontend/backend/SQLite/Playwright resources.
   - `check-full-installer-assets` now rejects Python/Postgres/Redis/Node/Chrome installer deps.
   - `check-full-installer-assets` now rejects packaged `agent-s-executor` and installer wheelhouse.
   - `check-release-size` no longer requires Agent-S Python files and rejects packaged Agent-S.

5. Installed-app self-check no longer depends on Python.
   - Removed Python discovery and venv creation checks from `desktop/installer/self-check.ps1`.
   - Self-check now focuses on Electron app, backend resource, frontend static resource, SQLite env, Prisma engine, and app dependencies.

6. User-visible desktop service wording was cleaned up.
   - Tray menu shows `本地执行引擎已启用` instead of Node/Python implementation detail.
   - IPC service mode reports `node-runtime` / `legacy-sidecar` instead of `python-sidecar`.

7. Legacy release entrypoints were guarded.
   - `desktop/packager.json` no longer declares the Python Agent-S sidecar.
   - `desktop/scripts/verify-release.sh` no longer requires Agent-S Python resources or 5409.
   - `desktop/scripts/prepare-wheelhouse.js` is now a legacy-disabled stub.
   - `desktop/scripts/smoke-agent-s-sidecar.js` is now a legacy-disabled stub.

8. mac packaging was closed for the current no-Python build.
   - `desktop/package.json` mac target now builds zip only. DMG generation was removed from the active target because local `hdiutil create` failed repeatedly after the app was packaged.
   - mac package resources now include only the mac ARM64 Prisma engine.
   - Windows Prisma engine is no longer copied into the mac package.
   - `check-full-installer-assets` post-build now resolves resources by `BUILD_PLATFORM`, not only `win-unpacked`.
   - `check-release-size` now checks the current zip package and no longer accepts stale DMG files as evidence.

9. Packaged SQLite first-run boot was fixed.
   - `desktop/main.js` now initializes the user-data SQLite database from the packaged `backend/prisma/dev.db` seed before starting the backend.
   - Empty or schema-less local databases are repaired before Nest/Prisma touches `schedule_configs`.
   - Existing non-empty bad databases are backed up before replacement.
   - Post-build and release-size checks now require the packaged SQLite seed database.

## Intentionally Kept For Now

`desktop/main.js` still contains the legacy Python sidecar startup functions as a development fallback. Packaged builds do not enter that path because `isNodeAgentRuntimeEnabled()` returns true when `app.isPackaged`.

This keeps rollback/dev comparison possible while preventing the one-click installer from depending on Python.

## Verification Commands

Run from `/Users/yanghy/Documents/New project/ai-content`.

```bash
node --check desktop/main.js
node --check desktop/scripts/check-commercial-assets.js
node --check desktop/scripts/check-full-installer-assets.js
node --check desktop/scripts/check-release-size.js
node --check desktop/installer-helper/main.js
node --check desktop/scripts/prepare-wheelhouse.js
node --check desktop/scripts/smoke-agent-s-sidecar.js
bash -n desktop/scripts/verify-release.sh
```

Run from `/Users/yanghy/Documents/New project/ai-content/desktop`.

```bash
npm run check:commercial-assets
npm run check:full-installer-assets:pre
```

## Verification Result

Passed locally on 2026-06-09:

- `node --check desktop/main.js`
- `node --check desktop/scripts/check-commercial-assets.js`
- `node --check desktop/scripts/check-full-installer-assets.js`
- `node --check desktop/scripts/check-release-size.js`
- `node --check desktop/installer-helper/main.js`
- `node --check desktop/scripts/prepare-wheelhouse.js`
- `node --check desktop/scripts/smoke-agent-s-sidecar.js`
- `bash -n desktop/scripts/verify-release.sh`
- `cd desktop && npm run check:commercial-assets`
- `cd desktop && npm run check:full-installer-assets:pre`
- stale build-reference scan for `smoke:agent-s`, `prepare:wheelhouse`, `wheelhouse/**`, `sidecars/agent-s-executor`, `agent-s-executor/main.py`, `agent-s-executor/requirements.txt`, `Python 3.12`, `python-sidecar`
- `cd desktop && npm run build:mac`
- `cd desktop && BUILD_PLATFORM=mac-arm64 npm run check:full-installer-assets:post`
- `cd desktop && BUILD_PLATFORM=mac-arm64 npm run check:release-size`
- `cd desktop && codesign --verify --deep --strict --verbose=2 dist/mac-arm64/KaypalAI内容创作平台.app`
- unzip smoke from `desktop/dist/KaypalAI内容创作平台-1.1.10-arm64-mac.zip`
- `open /private/tmp/kaypal-ai-zip-smoke.IxslGY/KaypalAI内容创作平台.app`
- `curl http://127.0.0.1:3010/`
- `curl http://127.0.0.1:3011/api/docs`
- raw SQLite marker check for `/Users/yanghy/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`

Observed in the zip smoke:

- `open` returned success for the zip-extracted app.
- The app process listened on `127.0.0.1:3010`.
- The backend child process listened on `*:3011`.
- `http://127.0.0.1:3010/` returned HTTP 200 and the static frontend HTML.
- `http://127.0.0.1:3011/api/docs` returned HTTP 200 and Swagger UI HTML.
- Auth-protected runtime endpoints returned HTTP 401 `请先登录`, which proves the backend request pipeline reached the auth guard.
- The user-data SQLite file was repaired from 0 bytes to a seeded database containing `schedule_configs`.
- No new `KaypalAI内容创作平台` crash report appeared during this smoke run.

Not run yet:

- full authenticated UI workflow inside the packaged app
- Windows package build and post-build check

Current mac artifact:

- `desktop/dist/KaypalAI内容创作平台-1.1.10-arm64-mac.zip`
- Size: 273 MB
- Generated: 2026-06-09 04:56 PDT
- `desktop/dist` no longer contains the stale 2026-06-06 DMG.

Known packaging note:

- DMG is not part of the active mac target right now. The local DMG step failed at `hdiutil create` after app packaging succeeded. Current accepted mac artifact is zip.
- `spctl --assess --type execute` still reports `internal error in Code Signing subsystem` for the development zip. The immediate cause is the bundled Playwright `Google Chrome for Testing.app`, whose own `codesign --verify --deep --strict` reports `code has no resources but signature indicates they must be present`. The outer Electron app verifies with `codesign --deep`, and the app can launch, but this must be closed before a formal signed/notarized mac distribution.

## Remaining Phase 5 Work

1. Repair the bundled Playwright Chromium app signing/resource issue so `spctl --assess --type execute` passes on the extracted zip app.
2. Run an authenticated packaged-app UI smoke after login is available in the packaged app.
3. Run Windows package build and post-build checks.
4. If DMG is required for distribution, repair the `hdiutil` path separately and re-enable the DMG target.
