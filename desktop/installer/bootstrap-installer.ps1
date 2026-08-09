<#
.SYNOPSIS
  AI 内容平台 Windows 安装引导（WPF UI，单线程 + DoEvents）。
#>

param(
    [ValidateSet("Preflight", "PostInstall", "Full")]
    [string] $Mode = "Full",
    [string] $ManifestPath = "$PSScriptRoot\deps-manifest.json",
    [string] $AppSourceDir = "$env:TEMP\ai-content-app",
    [string] $InstallDir = "$env:ProgramFiles\JIUZHANG AI"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="JIUZHANG AI 内容创作平台 - 安装"
        Width="720" Height="560"
        WindowStartupLocation="CenterScreen"
        ResizeMode="NoResize"
        Background="#FAFAFA">
    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <StackPanel Grid.Row="0" Margin="0,0,0,16">
            <TextBlock Text="JIUZHANG AI 内容创作平台" FontSize="24" FontWeight="Bold" Foreground="#18181B"/>
            <TextBlock x:Name="HeaderSubtitle" Text="正在检测运行环境..." FontSize="13" Foreground="#71717A" Margin="0,4,0,0"/>
        </StackPanel>

        <Border Grid.Row="1" Background="White" BorderBrush="#E4E4E7" BorderThickness="1" CornerRadius="8" Padding="20">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
                <StackPanel>
                    <TextBlock x:Name="WelcomeText" TextWrapping="Wrap" FontSize="13" Foreground="#27272A" Margin="0,0,0,16">
                        本安装包已内置运行时、数据库和浏览器控制能力，不要求用户单独安装 Python、Node、Postgres、Redis 或 Chrome。
                    </TextBlock>

                    <TextBlock Text="环境检测" FontSize="14" FontWeight="SemiBold" Margin="0,8,0,8" Foreground="#18181B"/>
                    <ItemsControl x:Name="DetectionList">
                        <ItemsControl.ItemTemplate>
                            <DataTemplate>
                                <Grid Margin="0,2">
                                    <Grid.ColumnDefinitions>
                                        <ColumnDefinition Width="Auto"/>
                                        <ColumnDefinition Width="*"/>
                                        <ColumnDefinition Width="Auto"/>
                                    </Grid.ColumnDefinitions>
                                    <TextBlock Grid.Column="0" Text="{Binding Status}" Width="24" FontFamily="Consolas"/>
                                    <TextBlock Grid.Column="1" Text="{Binding Name}" Foreground="#27272A"/>
                                    <TextBlock Grid.Column="2" Text="{Binding Version}" Foreground="#71717A" FontSize="12"/>
                                </Grid>
                            </DataTemplate>
                        </ItemsControl.ItemTemplate>
                    </ItemsControl>

                    <TextBlock Text="安装进度" FontSize="14" FontWeight="SemiBold" Margin="0,16,0,8" Foreground="#18181B"/>
                    <ItemsControl x:Name="InstallList">
                        <ItemsControl.ItemTemplate>
                            <DataTemplate>
                                <Grid Margin="0,2">
                                    <Grid.ColumnDefinitions>
                                        <ColumnDefinition Width="Auto"/>
                                        <ColumnDefinition Width="*"/>
                                        <ColumnDefinition Width="Auto"/>
                                    </Grid.ColumnDefinitions>
                                    <TextBlock Grid.Column="0" Text="{Binding Status}" Width="24" FontFamily="Consolas"/>
                                    <TextBlock Grid.Column="1" Text="{Binding Name}" Foreground="#27272A"/>
                                    <TextBlock Grid.Column="2" Text="{Binding Detail}" Foreground="#71717A" FontSize="12"/>
                                </Grid>
                            </DataTemplate>
                        </ItemsControl.ItemTemplate>
                    </ItemsControl>

                    <ProgressBar x:Name="OverallProgress" Height="6" Margin="0,16,0,0" Minimum="0" Maximum="100"/>
                    <TextBlock x:Name="OverallText" Text="" FontSize="12" Foreground="#71717A" Margin="0,6,0,0"/>
                </StackPanel>
            </ScrollViewer>
        </Border>

        <StackPanel Grid.Row="2" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
            <Button x:Name="CancelButton" Content="关闭" Width="80" Height="32" Margin="0,0,8,0" IsEnabled="True"/>
            <Button x:Name="InstallButton" Content="继续安装" Width="120" Height="32" Margin="0,0,8,0" Background="#006FEE" Foreground="White" Visibility="Collapsed"/>
            <Button x:Name="LaunchButton" Content="启动应用" Width="120" Height="32" Background="#006FEE" Foreground="White" Visibility="Collapsed"/>
        </StackPanel>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$detectionList = $window.FindName("DetectionList")
$installList = $window.FindName("InstallList")
$overallProgress = $window.FindName("OverallProgress")
$overallText = $window.FindName("OverallText")
$cancelButton = $window.FindName("CancelButton")
$installButton = $window.FindName("InstallButton")
$launchButton = $window.FindName("LaunchButton")
$welcomeText = $window.FindName("WelcomeText")
$headerSubtitle = $window.FindName("HeaderSubtitle")

$depItems = New-Object System.Collections.ObjectModel.ObservableCollection[Object]
$installItems = New-Object System.Collections.ObjectModel.ObservableCollection[Object]
$detectionList.ItemsSource = $depItems
$installList.ItemsSource = $installItems

$Global:Cancelled = $false
$Global:Failed = $false
$Global:ExitCode = 1
$Global:Manifest = $null
$Global:Detected = $null
$Global:RequiredMissing = @()
$Global:OptionalMissing = @()
$Global:LogDir = Join-Path $env:ProgramData "JIUZHANG AI\logs"
$Global:LogFile = Join-Path $Global:LogDir "install-bootstrap.log"

if (-not (Test-Path -LiteralPath $Global:LogDir -PathType Container)) {
    New-Item -ItemType Directory -Path $Global:LogDir -Force | Out-Null
}

function Write-InstallerLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $Global:LogFile -Value $line -Encoding UTF8
}

Write-InstallerLog "=== JIUZHANG AI installer bootstrap start ==="
Write-InstallerLog "Mode=$Mode"
Write-InstallerLog "InstallDir=$InstallDir"
Write-InstallerLog "ManifestPath=$ManifestPath"

function Update-Progress {
    param([int]$Percent, [string]$Text)
    $overallProgress.Value = $Percent
    $overallText.Text = $Text
    [System.Windows.Forms.Application]::DoEvents()
}

function Add-DetectionRow {
    param([string]$Name, [string]$Status, [string]$Version)
    $depItems.Add([PSCustomObject]@{
        Status = $Status
        Name = $Name
        Version = $Version
    }) | Out-Null
}

function Add-InstallRow {
    param([string]$Name, [string]$Status, [string]$Detail)
    $installItems.Add([PSCustomObject]@{
        Status = $Status
        Name = $Name
        Detail = $Detail
    }) | Out-Null
}

function Update-InstallRow {
    param([int]$Index, [string]$Status, [string]$Detail)
    if ($Index -ge 0 -and $Index -lt $installItems.Count) {
        $item = $installItems[$Index]
        $item.Status = $Status
        $item.Detail = $Detail
    }
}

function Add-FailureRow {
    param([string]$Name, [string]$Detail)
    Add-InstallRow -Name $Name -Status "!" -Detail $Detail
    Write-InstallerLog "$Name: $Detail"
}

function Compare-Version {
    param([string]$A, [string]$B)
    if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) { return -1 }
    try {
        $a = [version]($A -replace "[^\d\.]", "")
        $b = [version]($B -replace "[^\d\.]", "")
    } catch {
        return -1
    }
    if ($a -lt $b) { return -1 }
    if ($a -gt $b) { return 1 }
    return 0
}

function Get-DepLabel {
    param([string]$Name)
    $dep = $Global:Manifest.deps.$Name
    if ($dep -and $dep.label) { return $dep.label }
    if ($dep -and $dep.name) { return $dep.name }
    return $Name
}

function Get-DepOrder {
    if (-not $Global:Manifest -or -not $Global:Manifest.deps) { return @() }
    return @($Global:Manifest.deps.PSObject.Properties.Name)
}

function Read-DetectedDeps {
    $detector = Join-Path $PSScriptRoot "detect-deps.ps1"
    if (-not (Test-Path $detector)) {
        throw "找不到 detect-deps.ps1"
    }
    $raw = & $detector 2>&1 | Out-String
    Write-InstallerLog "detect-deps output: $raw"
    try {
        return $raw | ConvertFrom-Json
    } catch {
        throw "依赖检测结果解析失败: $($_.Exception.Message)"
    }
}

function Test-DepInstalled {
    param(
        [object]$Detected,
        [string]$Name,
        [object]$ManifestDep
    )

    if (-not $Detected -or -not ($Detected.PSObject.Properties.Name -contains $Name)) {
        return $false
    }

    $d = $Detected.$Name
    if (-not [bool]$d.installed) {
        return $false
    }

    if ($ManifestDep.minVersion -and $d.version) {
        return (Compare-Version $d.version $ManifestDep.minVersion) -ge 0
    }

    return $true
}

function Refresh-DependencyDetection {
    param([bool]$ShowRows = $true)

    $Global:Detected = Read-DetectedDeps
    $Global:RequiredMissing = @()
    $Global:OptionalMissing = @()
    if ($ShowRows) {
        $depItems.Clear()
    }

    foreach ($name in Get-DepOrder) {
        $label = Get-DepLabel $name
        $manifestDep = $Global:Manifest.deps.$name
        $isInstalled = Test-DepInstalled -Detected $Global:Detected -Name $name -ManifestDep $manifestDep
        $version = ""
        if ($Global:Detected -and $Global:Detected.PSObject.Properties.Name -contains $name) {
            $version = $Global:Detected.$name.version
        }

        if ($isInstalled) {
            if ($ShowRows) { Add-DetectionRow -Name $label -Status "✓" -Version "已安装 $version" }
        } elseif ($manifestDep.optional) {
            $Global:OptionalMissing += $name
            if ($ShowRows) { Add-DetectionRow -Name $label -Status "△" -Version "未安装，可选" }
        } else {
            $Global:RequiredMissing += $name
            if ($ShowRows) { Add-DetectionRow -Name $label -Status "✗" -Version "未安装或版本过低" }
        }
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-InstallerFile {
    param(
        [string]$Path,
        [object]$Dep
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }

    $item = Get-Item -LiteralPath $Path
    if ($Dep.size -and [int64]$Dep.size -gt 0 -and $item.Length -ne [int64]$Dep.size) {
        return $false
    }

    if ($Dep.sha256) {
        $actual = Get-FileSha256 -Path $Path
        if ($actual -ne ([string]$Dep.sha256).ToLowerInvariant()) {
            return $false
        }
    }

    return $true
}

function Start-InstallerProcess {
    param(
        [string]$Installer,
        [string]$SilentArgs
    )

    $ext = [System.IO.Path]::GetExtension($Installer).ToLowerInvariant()
    Write-InstallerLog "Run installer: $Installer $SilentArgs"

    if ($ext -eq ".msi") {
        $args = @("/i", "`"$Installer`"")
        if ($SilentArgs) {
            $args += ($SilentArgs -split "\s+" | Where-Object { $_ -and $_ -ne "/i" })
        }
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru -NoNewWindow
        Write-InstallerLog "Installer exit code: $($proc.ExitCode)"
        return $proc
    }

    $proc = Start-Process -FilePath $Installer -ArgumentList $SilentArgs -Wait -PassThru -NoNewWindow
    Write-InstallerLog "Installer exit code: $($proc.ExitCode)"
    return $proc
}

function Resolve-DependencyInstaller {
    param(
        [object]$Dep,
        [string]$CacheDir
    )

    $bundledFile = Join-Path $PSScriptRoot ("deps\" + $Dep.filename)
    if (Test-InstallerFile -Path $bundledFile -Dep $Dep) {
        Write-InstallerLog "Using bundled dependency: $bundledFile"
        return $bundledFile
    }

    if (Test-Path -LiteralPath $bundledFile -PathType Leaf) {
        Write-InstallerLog "Bundled dependency failed verification: $bundledFile"
    } else {
        Write-InstallerLog "Bundled dependency missing: $bundledFile"
    }

    $localFile = Join-Path $CacheDir $Dep.filename
    if ((Test-Path -LiteralPath $localFile -PathType Leaf) -and -not (Test-InstallerFile -Path $localFile -Dep $Dep)) {
        Write-InstallerLog "Removing invalid cached dependency: $localFile"
        Remove-Item -LiteralPath $localFile -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $localFile -PathType Leaf)) {
        try {
            Write-InstallerLog "Downloading dependency: $($Dep.url) -> $localFile"
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent", "AI-Content-Installer/1.0")
            $wc.DownloadFile($Dep.url, $localFile)
            $wc.Dispose()
        } catch {
            Write-InstallerLog "Download failed: $($_.Exception.Message)"
            return $null
        }
    }

    if (-not (Test-InstallerFile -Path $localFile -Dep $Dep)) {
        Write-InstallerLog "Downloaded dependency failed verification: $localFile"
        return $null
    }

    Write-InstallerLog "Using downloaded dependency: $localFile"
    return $localFile
}

function Fail-Install {
    param([string]$Message)
    Write-InstallerLog "FAIL: $Message"
    $Global:Failed = $true
    $Global:ExitCode = 1
    $headerSubtitle.Text = "安装未完成"
    Update-Progress 100 $Message
    $welcomeText.Text = "安装没有完成,主程序暂时不能使用。请根据上方失败项修复后重新运行安装程序。日志: $Global:LogFile"
    $cancelButton.Content = "关闭"
    $cancelButton.IsEnabled = $true
    $cancelButton.Visibility = "Visible"
    $launchButton.Visibility = "Collapsed"
}

function Complete-Preflight {
    Update-Progress 100 "运行环境准备完成"
    Write-InstallerLog "=== JIUZHANG AI installer preflight success ==="
    $headerSubtitle.Text = "环境已就绪"
    $welcomeText.Text = "必需运行环境已就绪，安装程序将继续安装主程序。"
    $installButton.Visibility = "Collapsed"
    $launchButton.Visibility = "Collapsed"
    $cancelButton.Visibility = "Collapsed"
    $Global:ExitCode = 0
    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(800)
    $timer.Add_Tick({
        $this.Stop()
        $window.Close()
    })
    $timer.Start()
}

function Start-DependencyInstall {
    Update-Progress 5 "正在检查内置运行资源"
    $headerSubtitle.Text = "检查内置运行资源..."

    $detector = Join-Path $PSScriptRoot "detect-deps.ps1"
    if (-not (Test-Path $detector)) {
        $headerSubtitle.Text = "找不到 detect-deps.ps1"
        return
    }
    $raw = & $detector 2>&1 | Out-String
    $detected = $null
    try { $detected = $raw | ConvertFrom-Json } catch {}

    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

    $ordered = @(Get-DepOrder)

    foreach ($name in $ordered) {
        $label = Get-DepLabel $name
        if ($detected -and $detected.PSObject.Properties.Name -contains $name) {
            $d = $detected.$name
            if ($d.installed) {
                Add-DetectionRow -Name $label -Status "✓" -Version "v$($d.version)"
            } else {
                Add-DetectionRow -Name $label -Status "✗" -Version "需安装"
            }
        } else {
            Add-DetectionRow -Name $label -Status "✗" -Version "需安装"
        }
        [System.Windows.Forms.Application]::DoEvents()
    }

    if ($Global:Cancelled) { return }

    Update-Progress 15 "准备补齐缺失组件"
    $headerSubtitle.Text = "补齐缺失组件..."

    $totalSteps = $ordered.Count
    $stepIdx = 0

    foreach ($name in $ordered) {
        if ($Global:Cancelled) { return }
        $stepIdx++
        $label = Get-DepLabel $name
        $manifestDep = $manifest.deps.$name

        $isInstalled = $false
        $currentVer = $null
        if ($detected -and $detected.PSObject.Properties.Name -contains $name) {
            $isInstalled = [bool]$detected.$name.installed
            $currentVer = $detected.$name.version
        }

        $rowIndex = $installItems.Count
        Add-InstallRow -Name $label -Status "···" -Detail "等待"

        if ($manifestDep.optional -and $isInstalled) {
            Update-InstallRow -Index $rowIndex -Status "○" -Detail "已装,跳过"
            Update-Progress (15 + ($stepIdx * 60 / $totalSteps)) "跳过 $label"
            continue
        }

        if ($isInstalled -and $currentVer) {
            $cmp = Compare-Version $currentVer $manifestDep.minVersion
            if ($cmp -ge 0) {
                Update-InstallRow -Index $rowIndex -Status "○" -Detail "已装 v$currentVer"
                Update-Progress (15 + ($stepIdx * 60 / $totalSteps)) "跳过 $label"
                continue
            }
        }

        Update-Progress (15 + ($stepIdx * 60 / $totalSteps)) "下载 $label"
        Update-InstallRow -Index $rowIndex -Status "↓" -Detail "下载中..."

        $tmp = "$env:TEMP\ai-content-deps"
        if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp -Force | Out-Null }
        $localFile = Resolve-DependencyInstaller -Dep $manifestDep -CacheDir $tmp

        if (-not $localFile) {
            Update-InstallRow -Index $rowIndex -Status "✗" -Detail "安装文件不可用"
            Add-FailureRow -Name "$label 文件" -Detail "内置/下载文件都不可用: $($manifestDep.filename)"
            $Global:Failed = $true
            continue
        }

        Update-InstallRow -Index $rowIndex -Status "⟳" -Detail "安装中..."
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $proc = Start-InstallerProcess -Installer $localFile -SilentArgs $manifestDep.silentArgs
            if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
                Update-InstallRow -Index $rowIndex -Status "✓" -Detail "完成"
            } else {
                Update-InstallRow -Index $rowIndex -Status "✗" -Detail "退出码 $($proc.ExitCode)"
                Add-FailureRow -Name "$label 安装器" -Detail "退出码 $($proc.ExitCode), 文件 $localFile"
                $Global:Failed = $true
            }
        } catch {
            Update-InstallRow -Index $rowIndex -Status "✗" -Detail $_.Exception.Message
            Add-FailureRow -Name "$label 安装异常" -Detail $_.Exception.Message
            $Global:Failed = $true
        }
    }

    if ($Global:Cancelled) { return }

    if ($Global:Failed) {
        Fail-Install "组件准备失败,请查看上方失败项"
        return
    }

    $headerSubtitle.Text = "检查主程序..."
    Update-Progress 80 "检查已安装文件"

    if (-not (Test-Path $InstallDir)) {
        Fail-Install "找不到安装目录: $InstallDir"
        return
    }

    Update-Progress 86 "检查本地数据库配置"
    Add-InstallRow -Name "本地数据库" -Status "✓" -Detail "SQLite 随应用启动自动创建"

    Update-Progress 90 "注册自启动"

    $exe = Join-Path $InstallDir "JIUZHANG AI.exe"
    if (Test-Path $exe) {
        try {
            $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            Set-ItemProperty -Path $regPath -Name "JIUZHANG AI" -Value "`"$exe`" --autostart"
        } catch {}

        try {
            $shell = New-Object -ComObject WScript.Shell
            $desktop = [Environment]::GetFolderPath("Desktop")
            $sc = $shell.CreateShortcut((Join-Path $desktop "JIUZHANG AI 内容创作平台.lnk"))
            $sc.TargetPath = $exe
            $sc.WorkingDirectory = (Split-Path $exe -Parent)
            $sc.IconLocation = "$exe,0"
            $sc.Save()

            $startMenu = [Environment]::GetFolderPath("StartMenu")
            $folder = Join-Path $startMenu "Programs\JIUZHANG AI"
            New-Item -ItemType Directory -Path $folder -Force | Out-Null

            $appShortcut = $shell.CreateShortcut((Join-Path $folder "JIUZHANG AI 内容创作平台.lnk"))
            $appShortcut.TargetPath = $exe
            $appShortcut.WorkingDirectory = (Split-Path $exe -Parent)
            $appShortcut.IconLocation = "$exe,0"
            $appShortcut.Save()

            $repairShortcut = $shell.CreateShortcut((Join-Path $folder "修复安装.lnk"))
            $repairShortcut.TargetPath = "powershell.exe"
            $repairScript = "$PSScriptRoot\bootstrap-installer.ps1"
            $repairArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$repairScript`" -InstallDir `"$InstallDir`" -ManifestPath `"$ManifestPath`""
            $repairShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Start-Process powershell.exe -Verb RunAs -ArgumentList '$repairArgs'`""
            $repairShortcut.WorkingDirectory = $InstallDir
            $repairShortcut.IconLocation = "$exe,0"
            $repairShortcut.Save()
        } catch {}
    } else {
        Fail-Install "找不到主程序: $exe"
        return
    }

    Update-Progress 96 "安装后自检"
    $selfCheck = Join-Path $PSScriptRoot "self-check.ps1"
    if (-not (Test-Path $selfCheck)) {
        Fail-Install "找不到安装后自检脚本: $selfCheck"
        return
    }

    $selfCheckOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $selfCheck -InstallDir $InstallDir 2>&1
    $selfCheckText = ($selfCheckOutput | Out-String).Trim()
    if ($selfCheckText) { Write-InstallerLog $selfCheckText }
    if ($LASTEXITCODE -ne 0) {
        Add-InstallRow -Name "安装后自检" -Status "!" -Detail "有警告，已写入日志"
        if ($selfCheckText) {
            foreach ($line in ($selfCheckText -split "`r?`n")) {
                if ($line -match "^\[FAIL\]") {
                    Add-InstallRow -Name "自检警告" -Status "!" -Detail ($line -replace "^\[FAIL\]\s*", "")
                }
            }
        }
    } else {
        Add-InstallRow -Name "安装后自检" -Status "✓" -Detail "通过"
    }

    Update-Progress 100 "完成"
    Write-InstallerLog "=== JIUZHANG AI installer bootstrap success ==="
    $headerSubtitle.Text = "安装完成！"
    $welcomeText.Text = "AI 内容创作平台已安装到你的电脑。点击「启动应用」开始使用。"
    $launchButton.Visibility = "Visible"
    $cancelButton.Visibility = "Collapsed"
    $Global:ExitCode = 0
}

function Complete-AppInstall {
    $headerSubtitle.Text = "检查主程序..."
    Update-Progress 80 "检查已安装文件"

    if (-not (Test-Path $InstallDir)) {
        Fail-Install "找不到安装目录: $InstallDir"
        return
    }

    Update-Progress 86 "检查本地数据库配置"
    Add-InstallRow -Name "本地数据库" -Status "✓" -Detail "SQLite 随应用启动自动创建"

    Update-Progress 90 "注册快捷方式"

    $exe = Join-Path $InstallDir "JIUZHANG AI.exe"
    if (Test-Path $exe) {
        try {
            $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            Set-ItemProperty -Path $regPath -Name "JIUZHANG AI" -Value "`"$exe`" --autostart"
        } catch {}

        try {
            $shell = New-Object -ComObject WScript.Shell
            $desktop = [Environment]::GetFolderPath("Desktop")
            $sc = $shell.CreateShortcut((Join-Path $desktop "JIUZHANG AI 内容创作平台.lnk"))
            $sc.TargetPath = $exe
            $sc.WorkingDirectory = (Split-Path $exe -Parent)
            $sc.IconLocation = "$exe,0"
            $sc.Save()

            $startMenu = [Environment]::GetFolderPath("StartMenu")
            $folder = Join-Path $startMenu "Programs\JIUZHANG AI"
            New-Item -ItemType Directory -Path $folder -Force | Out-Null

            $appShortcut = $shell.CreateShortcut((Join-Path $folder "JIUZHANG AI 内容创作平台.lnk"))
            $appShortcut.TargetPath = $exe
            $appShortcut.WorkingDirectory = (Split-Path $exe -Parent)
            $appShortcut.IconLocation = "$exe,0"
            $appShortcut.Save()

            $repairShortcut = $shell.CreateShortcut((Join-Path $folder "修复安装.lnk"))
            $repairShortcut.TargetPath = "powershell.exe"
            $repairScript = "$PSScriptRoot\bootstrap-installer.ps1"
            $repairArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$repairScript`" -InstallDir `"$InstallDir`" -ManifestPath `"$ManifestPath`""
            $repairShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Start-Process powershell.exe -Verb RunAs -ArgumentList '$repairArgs'`""
            $repairShortcut.WorkingDirectory = $InstallDir
            $repairShortcut.IconLocation = "$exe,0"
            $repairShortcut.Save()
        } catch {}
    } else {
        Fail-Install "找不到主程序: $exe"
        return
    }

    Update-Progress 96 "安装后自检"
    $selfCheck = Join-Path $PSScriptRoot "self-check.ps1"
    if (-not (Test-Path $selfCheck)) {
        Fail-Install "找不到安装后自检脚本: $selfCheck"
        return
    }

    $selfCheckOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $selfCheck -InstallDir $InstallDir 2>&1
    $selfCheckText = ($selfCheckOutput | Out-String).Trim()
    if ($selfCheckText) { Write-InstallerLog $selfCheckText }
    if ($LASTEXITCODE -ne 0) {
        Add-InstallRow -Name "安装后自检" -Status "!" -Detail "有警告，已写入日志"
        if ($selfCheckText) {
            foreach ($line in ($selfCheckText -split "`r?`n")) {
                if ($line -match "^\[FAIL\]") {
                    Add-InstallRow -Name "自检警告" -Status "!" -Detail ($line -replace "^\[FAIL\]\s*", "")
                }
            }
        }
    } else {
        Add-InstallRow -Name "安装后自检" -Status "✓" -Detail "通过"
    }

    Update-Progress 100 "完成"
    Write-InstallerLog "=== JIUZHANG AI installer bootstrap success ==="
    $headerSubtitle.Text = "安装完成"
    $welcomeText.Text = "JIUZHANG AI 内容创作平台已安装完成。点击「启动应用」开始使用。"
    $installButton.Visibility = "Collapsed"
    $launchButton.Visibility = "Visible"
    $cancelButton.Visibility = "Collapsed"
    $Global:ExitCode = 0
}

function Show-InitialDetection {
    Update-Progress 5 "正在检查内置运行资源"
    $headerSubtitle.Text = "检查内置运行资源..."
    $installButton.Visibility = "Collapsed"
    $launchButton.Visibility = "Collapsed"
    $installItems.Clear()

    $Global:Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    Refresh-DependencyDetection -ShowRows $true

    $requiredCount = $Global:RequiredMissing.Count
    $optionalCount = $Global:OptionalMissing.Count
    if ($requiredCount -eq 0) {
        Add-InstallRow -Name "内置运行资源" -Status "✓" -Detail "已就绪"
        $headerSubtitle.Text = "内置运行资源已就绪"
        if ($Mode -eq "Preflight") {
            $welcomeText.Text = "应用运行所需资源已随安装包内置，安装程序将继续安装主程序。"
            Complete-Preflight
        } else {
            $welcomeText.Text = "应用运行所需资源已随安装包内置，安装程序将完成应用文件检查和自检。"
            Complete-AppInstall
        }
    } else {
        $missingNames = ($Global:RequiredMissing | ForEach-Object { Get-DepLabel $_ }) -join "、"
        Add-InstallRow -Name "缺失组件" -Status "!" -Detail $missingNames
        $headerSubtitle.Text = "发现缺失组件"
        $welcomeText.Text = "检测到安装包内置组件缺失。请重新下载安装包，或联系 Kaypal 支持处理。"
        $installButton.Visibility = "Visible"
        Update-Progress 15 "等待处理"
    }
    $cancelButton.IsEnabled = $true
}

function Install-MissingDependencies {
    if ($Global:Cancelled) { return }

    Update-Progress 15 "准备补齐缺失组件"
    $headerSubtitle.Text = "补齐缺失组件..."
    $installButton.IsEnabled = $false
    $cancelButton.IsEnabled = $false
    $Global:Failed = $false

    $targets = @($Global:RequiredMissing + $Global:OptionalMissing)
    if ($targets.Count -eq 0) {
        if ($Mode -eq "Preflight") {
            Complete-Preflight
        } else {
            Complete-AppInstall
        }
        return
    }

    $totalSteps = $targets.Count
    $stepIdx = 0

    foreach ($name in $targets) {
        if ($Global:Cancelled) { return }
        $stepIdx++
        $label = Get-DepLabel $name
        $manifestDep = $Global:Manifest.deps.$name

        $rowIndex = $installItems.Count
        Add-InstallRow -Name $label -Status "···" -Detail "等待"

        Update-Progress (15 + ($stepIdx * 60 / $totalSteps)) "下载 $label"
        Update-InstallRow -Index $rowIndex -Status "↓" -Detail "从 Kaypal OSS 下载..."

        $tmp = "$env:TEMP\ai-content-deps"
        if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp -Force | Out-Null }
        $localFile = Resolve-DependencyInstaller -Dep $manifestDep -CacheDir $tmp

        if (-not $localFile) {
            Update-InstallRow -Index $rowIndex -Status "✗" -Detail "安装文件不可用"
            Add-FailureRow -Name "$label 文件" -Detail "下载或校验失败: $($manifestDep.filename)"
            if (-not $manifestDep.optional) { $Global:Failed = $true }
            continue
        }

        Update-InstallRow -Index $rowIndex -Status "⟳" -Detail "安装中..."
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $proc = Start-InstallerProcess -Installer $localFile -SilentArgs $manifestDep.silentArgs
            if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
                Update-InstallRow -Index $rowIndex -Status "✓" -Detail "完成"
            } else {
                Update-InstallRow -Index $rowIndex -Status "✗" -Detail "退出码 $($proc.ExitCode)"
                Add-FailureRow -Name "$label 安装器" -Detail "退出码 $($proc.ExitCode), 文件 $localFile"
                if (-not $manifestDep.optional) { $Global:Failed = $true }
            }
        } catch {
            Update-InstallRow -Index $rowIndex -Status "✗" -Detail $_.Exception.Message
            Add-FailureRow -Name "$label 安装异常" -Detail $_.Exception.Message
            if (-not $manifestDep.optional) { $Global:Failed = $true }
        }
    }

    if ($Global:Cancelled) { return }

    if ($Global:Failed) {
        Fail-Install "必需环境安装失败,请查看上方失败项"
        return
    }

    Update-Progress 78 "安装完成，正在复检"
    $depItems.Clear()
    Refresh-DependencyDetection -ShowRows $true
    if ($Global:RequiredMissing.Count -gt 0) {
        $missingNames = ($Global:RequiredMissing | ForEach-Object { Get-DepLabel $_ }) -join "、"
        Add-FailureRow -Name "复检失败" -Detail "仍缺失: $missingNames"
        Fail-Install "环境复检未通过"
        return
    }

    if ($Mode -eq "Preflight") {
        Complete-Preflight
    } else {
        Complete-AppInstall
    }
}

$cancelButton.Add_Click({
    $Global:Cancelled = $true
    $headerSubtitle.Text = "正在取消..."
    $window.Close()
})

$installButton.Add_Click({
    try {
        Install-MissingDependencies
    } catch {
        Fail-Install "安装程序异常: $($_.Exception.Message)"
    }
})

$launchButton.Add_Click({
    $exe = Join-Path $InstallDir "JIUZHANG AI.exe"
    if (Test-Path $exe) {
        Start-Process -FilePath $exe
    }
    $window.Close()
})

$window.Add_Loaded({
    try {
        if ($Mode -eq "PostInstall") {
            $welcomeText.Text = "运行环境已准备完成，正在初始化本地数据库、注册快捷方式并执行安装后自检。"
            Complete-AppInstall
        } else {
            Show-InitialDetection
        }
    } catch {
        Fail-Install "安装程序异常: $($_.Exception.Message)"
    }
})

[void]$window.ShowDialog()
exit $Global:ExitCode
