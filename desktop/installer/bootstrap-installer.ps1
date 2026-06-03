<#
.SYNOPSIS
  AI 内容平台 Windows 安装引导（WPF UI，单线程 + DoEvents）。
#>

param(
    [string] $ManifestPath = "$PSScriptRoot\deps-manifest.json",
    [string] $AppSourceDir = "$env:TEMP\ai-content-app",
    [string] $InstallDir = "$env:ProgramFiles\KaypalAI"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="AI 内容创作平台 - 安装引导"
        Width="640" Height="520"
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
            <TextBlock Text="AI 内容创作平台" FontSize="24" FontWeight="Bold" Foreground="#18181B"/>
            <TextBlock x:Name="HeaderSubtitle" Text="正在准备你的电脑..." FontSize="13" Foreground="#71717A" Margin="0,4,0,0"/>
        </StackPanel>

        <Border Grid.Row="1" Background="White" BorderBrush="#E4E4E7" BorderThickness="1" CornerRadius="8" Padding="20">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
                <StackPanel>
                    <TextBlock x:Name="WelcomeText" TextWrapping="Wrap" FontSize="13" Foreground="#27272A" Margin="0,0,0,16">
                        本安装程序会检查并安装运行所需的环境。整个过程约需 3-5 分钟,需要联网。
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
            <Button x:Name="CancelButton" Content="取消" Width="80" Height="32" Margin="0,0,8,0" IsEnabled="False"/>
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
$launchButton = $window.FindName("LaunchButton")
$welcomeText = $window.FindName("WelcomeText")
$headerSubtitle = $window.FindName("HeaderSubtitle")

$depItems = New-Object System.Collections.ObjectModel.ObservableCollection[Object]
$installItems = New-Object System.Collections.ObjectModel.ObservableCollection[Object]
$detectionList.ItemsSource = $depItems
$installList.ItemsSource = $installItems

$Global:Cancelled = $false
$Global:Failed = $false

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

function Compare-Version {
    param([string]$A, [string]$B)
    $a = [version]($A -replace "[^\d\.]", "")
    $b = [version]($B -replace "[^\d\.]", "")
    if ($a -lt $b) { return -1 }
    if ($a -gt $b) { return 1 }
    return 0
}

function Start-DependencyInstall {
    Update-Progress 5 "正在扫描本机依赖"
    $headerSubtitle.Text = "检测环境..."

    $detector = Join-Path $PSScriptRoot "detect-deps.ps1"
    if (-not (Test-Path $detector)) {
        $headerSubtitle.Text = "找不到 detect-deps.ps1"
        return
    }
    $raw = & $detector 2>&1 | Out-String
    $detected = $null
    try { $detected = $raw | ConvertFrom-Json } catch {}

    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

    $ordered = @("node", "python", "postgres", "redis", "chrome")
    $labels = @{ "node" = "Node.js"; "python" = "Python"; "postgres" = "PostgreSQL"; "redis" = "Redis"; "chrome" = "Google Chrome" }

    foreach ($name in $ordered) {
        $label = $labels[$name]
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

    Update-Progress 15 "准备安装缺失的组件"
    $headerSubtitle.Text = "安装缺失的组件..."

    $totalSteps = $ordered.Count
    $stepIdx = 0

    foreach ($name in $ordered) {
        if ($Global:Cancelled) { return }
        $stepIdx++
        $label = $labels[$name]
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
        $localFile = Join-Path $tmp $manifestDep.filename

        if (-not (Test-Path $localFile)) {
            try {
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add("User-Agent", "AI-Content-Installer/1.0")
                $wc.DownloadFile($manifestDep.url, $localFile)
                $wc.Dispose()
            } catch {
                Update-InstallRow -Index $rowIndex -Status "✗" -Detail "下载失败"
                $Global:Failed = $true
                continue
            }
        }

        Update-InstallRow -Index $rowIndex -Status "⟳" -Detail "安装中..."
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $proc = Start-Process -FilePath $localFile -ArgumentList $manifestDep.silentArgs -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
                Update-InstallRow -Index $rowIndex -Status "✓" -Detail "完成"
            } else {
                Update-InstallRow -Index $rowIndex -Status "✗" -Detail "退出码 $($proc.ExitCode)"
                $Global:Failed = $true
            }
        } catch {
            Update-InstallRow -Index $rowIndex -Status "✗" -Detail $_.Exception.Message
            $Global:Failed = $true
        }
    }

    if ($Global:Cancelled) { return }

    if ($Global:Failed) {
        $headerSubtitle.Text = "部分组件安装失败"
        Update-Progress 100 "请查看上方失败项"
        $cancelButton.Content = "关闭"
        $cancelButton.IsEnabled = $true
        return
    }

    $headerSubtitle.Text = "配置主程序..."
    Update-Progress 80 "拷贝应用文件(干净安装)"

    if (Test-Path $AppSourceDir) {
        $stagingDir = Join-Path $env:TEMP "ai-content-staging-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

        Copy-Item -Path "$AppSourceDir\*" -Destination $stagingDir -Recurse -Force

        if (Test-Path $InstallDir) {
            Get-ChildItem -Path $InstallDir -Force |
                Where-Object { $_.Name -ne 'installer' -and $_.Name -notlike 'Uninst*' } |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }

        Get-ChildItem -Path $stagingDir -Force |
            Copy-Item -Destination $InstallDir -Recurse -Force

        Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Update-Progress 90 "注册自启动"

    $exe = Join-Path $InstallDir "KaypalAI.exe"
    if (Test-Path $exe) {
        try {
            $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            Set-ItemProperty -Path $regPath -Name "KaypalAI" -Value "`"$exe`" --autostart"
        } catch {}

        try {
            $shell = New-Object -ComObject WScript.Shell
            $desktop = [Environment]::GetFolderPath("Desktop")
            $sc = $shell.CreateShortcut((Join-Path $desktop "KaypalAI 内容创作平台.lnk"))
            $sc.TargetPath = $exe
            $sc.WorkingDirectory = (Split-Path $exe -Parent)
            $sc.IconLocation = "$exe,0"
            $sc.Save()
        } catch {}
    }

    Update-Progress 100 "完成"
    $headerSubtitle.Text = "安装完成！"
    $welcomeText.Text = "AI 内容创作平台已安装到你的电脑。点击「启动应用」开始使用。"
    $launchButton.Visibility = "Visible"
    $cancelButton.Visibility = "Collapsed"
}

$cancelButton.Add_Click({
    $Global:Cancelled = $true
    $headerSubtitle.Text = "正在取消..."
    $cancelButton.IsEnabled = $false
})

$launchButton.Add_Click({
    $exe = Join-Path $InstallDir "KaypalAI.exe"
    if (Test-Path $exe) {
        Start-Process -FilePath $exe
    }
    $window.Close()
})

$window.Add_Loaded({
    Start-DependencyInstall
})

[void]$window.ShowDialog()
