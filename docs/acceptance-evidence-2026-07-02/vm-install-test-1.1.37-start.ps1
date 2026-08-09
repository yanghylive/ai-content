$ErrorActionPreference = "Continue"
$out = "C:\Users\Public\kaypal-install-test-1.1.37"
New-Item -ItemType Directory -Force -Path $out | Out-Null
"starter $(Get-Date -Format o)" | Out-File -Encoding utf8 "$out\starter.log"
$task = "KaypalInstallTest1137"
schtasks /delete /tn $task /f | Out-File -Append -Encoding utf8 "$out\starter.log"
schtasks /create /tn $task /tr "C:\Windows\Temp\kaypal-install-test-1.1.37-run.cmd" /sc once /st 23:59 /f /it /ru "WIN-LF040VM3F47\signer" | Out-File -Append -Encoding utf8 "$out\starter.log"
schtasks /run /tn $task | Out-File -Append -Encoding utf8 "$out\starter.log"
Start-Sleep -Seconds 2
schtasks /query /tn $task /fo LIST /v | Out-File -Append -Encoding utf8 "$out\starter.log"
