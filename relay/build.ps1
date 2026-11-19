$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$output = Join-Path $root 'CaseWeave AI Relay.exe'
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 /optimize+ "/out:$output" /r:System.Net.Http.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'RelayHost.cs') (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'CaseWeave relay build failed.' }
