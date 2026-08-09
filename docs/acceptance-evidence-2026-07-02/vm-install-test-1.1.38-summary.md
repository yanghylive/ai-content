# KaypalAI 1.1.38 Windows VM Installed-Package Verification

Date: 2026-07-02

## Scope

- Installer: `desktop/dist/KaypalAI内容创作平台 Setup 1.1.38.exe`
- Windows VM installed package path: `C:\Users\signer\AppData\Local\Programs\ai-content-desktop`
- Runtime called from installed package resources, not from source tree.
- Execution user from UTM guest agent: `nt authority\system`

## Installer Integrity

- Download target in VM: `C:\Users\Public\KaypalAI-Setup-1.1.38-verified.exe`
- Size check: `276124366` bytes
- SHA256 check: `50738783fc7b0c11bb6206d2bcd034c3c8ffcfc9c892662abf76f565e466ca1c`
- Silent install exit code: `0`
- Bundled node: `v20.20.2`

## WeChat Contact Sync Results

- Runtime contract: `2026-06-26.wechat-native-v1`
- Engine version: `0.5.0`
- Random sync:
  - `ok=true`
  - `mode=random`
  - `count=500`
  - `source=windows-wechat-db-decrypted`
  - `stage=native-helper-completed`
  - `selectedDbAccountFolder=yanghylive_ddd3`
  - `dbTotalContactCount=6435`
- All sync:
  - `ok=true`
  - `mode=all`
  - `count=6430`
  - `source=windows-wechat-db-decrypted`
  - `stage=native-helper-completed`
  - `selectedDbAccountFolder=yanghylive_ddd3`
  - `dbTotalContactCount=6435`

## Evidence Files

- `vm-install-test-1.1.38-test.log`
- `vm-install-test-1.1.38-installer-sha256.txt`
- `vm-install-test-1.1.38-node-version.txt`
- `vm-install-test-1.1.38-runtime-contract.json`
- `vm-install-test-1.1.38-diagnose.json`
- `vm-install-test-1.1.38-contacts-random.json`
- `vm-install-test-1.1.38-contacts-all.json`
- `vm-install-test-1.1.38-appdir.txt`

## Result

Installed-package Windows VM verification passed for the WeChat contact sync hotfix:

- The installed 1.1.38 package no longer stays on the old 450/455-contact cache path.
- It selects the active `yanghylive_ddd3` WeChat DB account.
- Random sync returns 500 contacts.
- All sync returns 6430 contacts from a 6435-contact decrypted DB view.

Remaining release risk: this proves the installed runtime/helper contact-sync path in the Windows VM. It does not replace the broader commercial gate items for other WeChat modules and full Win10/Win11 customer-machine matrix evidence.
