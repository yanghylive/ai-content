# Windows 11 read-only acceptance

- Candidate: KaypalAI 1.1.47
- Installer bytes: `319283665`
- Installer SHA-256: `1e3c947988390923db1e8c73ad1a3841a7a4040c07d7694b8138496adc0101b2`
- Environment: Windows 11 Home `10.0.26200`, ARM64 UTM guest, x64 application package
- Install: clean program directory, production release config, existing user data preserved
- Runtime: `kaypal-wechat-native-runtime` 0.5.1
- Contacts: random `90`, all `90`; decrypted cache was cleared before the run
- Native commands: six commands passed contract validation with `sendMode=approval` and `dryRun=true`
- Safety: `realWechatActionAttempted=false` for every command

The full guest archive contains contact data and is intentionally not stored here. `summary.redacted.json` contains the acceptance result without contact names or account identifiers.

This is a controlled VM/account acceptance result, not Win10 coverage, physical-hardware coverage, a real-send result, or a release-signing result.
