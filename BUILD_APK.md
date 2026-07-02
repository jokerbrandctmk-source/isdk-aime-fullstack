Prerequisites

- Windows machine with Android SDK, Java JDK (11+), Node.js, npm/yarn installed.
- Android Studio or command-line SDK tools available on PATH.
- Connected device or emulator for testing.

Quick build steps (PowerShell):

1. Install node deps:

```powershell
npm install
```

2. Sync Capacitor and Android platform:

```powershell
npx cap sync android
```

3. Build Android debug APK (script included):

```powershell
.\scripts\build-apk-lite.ps1
```

Notes

- The script `scripts/build-apk-lite.ps1` will run `gradlew assembleDebug` and copy the resulting APK to `android\app\build\outputs\apk\debug\ISKD-Anime.apk`.
- If you need a release-signed APK, open `android` in Android Studio and configure signing keys, then build a release variant.
- If CI is preferred, set up a runner with Android SDK and run the above PowerShell commands.
