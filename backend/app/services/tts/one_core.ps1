# Windows OneCore (WinRT) speech synthesis daemon.
#
# IMPORTANT - this file MUST stay pure ASCII.
# PowerShell 5.1 parses .ps1 with the system ANSI code page, so any Chinese literal
# here gets corrupted. Chinese text therefore travels as a UTF-8 file PATH, and every
# other argument is base64-encoded UTF-8. Do not "fix" this by adding Chinese comments.
#
# Why a persistent daemon instead of spawning per synthesis:
#   Loading the WinRT types costs ~2.5s. Keeping one process alive turns that into a
#   one-time cost, so each sentence only pays ~0.4s of actual synthesis.
#
# Protocol (one command per line on stdin):
#   ::PING::     -> ::PONG::
#   ::LIST::     -> V|<b64 name>|<lang>|<gender> ... ::LISTEND::
#   ::SYNTH::<b64wav>|<b64voice>|<rate>|<b64textfile>[|<pitchHz>]
#               -> ::SYNTHED::<bytes>::<ms> | ::SYNTHERR::<msg>
#   The pitch part is optional: an old-style 4-field command still works and means pitch 0.
#   Pitch is what turns a base voice into an elder/child voice, so it must travel too.
#   ::QUIT::     -> exits

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

try {
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
} catch {
  Write-Output ("::ERROR::" + $_.Exception.Message)
  exit 1
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

function B64Encode([string]$s) {
  return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($s))
}

function B64Decode([string]$s) {
  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voiceList = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)

Write-Output '::READY::'

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim()
  if ($cmd -eq '') { continue }
  if ($cmd -eq '::QUIT::') { break }
  if ($cmd -eq '::PING::') { Write-Output '::PONG::'; continue }

  if ($cmd -eq '::LIST::') {
    foreach ($v in $voiceList) {
      Write-Output ("V|" + (B64Encode $v.DisplayName) + "|" + $v.Language + "|" + $v.Gender)
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

      $picked = $null
      foreach ($v in $voiceList) {
        if ($v.DisplayName -eq $voiceName) { $picked = $v; break }
      }
      if ($null -eq $picked) {
        foreach ($v in $voiceList) {
          if ($v.Language -like 'zh*') { $picked = $v; break }
        }
      }
      if ($null -eq $picked -and $voiceList.Count -gt 0) { $picked = $voiceList[0] }
      if ($null -eq $picked) { throw 'no installed voice' }

      $synth.Voice = $picked
      $escaped = [System.Security.SecurityElement]::Escape($text)
      $rateStr = if ($rate -ge 0) { '+' + $rate + '%' } else { [string]$rate + '%' }
      $prosody = "rate='" + $rateStr + "'"
      if ($pitchHz -ne 0) {
        # Measured on this machine: WinRT does NOT honour a negative Hz offset at all
        # (-50Hz and -25Hz produced byte-identical output, F0 unchanged at 117.7Hz),
        # and positive Hz saturates (+25Hz and +50Hz both gave F0 148.1Hz).
        # So Hz is useless for lowering a voice, which is exactly what an elder needs.
        # The enumerated prosody levels are the only way to actually pitch down.
        if ($pitchHz -le -30) { $pitchVal = 'x-low' }
        elseif ($pitchHz -lt 0) { $pitchVal = 'low' }
        elseif ($pitchHz -ge 30) { $pitchVal = 'x-high' }
        else { $pitchVal = 'high' }
        $prosody = $prosody + " pitch='" + $pitchVal + "'"
      }
      $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + $picked.Language + "'><voice name='" + $picked.Id + "'><prosody " + $prosody + ">" + $escaped + "</prosody></voice></speak>"

      $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
      $size = [int]$stream.Size
      $reader = New-Object Windows.Storage.Streams.DataReader($stream)
      Await ($reader.LoadAsync([uint32]$size)) ([uint32]) | Out-Null
      $bytes = New-Object 'byte[]' $size
      $reader.ReadBytes($bytes)
      [System.IO.File]::WriteAllBytes($wavPath, $bytes)
      $reader.Dispose()
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
