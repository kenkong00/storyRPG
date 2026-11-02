# Windows local speech synthesis daemon.
#
# IMPORTANT - this file MUST stay pure ASCII.
# PowerShell 5.1 parses .ps1 with the system ANSI code page, so any Chinese literal
# here gets corrupted. Chinese text therefore travels as a UTF-8 file PATH, and every
# other argument is base64-encoded UTF-8. Do not "fix" this by adding Chinese comments.
#
# Two backends, picked automatically at startup:
#   1. WinRT  (Windows.Media.SpeechSynthesis) - newer "OneCore" voices, best quality.
#   2. SAPI   (SAPI.SpVoice + SAPI.SpFileStream) - always present on desktop Windows.
# Why a fallback: on plenty of machines the WinRT type is simply not resolvable from
# Windows PowerShell 5.1 ("TypeNotFound"), which used to leave this engine with zero
# voices and every synthesis failing. SAPI has the same Chinese voices (e.g. Huihui)
# and is far more forgiving, so it is the safety net.
#
# Why a persistent daemon instead of spawning per synthesis:
#   Loading the types costs ~2.5s. Keeping one process alive turns that into a
#   one-time cost, so each sentence only pays a few hundred ms of actual synthesis.
#
# Protocol (one command per line on stdin):
#   ::PING::     -> ::PONG::
#   ::LIST::     -> V|<b64 name>|<lang>|<gender> ... ::LISTEND::
#   ::BACKEND::  -> ::BACKEND::<winrt|sapi>
#   ::SYNTH::<b64wav>|<b64voice>|<rate>|<b64textfile>[|<pitchHz>]
#               -> ::SYNTHED::<bytes>::<ms> | ::SYNTHERR::<msg>
#   The pitch part is optional: an old-style 4-field command still works and means pitch 0.
#   ::QUIT::     -> exits

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

function B64Encode([string]$s) {
  return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($s))
}

function B64Decode([string]$s) {
  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
}

function Get-SapiLang([string]$desc) {
  $d = $desc.ToLower()
  if ($d.Contains('chinese')) {
    if ($d.Contains('traditional')) { return 'zh-TW' }
    if ($d.Contains('hong kong')) { return 'zh-HK' }
    return 'zh-CN'
  }
  if ($d.Contains('english')) {
    if ($d.Contains('united kingdom')) { return 'en-GB' }
    return 'en-US'
  }
  if ($d.Contains('japanese')) { return 'ja-JP' }
  if ($d.Contains('korean')) { return 'ko-KR' }
  return 'en-US'
}

function Get-SapiGender([string]$desc) {
  $d = $desc.ToLower()
  # SAPI does not expose gender; these are the Chinese desktop voices people
  # actually have, and guessing wrong here only costs a slightly wrong voice.
  foreach ($m in @('kangkang', 'yunjian', 'yunxi', 'yunyang', 'david', 'mark', 'zhiwei')) {
    if ($d.Contains($m)) { return 'Male' }
  }
  return 'Female'
}

# ---------------------------------------------------------------- backend probe
# We enumerate from EVERY reachable backend and merge into one list, because the
# three APIs enumerate the SAME underlying SAPI tokens yet disagree on how many
# they expose: on some Windows builds System.Speech only returns "Huihui" while
# raw SAPI-COM reveals the full OneCore set (including male voices). Merging means
# the dropdown shows every installed Chinese voice with its REAL gender.
$mode = 'none'
$winrtSynth = $null
$winrtVoices = @()
$sapiVoices = @()
$sapiVoice = $null
$comTokens = $null

# $voiceList: array of @{ Norm; Key; Lang; Gender; Backend }
#   Norm  - normalized id used for de-duplication across backends
#   Key   - the exact string the matching synth function selects on
#   Backend - 'winrt' | 'sapi' | 'com' (which synth path owns this voice)
$voiceList = @()

function Get-LcidLang([string]$lcid, [string]$desc) {
  if ($lcid -match '^[0-9a-fA-F]+$') {
    try {
      $ci = [System.Globalization.CultureInfo]::GetCultureInfo([int]('0x' + $lcid))
      if ($ci) { return $ci.Name }
    } catch { }
  }
  return (Get-SapiLang $desc)
}

function AddVoice([string]$norm, [string]$key, [string]$lang, [string]$gender, [string]$backend) {
  if (-not $key) { return }
  if (-not $norm) { $norm = $key }
  # NOTE: must write to the SCRIPT scope. Inside a function, `$voiceList += ...`
  # would create a local copy and the script-scope list would stay empty.
  # de-dupe by normalized id; keep the highest-priority backend (winrt > com > sapi).
  # COM (SpVoice->SpFileStream) is preferred over System.Speech for synthesis because
  # on some Windows builds System.Speech.Speak() throws "no voice available for current
  # security settings" even though the same voice enumerates fine - COM does not have that
  # restriction when writing to a file stream.
  $prio = @{ winrt = 3; com = 2; sapi = 1 }
  foreach ($v in $script:voiceList) {
    if ($v.Norm -eq $norm) {
      if (($prio[$backend] -gt $prio[$v.Backend])) {
        $v.Key = $key; $v.Lang = $lang; $v.Gender = $gender; $v.Backend = $backend
      }
      return
    }
  }
  $script:voiceList += @{ Norm = $norm; Key = $key; Lang = $lang; Gender = $gender; Backend = $backend }
}

try {
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $winrtSynth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $winrtVoices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)
} catch {
  $winrtVoices = @()
}

if ($winrtVoices.Count -gt 0) {
  $mode = 'winrt'
  foreach ($v in $winrtVoices) {
    AddVoice $v.DisplayName $v.DisplayName $v.Language $v.Gender 'winrt'
  }
}

# Preferred local fallback: .NET System.Speech. It ships with desktop PowerShell,
# handles the WAV format negotiation itself, and exposes Rate/Gender/Culture
# directly - far friendlier than raw SAPI COM (whose SpFileStream kept rejecting
# the audio format with 0x80045040).
try {
  Add-Type -AssemblyName System.Speech
  $ssyn = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $ssyn.SetOutputToNull()
  foreach ($iv in $ssyn.GetInstalledVoices()) {
    if (-not $iv.Enabled) { continue }
    $vi = $iv.VoiceInfo
    $lang = $vi.Culture.Name
    if ($lang -eq '') { $lang = (Get-SapiLang $vi.Name) }
    $g = if ($vi.Gender.ToString() -eq 'Male') { 'Male' } else { 'Female' }
    AddVoice ($vi.Name -replace ' - .*$', '') $vi.Name $lang $g 'sapi'
  }
  if ($mode -eq 'none' -and ($voiceList | Where-Object { $_.Backend -eq 'sapi' }).Count -gt 0) { $mode = 'sapi' }
} catch { }

# Always also probe raw SAPI COM tokens - they often reveal voices the managed
# Speech API hides. Real Gender/Language come from the token attributes.
try {
  $sapiVoice = New-Object -ComObject SAPI.SpVoice
  $comTokens = $sapiVoice.GetVoices()
  for ($i = 0; $i -lt $comTokens.Count; $i++) {
    $t = $comTokens.Item($i)
    try { $desc = $t.GetDescription() } catch { $desc = '' }
    if (-not $desc) { continue }
    try { $g = $t.GetAttribute('Gender') } catch { $g = '' }
    if (-not $g) { $g = (Get-SapiGender $desc) }
    try { $lcid = $t.GetAttribute('Language') } catch { $lcid = '' }
    $lang = (Get-LcidLang $lcid $desc)
    $norm = $desc -replace ' - .*$', ''   # "Microsoft Huihui - Chinese (Simplified)" -> "Microsoft Huihui"
    AddVoice $norm $desc $lang $g 'com'
  }
  if ($mode -eq 'none' -and $comTokens -and $comTokens.Count -gt 0) { $mode = 'com' }
} catch {
  $comTokens = $null
}

if ($voiceList.Count -eq 0) {
  Write-Output '::ERROR::no speech backend available (WinRT, System.Speech and SAPI-COM all failed)'
  exit 1
}
if ($mode -eq 'none') {
  # Fusion list is non-empty but no backend claimed it; default to sapi selection.
  $mode = 'sapi'
}

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

function Invoke-WinrtSynth([string]$wavPath, [string]$voiceName, [int]$rate, [string]$text, [int]$pitchHz) {
  $picked = $null
  foreach ($v in $winrtVoices) {
    if ($v.DisplayName -eq $voiceName) { $picked = $v; break }
  }
  if ($null -eq $picked) {
    foreach ($v in $winrtVoices) {
      if ($v.Language -like 'zh*') { $picked = $v; break }
    }
  }
  if ($null -eq $picked) { $picked = $winrtVoices[0] }

  $winrtSynth.Voice = $picked
  $escaped = [System.Security.SecurityElement]::Escape($text)
  $rateStr = if ($rate -ge 0) { '+' + $rate + '%' } else { [string]$rate + '%' }
  $prosody = "rate='" + $rateStr + "'"
  if ($pitchHz -ne 0) {
    if ($pitchHz -le -30) { $pitchVal = 'x-low' }
    elseif ($pitchHz -lt 0) { $pitchVal = 'low' }
    elseif ($pitchHz -ge 30) { $pitchVal = 'x-high' }
    else { $pitchVal = 'high' }
    $prosody = $prosody + " pitch='" + $pitchVal + "'"
  }
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + $picked.Language + "'><voice name='" + $picked.Id + "'><prosody " + $prosody + ">" + $escaped + "</prosody></voice></speak>"

  $stream = Await ($winrtSynth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $size = [int]$stream.Size
  $reader = New-Object Windows.Storage.Streams.DataReader($stream)
  Await ($reader.LoadAsync([uint32]$size)) ([uint32]) | Out-Null
  $bytes = New-Object 'byte[]' $size
  $reader.ReadBytes($bytes)
  [System.IO.File]::WriteAllBytes($wavPath, $bytes)
  $reader.Dispose()
  return $size
}

function Invoke-DotnetSynth([string]$wavPath, [string]$voiceName, [int]$rate, [string]$text) {
  # Key for a 'sapi' voice IS the System.Speech voice Name, so SelectVoice($voiceName)
  # is exact. Fall back to the first Chinese sapi voice from the fusion list.
  $picked = $voiceName
  if ($picked -eq '') {
    $fb = $script:voiceList | Where-Object { $_.Backend -eq 'sapi' -and $_.Lang -like 'zh*' } | Select-Object -First 1
    if ($fb) { $picked = $fb.Key }
  }

  $r = [int]([math]::Round($rate / 10.0))
  if ($r -gt 10) { $r = 10 }
  if ($r -lt -10) { $r = -10 }

  try { $ssyn.SelectVoice($picked) } catch { }
  $ssyn.Rate = $r
  $ssyn.SetOutputToWaveFile($wavPath)
  try {
    $ssyn.Speak($text)
  } finally {
    $ssyn.SetOutputToNull()
  }
  if (Test-Path -LiteralPath $wavPath) { return [int](Get-Item -LiteralPath $wavPath).Length }
  return 0
}

function Invoke-SapiSynth([string]$wavPath, [string]$voiceName, [int]$rate, [string]$text) {
  $idx = -1
  if ($voiceName -ne '' -and $comTokens) {
    for ($i = 0; $i -lt $comTokens.Count; $i++) {
      if ($comTokens.Item($i).GetDescription() -eq $voiceName) { $idx = $i; break }
    }
    if ($idx -lt 0) {
      $needle = $voiceName.ToLower()
      for ($i = 0; $i -lt $comTokens.Count; $i++) {
        if ($comTokens.Item($i).GetDescription().ToLower().Contains($needle)) { $idx = $i; break }
      }
    }
  }
  if ($idx -lt 0 -and $comTokens) {
    for ($i = 0; $i -lt $comTokens.Count; $i++) {
      if (($comTokens.Item($i).GetDescription() -replace ' - .*$', '') -like 'zh*') { $idx = $i; break }
    }
  }
  if ($idx -lt 0) { $idx = 0 }
  # $voiceName is the COM description (the 'com' Key), so the match above is exact.

  # SAPI rate is -10..10; our caller speaks in percent offsets.
  $sapiRate = [int]([math]::Round($rate / 10.0))
  if ($sapiRate -gt 10) { $sapiRate = 10 }
  if ($sapiRate -lt -10) { $sapiRate = -10 }

  $sp = New-Object -ComObject SAPI.SpVoice
  $sp.Voice = $sp.GetVoices().Item($idx)
  $sp.Rate = $sapiRate
  $fs = New-Object -ComObject SAPI.SpFileStream
  # Format must be chosen BEFORE Open, otherwise the stream defaults to a format the
  # voice does not support and Speak() fails with 0x80045040 (SPERR_UNSUPPORTED_FORMAT).
  # 22 = SAFT22kHz16BitMono, which every Chinese desktop voice can produce.
  try { $fs.Format.Type = 22 } catch { }
  # 3 = SSFMCreateForWrite
  $fs.Open($wavPath, 3, $false)
  try {
    $sp.AudioOutputStream = $fs
    $null = $sp.Speak($text, 0)
  } finally {
    $fs.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($fs) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sp) | Out-Null
  }
  if (Test-Path -LiteralPath $wavPath) { return [int](Get-Item -LiteralPath $wavPath).Length }
  return 0
}

Write-Output '::READY::'

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim()
  if ($cmd -eq '') { continue }
  if ($cmd -eq '::QUIT::') { break }
  if ($cmd -eq '::PING::') { Write-Output '::PONG::'; continue }
  if ($cmd -eq '::BACKEND::') { Write-Output ('::BACKEND::' + $mode); continue }

  if ($cmd -eq '::LIST::') {
    foreach ($v in $voiceList) {
      Write-Output ("V|" + (B64Encode $v.Key) + "|" + $v.Lang + "|" + $v.Gender)
    }
    Write-Output '::LISTEND::'
    continue
  }
  if ($cmd.StartsWith('::SYNTH::')) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $parts = $cmd.Substring(9).Split('|')
      $wavPath = B64Decode $parts[0]
      $voiceName = B64Decode $parts[1]
      $rate = [int]$parts[2]
      $textPath = B64Decode $parts[3]
      $pitchHz = 0
      if ($parts.Count -ge 5 -and $parts[4] -ne '') { $pitchHz = [int]$parts[4] }

      $text = ''
      if (Test-Path -LiteralPath $textPath) {
        $text = [System.IO.File]::ReadAllText($textPath, [System.Text.Encoding]::UTF8)
      }
      if ([string]::IsNullOrWhiteSpace($text)) {
        Write-Output '::SYNTHED::0::0'
        continue
      }

      # Route to the backend that actually owns this voice (the fusion list may
      # contain voices from winrt / System.Speech / SAPI-COM at the same time).
      $vbk = $mode
      foreach ($v in $voiceList) {
        if ($v.Key -eq $voiceName) { $vbk = $v.Backend; break }
      }
      if ($vbk -eq 'winrt') {
        $size = Invoke-WinrtSynth $wavPath $voiceName $rate $text $pitchHz
      } elseif ($vbk -eq 'sapi') {
        $size = Invoke-DotnetSynth $wavPath $voiceName $rate $text
      } else {
        $size = Invoke-SapiSynth $wavPath $voiceName $rate $text
      }
      # Fallback chain: a path can "succeed" but only write the 46-byte WAV header -
      # that means the voice never actually spoke (output format / voice mismatch).
      # Without this it surfaced as "本机语音未产出有效音频" with no second chance.
      if ($size -lt 1024 -and $vbk -ne 'com') {
        $alt = Invoke-SapiSynth $wavPath $voiceName $rate $text
        if ($alt -gt $size) { $size = $alt }
      }
      if ($size -lt 1024 -and $vbk -ne 'winrt' -and $null -ne $winrtSynth) {
        $alt2 = Invoke-WinrtSynth $wavPath $voiceName $rate $text $pitchHz
        if ($alt2 -gt $size) { $size = $alt2 }
      }
      $sw.Stop()
      Write-Output ("::SYNTHED::" + $size + "::" + [int]$sw.ElapsedMilliseconds)
    } catch {
      $sw.Stop()
      $m = $_.Exception.Message -replace '\r?\n', ' '
      Write-Output ("::SYNTHERR::" + $m)
    }
    continue
  }
}

Write-Output '::BYE::'
