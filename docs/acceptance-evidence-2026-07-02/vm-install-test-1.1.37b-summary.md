# Windows VM Install Test 1.1.37

- VM: UTM `Windows`, user `WIN-LF040VM3F47\signer`
- Installer: `KaypalAI-Setup-1.1.37-host.exe`
- SHA256: `2f011739d1a1d909efca92b24a29e3d054683f1881ea066a6d404ec1bd3d39ad`
- Install result: `installer_exit 0`
- Runtime node: `v20.20.2`
- WeChat process: `Weixin.exe` in Console session 1
- DB-only gate in packaged backend: present (`AI_CONTENT_WECHAT_CONTACT_DB_ONLY`)

## Contact Sync Result

| Mode | Result | Count | Source | Stage | DB key |
| --- | --- | ---: | --- | --- | --- |
| random | passed | 455 | `windows-wechat-db-decrypted` | `native-helper-completed` | `decrypted-with-memory-key` |
| all | passed | 455 | `windows-wechat-db-decrypted` | `native-helper-completed` | `decrypted-with-memory-key` |

## Evidence Files

- `vm-install-test-1.1.37b-contacts-random.json`
- `vm-install-test-1.1.37b-contacts-all.json`
- `vm-install-test-1.1.37b-diagnose.json`
- `vm-install-test-1.1.37b-helper-diagnose.json`
- `vm-install-test-1.1.37b-db-only-gate.txt`
- `vm-install-test-1.1.37b-assertion.json`
