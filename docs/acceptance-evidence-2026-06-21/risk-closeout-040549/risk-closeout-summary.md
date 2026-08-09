# Risk Closeout Summary - 2026-06-21

## Fixed

- Knowledge-base/UI smoke login stability: fixed local acceptance session handling so synthetic local sessions no longer lose desktop/Kaypal tokens during profile/subscription calls.
- Knowledge-base local-only search stability: fixed local acceptance sessions so knowledge search skips Kaypal cloud refresh and keeps the local session valid.
- Current UI route assertions updated to the current product navigation.
- Windows build source synced from current macOS workspace into the Windows VM and rebuilt as version `1.1.11`.
- Windows Electron Builder cache repaired in the VM:
  - restored `winCodeSign/rcedit-x64.exe`
  - restored `nsis-3.0.4.1`
  - restored `nsis-resources-3.4.1`

## Verification

- Backend targeted test: `kaypal-profile.controller.spec.ts` passed, `8` tests passed.
- Backend full Jest: `49` suites passed, `446` tests passed.
- Backend build: passed.
- Frontend TypeScript: `npx tsc --noEmit --pretty false` passed.
- Knowledge-base API minimal loop:
  - `PASS=3 WARN=0 FAIL=0`
  - covered Chinese text create, local search hit, and delete cleanup.
- UI browser smoke:
  - `PASS=15 WARN=1 FAIL=0`
  - warning is expected because API flow was intentionally skipped with `SMOKE_SKIP_API_FLOW=1`.
- Commercial acceptance gate:
  - `PASS=50 WARN=2 BLOCKED=7 FAILED=0`
  - remaining `BLOCKED` items are true-account/true-action gates, not functional failures.
- Windows installer packaging:
  - Electron Builder NSIS package completed.
  - `check-full-installer-assets --phase=post` passed.
  - release size check passed.
  - packaged backend bundle contains `kaypalLocalOnly` and knowledge local-only cloud-skip fixes.
  - live code-signing attempt reached the USB token in the Windows VM, but signing could not complete because no usable code-signing leaf certificate/private-key identity is present on the token or in the Windows certificate stores.
  - `signtool sign /a` reported `After EKU filter, 0 certs were left` and `SignTool Error: No certificates were found that met all the given criteria.`

## Windows Installer Artifact

- Local path: `/Users/yanghy/Documents/New project/ai-content/desktop/dist-windows-1.1.11-current/KaypalAI-Content-Setup-1.1.11-current.exe`
- Windows VM source path: `C:\Users\Public\KaypalAI-Content-Setup-1.1.11-current.exe`
- Size: `274,174,602` bytes
- SHA256: `4d87e6a82eb69f019084f01e79708a34cf8ee3279af333701fabf053fdd4f9ef`

## Remaining Blockers

- No ready real platform account for real execution/publishing validation.
- Real publish/content pipeline gates intentionally remain blocked until explicit approval env vars are set.
- Desktop WeChat real execution readiness still requires confirming the foreground WeChat target/session before true account execution.
- Windows installer is currently unsigned. The VM now detects `Microsoft Usbccid Smartcard Reader (VID_0529&PID_0620)` and `SafeNet Token JC`, but the token/Windows stores expose no production code-signing certificate identity. The provided archive contains SafeNet/VSigntool installers and certificate-chain `.cer` files only; no `.pfx`, `.p12`, private key, or leaf certificate was found.
