param(
    [string]$Voice,
    [string]$Music,
    [string]$OutputDirectory,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$coreDir = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing
function Select-AudioFile([string]$title, [string]$provided) {
    if (-not $provided) {
        if ($CheckOnly) { throw 'Informe -Voice e -Music para a verificacao sem janela.' }
        $dialog = New-Object Microsoft.Win32.OpenFileDialog
        $dialog.Title = $title
        $dialog.Filter = 'Audio|*.wav;*.mp3;*.m4a;*.flac;*.ogg;*.aac|Todos|*.*'
        if (-not $dialog.ShowDialog()) { exit 0 }
        $provided = $dialog.FileName
    }
    $item = Get-Item -LiteralPath $provided -ErrorAction Stop
    if ($item.PSIsContainer) { throw 'Selecione um arquivo de audio.' }
    return $item.FullName
}
function Read-AudioDuration([string]$file) {
    $probeText = & $ffprobe -v error -show_entries 'format=duration:stream=codec_type' -of json $file
    if ($LASTEXITCODE -ne 0) { throw 'FFprobe nao conseguiu ler o audio selecionado.' }
    $probe = ($probeText -join [Environment]::NewLine) | ConvertFrom-Json
    $seconds = [double]::Parse([string]$probe.format.duration, [Globalization.CultureInfo]::InvariantCulture)
    if (-not ($probe.streams | Where-Object codec_type -eq 'audio') -or $seconds -le 0 -or [double]::IsInfinity($seconds) -or [double]::IsNaN($seconds)) { throw 'Arquivo sem audio ou sem duracao valida.' }
    return $seconds
}
$voiceAudioFile = Select-AudioFile 'Selecione sua narracao' $Voice
$musicAudioFile = Select-AudioFile 'Selecione sua trilha' $Music
$voiceDuration = Read-AudioDuration $voiceAudioFile
$musicDuration = Read-AudioDuration $musicAudioFile
$script:totalSeconds = [Math]::Max($voiceDuration, $musicDuration)
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $coreDir 'outputs\audio-wave-studio\audios-unidos' }
$outputDir = [IO.Path]::GetFullPath($OutputDirectory)
if ($CheckOnly) {
    [ordered]@{ status = 'inputs-valid'; durationSeconds = $script:totalSeconds; outputDirectory = $outputDir; createsMedia = $false } | ConvertTo-Json
    exit 0
}
$baseDir = $outputDir
$waveDir = Join-Path $coreDir ('diagnosticos\audio-wave-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $waveDir | Out-Null
function New-Waveform([string]$file, [string]$name, [string]$color) {
    $imagePath = Join-Path $waveDir $name
    $durationText = $script:totalSeconds.ToString('0.######', [Globalization.CultureInfo]::InvariantCulture)
    & $ffmpeg -hide_banner -loglevel error -n -i $file -filter_complex "[0:a]apad=whole_dur=$durationText,atrim=duration=$durationText,showwavespic=s=1200x130:colors=$color[v]" -map '[v]' -frames:v 1 $imagePath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $imagePath)) { throw 'Nao foi possivel preparar a forma de onda.' }
    return $imagePath
}
$voiceWaveImg = New-Waveform $voiceAudioFile 'voice.png' '0x00F0FF'
$musicWaveImg = New-Waveform $musicAudioFile 'music.png' '0xFF0055'
$masterWaveImg = Join-Path $waveDir 'master-not-exported.png'

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Estudio de Audio Nativo — Visualizador de Ondas"
        Height="720" Width="1080"
        WindowStartupLocation="CenterScreen"
        Background="#0B0F19" Foreground="#F1F5F9">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#1E293B"/>
            <Setter Property="Foreground" Value="#FFFFFF"/>
            <Setter Property="BorderBrush" Value="#334155"/>
            <Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Padding" Value="12,6"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="Cursor" Value="Hand"/>
        </Style>
        <Style TargetType="Slider">
            <Setter Property="Foreground" Value="#00F0FF"/>
            <Setter Property="Margin" Value="0,4,0,4"/>
        </Style>
    </Window.Resources>

    <Grid Margin="20">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- HEADER -->
        <Border Grid.Row="0" BorderBrush="#243049" BorderThickness="0,0,0,1" Padding="0,0,0,15" Margin="0,0,0,15">
            <DockPanel>
                <StackPanel Orientation="Horizontal" DockPanel.Dock="Left">
                    <TextBlock Text="🎚️ Estudio de Audio Nativo Windows" FontSize="20" FontWeight="Bold" Foreground="#FFFFFF" VerticalAlignment="Center"/>
                    <Border Background="#1A00F0FF" BorderBrush="#3300F0FF" BorderThickness="1" CornerRadius="12" Margin="15,0,0,0" Padding="10,3">
                        <TextBlock Text="Multitrack Studio" FontSize="11" Foreground="#00F0FF" FontWeight="Bold" VerticalAlignment="Center"/>
                    </Border>
                </StackPanel>
                <Button Name="BtnOpenFolder" Content="📁 Abrir Pasta de Saida" HorizontalAlignment="Right" Background="#0F172A" BorderBrush="#334155"/>
            </DockPanel>
        </Border>

        <!-- TRANSPORT BAR -->
        <Border Grid.Row="1" Background="#0D1424" BorderBrush="#243049" BorderThickness="1" CornerRadius="10" Padding="15" Margin="0,0,0,15">
            <DockPanel>
                <StackPanel Orientation="Horizontal" DockPanel.Dock="Left">
                    <Button Name="BtnPlay" Content="▶ Reproduzir" Background="#2563EB" BorderBrush="#3B82F6" Width="120" Margin="0,0,10,0"/>
                    <Button Name="BtnStop" Content="⏹ Parar" Width="80" Margin="0,0,15,0"/>
                    <Border Background="#060911" BorderBrush="#1E293B" BorderThickness="1" CornerRadius="6" Padding="12,5">
                        <TextBlock Name="TxtTime" Text="00:00.0" FontFamily="Consolas" FontSize="16" FontWeight="Bold" Foreground="#00F0FF" VerticalAlignment="Center"/>
                    </Border>
                </StackPanel>
                <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                    <Button Name="BtnResetGains" Content="↺ Restaurar Ganhos (+5dB / -5dB)" Background="#1E293B" Margin="0,0,10,0"/>
                    <Button Name="BtnExport" Content="💾 Exportar Novo Master" Background="#059669" BorderBrush="#10B981"/>
                </StackPanel>
            </DockPanel>
        </Border>

        <!-- TRACK LIST -->
        <ScrollViewer Grid.Row="2" VerticalScrollBarVisibility="Auto">
            <StackPanel Orientation="Vertical">
                
                <!-- PISTA 1: VOZ -->
                <Border Background="#0D1424" BorderBrush="#243049" BorderThickness="1" CornerRadius="10" Margin="0,0,0,12" Height="130">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="230"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>

                        <!-- Controls -->
                        <Border Grid.Column="0" Background="#090E1A" BorderBrush="#243049" BorderThickness="0,0,1,0" Padding="12">
                            <StackPanel VerticalAlignment="Center">
                                <TextBlock Text="🎙️ Pista 1: Voz" FontSize="13" FontWeight="Bold" Foreground="#00F0FF" Margin="0,0,0,8"/>
                                <DockPanel Margin="0,0,0,2">
                                    <TextBlock Text="Ganho:" FontSize="11" Foreground="#94A3B8"/>
                                    <TextBlock Name="TxtVoiceGain" Text="+5.0 dB" FontSize="11" FontWeight="Bold" Foreground="#00F0FF" HorizontalAlignment="Right"/>
                                </DockPanel>
                                <Slider Name="SliderVoiceGain" Minimum="-30" Maximum="20" Value="5" SmallChange="0.5"/>
                                <StackPanel Orientation="Horizontal" Margin="0,8,0,0">
                                    <Button Name="BtnMuteVoice" Content="Mute" Width="55" Height="26" Padding="0" FontSize="11" Margin="0,0,6,0"/>
                                    <Button Name="BtnSoloVoice" Content="Solo" Width="55" Height="26" Padding="0" FontSize="11"/>
                                </StackPanel>
                            </StackPanel>
                        </Border>

                        <!-- Waveform Canvas Area -->
                        <Grid Grid.Column="1" Background="#050811" Name="GridWaveVoice" ClipToBounds="True">
                            <Image Name="ImgWaveVoice" Stretch="Fill" Opacity="0.9"/>
                            <Canvas Name="CanvasVoicePlayhead">
                                <Line Name="LineVoicePlayhead" X1="0" Y1="0" X2="0" Y2="130" Stroke="#FFFFFF" StrokeThickness="2">
                                    <Line.Effect>
                                        <DropShadowEffect Color="#FFFFFF" BlurRadius="6" ShadowDepth="0"/>
                                    </Line.Effect>
                                </Line>
                            </Canvas>
                        </Grid>
                    </Grid>
                </Border>

                <!-- PISTA 2: TRILHA -->
                <Border Background="#0D1424" BorderBrush="#243049" BorderThickness="1" CornerRadius="10" Margin="0,0,0,12" Height="130">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="230"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>

                        <!-- Controls -->
                        <Border Grid.Column="0" Background="#090E1A" BorderBrush="#243049" BorderThickness="0,0,1,0" Padding="12">
                            <StackPanel VerticalAlignment="Center">
                                <TextBlock Text="🎵 Pista 2: Trilha" FontSize="13" FontWeight="Bold" Foreground="#FF0055" Margin="0,0,0,8"/>
                                <DockPanel Margin="0,0,0,2">
                                    <TextBlock Text="Ganho:" FontSize="11" Foreground="#94A3B8"/>
                                    <TextBlock Name="TxtMusicGain" Text="-5.0 dB" FontSize="11" FontWeight="Bold" Foreground="#FF0055" HorizontalAlignment="Right"/>
                                </DockPanel>
                                <Slider Name="SliderMusicGain" Minimum="-30" Maximum="20" Value="-5" SmallChange="0.5"/>
                                <StackPanel Orientation="Horizontal" Margin="0,8,0,0">
                                    <Button Name="BtnMuteMusic" Content="Mute" Width="55" Height="26" Padding="0" FontSize="11" Margin="0,0,6,0"/>
                                    <Button Name="BtnSoloMusic" Content="Solo" Width="55" Height="26" Padding="0" FontSize="11"/>
                                </StackPanel>
                            </StackPanel>
                        </Border>

                        <!-- Waveform Canvas Area -->
                        <Grid Grid.Column="1" Background="#050811" Name="GridWaveMusic" ClipToBounds="True">
                            <Image Name="ImgWaveMusic" Stretch="Fill" Opacity="0.9"/>
                            <Canvas Name="CanvasMusicPlayhead">
                                <Line Name="LineMusicPlayhead" X1="0" Y1="0" X2="0" Y2="130" Stroke="#FFFFFF" StrokeThickness="2">
                                    <Line.Effect>
                                        <DropShadowEffect Color="#FFFFFF" BlurRadius="6" ShadowDepth="0"/>
                                    </Line.Effect>
                                </Line>
                            </Canvas>
                        </Grid>
                    </Grid>
                </Border>

                <!-- PISTA 3: MASTER RESULTANTE -->
                <Border Background="#0D1424" BorderBrush="#243049" BorderThickness="1" CornerRadius="10" Height="130">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="230"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>

                        <!-- Controls -->
                        <Border Grid.Column="0" Background="#090E1A" BorderBrush="#243049" BorderThickness="0,0,1,0" Padding="12">
                            <StackPanel VerticalAlignment="Center">
                                <TextBlock Text="🎛️ Master Resultante" FontSize="13" FontWeight="Bold" Foreground="#00FF66" Margin="0,0,0,8"/>
                                <DockPanel Margin="0,0,0,2">
                                    <TextBlock Text="Volume Geral:" FontSize="11" Foreground="#94A3B8"/>
                                    <TextBlock Name="TxtMasterGain" Text="0.0 dB" FontSize="11" FontWeight="Bold" Foreground="#00FF66" HorizontalAlignment="Right"/>
                                </DockPanel>
                                <Slider Name="SliderMasterGain" Minimum="-30" Maximum="10" Value="0" SmallChange="0.5"/>
                                <TextBlock Text="Previa aproximada; confira o WAV exportado" FontSize="10" Foreground="#64748B" Margin="0,6,0,0"/>
                            </StackPanel>
                        </Border>

                        <!-- Waveform Canvas Area -->
                        <Grid Grid.Column="1" Background="#050811" Name="GridWaveMaster" ClipToBounds="True">
                            <Image Name="ImgWaveMaster" Stretch="Fill" Opacity="0.9"/>
                            <Canvas Name="CanvasMasterPlayhead">
                                <Line Name="LineMasterPlayhead" X1="0" Y1="0" X2="0" Y2="130" Stroke="#FFFFFF" StrokeThickness="2">
                                    <Line.Effect>
                                        <DropShadowEffect Color="#FFFFFF" BlurRadius="6" ShadowDepth="0"/>
                                    </Line.Effect>
                                </Line>
                            </Canvas>
                        </Grid>
                    </Grid>
                </Border>

            </StackPanel>
        </ScrollViewer>

        <!-- FOOTER STATUS -->
        <Border Grid.Row="3" Margin="0,15,0,0" Padding="5,0">
            <DockPanel>
                <TextBlock Text="💡 Clique em qualquer ponto da onda para posicionar o cursor de reproducao." FontSize="11" Foreground="#94A3B8"/>
                <TextBlock Name="TxtStatus" Text="Pronto" FontSize="11" Foreground="#00FF66" HorizontalAlignment="Right"/>
            </DockPanel>
        </Border>
    </Grid>
</Window>
"@

$reader = (New-Object System.Xml.XmlNodeReader $xaml)
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Elementos
$BtnPlay = $window.FindName("BtnPlay")
$BtnStop = $window.FindName("BtnStop")
$BtnResetGains = $window.FindName("BtnResetGains")
$BtnExport = $window.FindName("BtnExport")
$BtnOpenFolder = $window.FindName("BtnOpenFolder")
$TxtTime = $window.FindName("TxtTime")
$TxtStatus = $window.FindName("TxtStatus")

$SliderVoiceGain = $window.FindName("SliderVoiceGain")
$TxtVoiceGain = $window.FindName("TxtVoiceGain")
$BtnMuteVoice = $window.FindName("BtnMuteVoice")
$BtnSoloVoice = $window.FindName("BtnSoloVoice")

$SliderMusicGain = $window.FindName("SliderMusicGain")
$TxtMusicGain = $window.FindName("TxtMusicGain")
$BtnMuteMusic = $window.FindName("BtnMuteMusic")
$BtnSoloMusic = $window.FindName("BtnSoloMusic")

$SliderMasterGain = $window.FindName("SliderMasterGain")
$TxtMasterGain = $window.FindName("TxtMasterGain")

$ImgWaveVoice = $window.FindName("ImgWaveVoice")
$ImgWaveMusic = $window.FindName("ImgWaveMusic")
$ImgWaveMaster = $window.FindName("ImgWaveMaster")

$GridWaveVoice = $window.FindName("GridWaveVoice")
$GridWaveMusic = $window.FindName("GridWaveMusic")
$GridWaveMaster = $window.FindName("GridWaveMaster")

$LineVoicePlayhead = $window.FindName("LineVoicePlayhead")
$LineMusicPlayhead = $window.FindName("LineMusicPlayhead")
$LineMasterPlayhead = $window.FindName("LineMasterPlayhead")

# Carrega Imagens de Waveform
if (Test-Path $voiceWaveImg) {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.UriSource = New-Object System.Uri($voiceWaveImg)
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.EndInit()
    $ImgWaveVoice.Source = $bmp
}
if (Test-Path $musicWaveImg) {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.UriSource = New-Object System.Uri($musicWaveImg)
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.EndInit()
    $ImgWaveMusic.Source = $bmp
}
if (Test-Path $masterWaveImg) {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.UriSource = New-Object System.Uri($masterWaveImg)
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.EndInit()
    $ImgWaveMaster.Source = $bmp
}

# Players de Áudio WPF Media (Sincronizados)
$playerVoice = New-Object System.Windows.Media.MediaPlayer
$playerMusic = New-Object System.Windows.Media.MediaPlayer

if (Test-Path $voiceAudioFile) { $playerVoice.Open((New-Object System.Uri($voiceAudioFile))) }
if (Test-Path $musicAudioFile) { $playerMusic.Open((New-Object System.Uri($musicAudioFile))) }

$script:isPlaying = $false
$script:muteVoice = $false
$script:muteMusic = $false
$script:soloVoice = $false
$script:soloMusic = $false

function DbToVolume([double]$db) {
    # 0dB = 0.5 volume base, +10dB = 1.0, -10dB = 0.16
    $vol = [Math]::Pow(10, $db / 20.0) * 0.3
    if ($vol -gt 1.0) { return 1.0 }
    if ($vol -lt 0.0) { return 0.0 }
    return $vol
}

function UpdateVolumes() {
    $vDb = [double]$SliderVoiceGain.Value
    $mDb = [double]$SliderMusicGain.Value
    $mastDb = [double]$SliderMasterGain.Value
    $mastFactor = [Math]::Pow(10, $mastDb / 20.0)

    $vVol = (DbToVolume $vDb) * $mastFactor
    $mVol = (DbToVolume $mDb) * $mastFactor

    if ($script:muteVoice) { $vVol = 0 }
    if ($script:muteMusic) { $mVol = 0 }

    if ($script:soloVoice) { $mVol = 0 }
    if ($script:soloMusic) { $vVol = 0 }

    $playerVoice.Volume = [Math]::Min(1.0, [Math]::Max(0.0, $vVol))
    $playerMusic.Volume = [Math]::Min(1.0, [Math]::Max(0.0, $mVol))
}

UpdateVolumes

# Timer de Atualização da Timeline e Playhead
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(30)
$timer.Add_Tick({
    if ($script:isPlaying) {
        $pos = if ($voiceDuration -gt $musicDuration) { $playerVoice.Position.TotalSeconds } else { $playerMusic.Position.TotalSeconds }
        if ($pos -ge $script:totalSeconds) {
            $BtnStop.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Button]::ClickEvent)))
            return
        }

        $min = [Math]::Floor($pos / 60)
        $sec = ($pos % 60).ToString("00.0")
        $tMin = [Math]::Floor($script:totalSeconds / 60)
        $tSec = ($script:totalSeconds % 60).ToString("00.0")
        $TxtTime.Text = "$($min.ToString('00')):$sec / $($tMin.ToString('00')):$tSec"

        $pct = $pos / $script:totalSeconds
        $width = $GridWaveVoice.ActualWidth
        if ($width -gt 0) {
            $x = $pct * $width
            $LineVoicePlayhead.X1 = $x; $LineVoicePlayhead.X2 = $x
            $LineMusicPlayhead.X1 = $x; $LineMusicPlayhead.X2 = $x
            $LineMasterPlayhead.X1 = $x; $LineMasterPlayhead.X2 = $x
        }
    }
})

$BtnPlay.Add_Click({
    if (-not $script:isPlaying) {
        $playerVoice.Play()
        $playerMusic.Play()
        $timer.Start()
        $script:isPlaying = $true
        $BtnPlay.Content = "⏸ Pausar"
        $BtnPlay.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#00F0FF")
        $BtnPlay.Foreground = [System.Windows.Media.Brushes]::Black
    } else {
        $playerVoice.Pause()
        $playerMusic.Pause()
        $timer.Stop()
        $script:isPlaying = $false
        $BtnPlay.Content = "▶ Reproduzir"
        $BtnPlay.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#2563EB")
        $BtnPlay.Foreground = [System.Windows.Media.Brushes]::White
    }
})

$BtnStop.Add_Click({
    $playerVoice.Stop()
    $playerMusic.Stop()
    $playerVoice.Position = [TimeSpan]::Zero
    $playerMusic.Position = [TimeSpan]::Zero
    $timer.Stop()
    $script:isPlaying = $false
    $BtnPlay.Content = "▶ Reproduzir"
    $BtnPlay.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#2563EB")
    $BtnPlay.Foreground = [System.Windows.Media.Brushes]::White
    $TxtTime.Text = "00:00.0"
    $LineVoicePlayhead.X1 = 0; $LineVoicePlayhead.X2 = 0
    $LineMusicPlayhead.X1 = 0; $LineMusicPlayhead.X2 = 0
    $LineMasterPlayhead.X1 = 0; $LineMasterPlayhead.X2 = 0
})

$seekAction = {
    param($sender, $e)
    $point = $e.GetPosition($sender)
    $width = $sender.ActualWidth
    if ($width -gt 0) {
        $pct = [Math]::Max(0.0, [Math]::Min(1.0, $point.X / $width))
        $newSec = $pct * $script:totalSeconds
        $playerVoice.Position = [TimeSpan]::FromSeconds($newSec)
        $playerMusic.Position = [TimeSpan]::FromSeconds($newSec)
        
        $LineVoicePlayhead.X1 = $point.X; $LineVoicePlayhead.X2 = $point.X
        $LineMusicPlayhead.X1 = $point.X; $LineMusicPlayhead.X2 = $point.X
        $LineMasterPlayhead.X1 = $point.X; $LineMasterPlayhead.X2 = $point.X
        
        $min = [Math]::Floor($newSec / 60)
        $sec = ($newSec % 60).ToString("00.0")
        $tMin = [Math]::Floor($script:totalSeconds / 60)
        $tSec = ($script:totalSeconds % 60).ToString("00.0")
        $TxtTime.Text = "$($min.ToString('00')):$sec / $($tMin.ToString('00')):$tSec"
    }
}

$GridWaveVoice.Add_MouseDown($seekAction)
$GridWaveMusic.Add_MouseDown($seekAction)
$GridWaveMaster.Add_MouseDown($seekAction)

# Slider Events
$SliderVoiceGain.Add_ValueChanged({
    $val = [double]$SliderVoiceGain.Value
    $TxtVoiceGain.Text = "$([string]::Format('{0:+0.0;-0.0;0.0}', $val)) dB"
    UpdateVolumes
})

$SliderMusicGain.Add_ValueChanged({
    $val = [double]$SliderMusicGain.Value
    $TxtMusicGain.Text = "$([string]::Format('{0:+0.0;-0.0;0.0}', $val)) dB"
    UpdateVolumes
})

$SliderMasterGain.Add_ValueChanged({
    $val = [double]$SliderMasterGain.Value
    $TxtMasterGain.Text = "$([string]::Format('{0:+0.0;-0.0;0.0}', $val)) dB"
    UpdateVolumes
})

$BtnResetGains.Add_Click({
    $SliderVoiceGain.Value = 5
    $SliderMusicGain.Value = -5
    $SliderMasterGain.Value = 0
})

$BtnOpenFolder.Add_Click({
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    Start-Process "explorer.exe" -ArgumentList @('"' + $outputDir + '"')
})

$BtnExport.Add_Click({
    $BtnExport.IsEnabled = $false
    try {
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $vGain = ([double]$SliderVoiceGain.Value + [double]$SliderMasterGain.Value).ToString('0.0', $culture) + 'dB'
        $mGain = ([double]$SliderMusicGain.Value + [double]$SliderMasterGain.Value).ToString('0.0', $culture) + 'dB'
        if ($script:muteVoice -or $script:soloMusic) { $vGain = '0' }
        if ($script:muteMusic -or $script:soloVoice) { $mGain = '0' }
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
        $outWav = Join-Path $outputDir ('master-' + [Guid]::NewGuid().ToString('N') + '.wav')
        $TxtStatus.Text = 'Exportando pelo mixer do Studio...'
        $cliFile = Join-Path $coreDir 'scripts\omni-cli.mjs'
        $mixArgs = @($cliFile, 'mix', '--mode', 'studio', '--voice', $voiceAudioFile, '--music', $musicAudioFile, '--voice-gain', $vGain, '--music-gain', $mGain, '--loudness', 'raw', '--fade-in', '0', '--fade-out', '0', '--out', $outWav)
        Push-Location -LiteralPath $coreDir
        try {
            & $node @mixArgs
            if ($LASTEXITCODE -ne 0) { throw 'O mixer retornou falha. Confira o diagnostico no terminal.' }
        } finally { Pop-Location }
        if (-not (Test-Path -LiteralPath $outWav -PathType Leaf)) { throw 'O mixer nao publicou o WAV esperado.' }
        $null = Read-AudioDuration $outWav
        $masterWaveImg = New-Waveform $outWav ('master-' + [Guid]::NewGuid().ToString('N') + '.png') '0x00FF66'
        $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
        $bmp.BeginInit()
        $bmp.UriSource = New-Object System.Uri($masterWaveImg)
        $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $ImgWaveMaster.Source = $bmp
        $TxtStatus.Text = 'WAV exportado e validado. Onda do ultimo master.'
        [System.Windows.MessageBox]::Show($outWav, 'Master exportado') | Out-Null
    } catch {
        $TxtStatus.Text = 'Falha na exportacao ou na visualizacao; confira os arquivos.'
        [System.Windows.MessageBox]::Show($_.Exception.Message, 'Falha') | Out-Null
    } finally { $BtnExport.IsEnabled = $true }
})
$window.Add_Closed({ $timer.Stop(); $playerVoice.Close(); $playerMusic.Close() })

# Show App
$window.ShowDialog() | Out-Null
