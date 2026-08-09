# Windows UTM 安装启动验收 1.1.45

- VM: UTM Windows
- VM UUID: 105CF3DC-F734-44D9-BCEA-D63DEB9D3571
- Installer: desktop/dist/KaypalAI内容创作平台 Setup 1.1.45.exe
- Installer sha256: 5a16f81dd8e032d64119ac97823294e060098ad440fbccf9581152cc7f790560
- Result: PASS

## 验收点

- Real Windows VM install: PASS
- Silent installer exit code: 0
- Installed application directory exists: PASS
- Application process starts: PASS
- Bundled Node backend starts: PASS
- Windows localhost frontend 3010 returns HTTP 200: PASS
- Windows localhost backend 3011 returns HTTP 200: PASS

## Evidence files

- install-report.txt
- launch-report.txt
