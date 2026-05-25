$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidAssetVideos = Resolve-Path (Join-Path $root "android\app\src\main\assets\public\assets\videos") -ErrorAction SilentlyContinue

Push-Location $root
try {
  npx.cmd cap sync android

  $androidAssetVideos = Resolve-Path (Join-Path $root "android\app\src\main\assets\public\assets\videos") -ErrorAction SilentlyContinue
  if ($androidAssetVideos) {
    $assetRoot = [string]$androidAssetVideos
    if (-not $assetRoot.StartsWith([string]$root)) {
      throw "Refusing to edit assets outside workspace: $assetRoot"
    }

    $heavyVideos = @(
      "A Demon King Fall.mp4",
      "Mushoku Tensei Episode 02 .mp4",
      "Mushoku Tensei Episode 03.mp4",
      "video1.mp4"
    )

    foreach ($name in $heavyVideos) {
      $path = Join-Path $assetRoot $name
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
      }
    }
  }

  Push-Location (Join-Path $root "android")
  try {
    .\gradlew.bat assembleDebug
  } finally {
    Pop-Location
  }

  $apk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
  if (-not (Test-Path -LiteralPath $apk)) {
    $apk = Join-Path $root "android\app\build\outputs\apk\debug\ISKD-Anime-debug.apk"
  }
  $namedApk = Join-Path $root "android\app\build\outputs\apk\debug\ISKD-Anime.apk"
  Copy-Item -LiteralPath $apk -Destination $namedApk -Force
  Get-Item $apk | ForEach-Object {
    "APK ready: $($_.FullName)"
    "Size: {0:N1} MB" -f ($_.Length / 1MB)
  }
  Get-Item $namedApk | ForEach-Object {
    "Named APK: $($_.FullName)"
  }
} finally {
  Pop-Location
}
