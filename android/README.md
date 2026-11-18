# Android release build

Use Node 22.12+ or 24, JDK 21, and the Android SDK (platform 36). Point JAVA_HOME and ANDROID_HOME at those installations, then run from the repository root:

```sh
npm ci
npm run android:bundle
```

The command type-checks, builds the Android flavor, copies the compiled site into the app and runs the pinned Gradle wrapper. The release bundle is at `android/app/build/outputs/bundle/release/app-release.aab`. Re-run the command after changing source, art or notices. Release WebView debugging is disabled. No keystore or signing configuration is included. To sign for Play, first match the package, version code and authorized upload-key certificate to the intended Google Play Console record. Use the owner's approved signing workflow and re-verify and test the resulting bundle.

This project's proposed Android application ID is `io.github.shaunxd.canasta`. The native app serves its embedded assets at the project's existing HTTPS homepage origin. There is no remote start URL. Scripts, card art and font files ship in the bundle. Online play connects directly to `https://canasta-api-production.up.railway.app`. Solo play runs locally. Back on the home screen backgrounds the task. At an active table, Back confirms before leaving. The native window consumes system bar, display cutout and keyboard insets and lets the existing table resize across orientations and folding displays. After Android reclaims the process, the home screen can resume the last online table as long as the server still holds it.
