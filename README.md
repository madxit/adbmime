# Adbmime Kotlin Rebuild

A powerful tool to control Android devices via ADB, now completely rebuilt in Kotlin using Compose Multiplatform for Desktop and JavaFX.

## Features

- **Device Management**: Easily connect, list, and disconnect Android devices over IP or USB.
- **Remote Input**: Send taps, swipes, text, and keycodes to connected devices.
- **App Management**: Install, open, hide, unhide, and uninstall applications by package name.
- **Command Replay**: Record and replay a sequence of commands on a single device or across all connected devices with custom delays.
- **Modern UI**: A clean and responsive interface built with JavaFX and styled with CSS.
- **Multi-Platform**: Automated packaging for Windows (MSI, EXE), macOS (DMG), and Linux (DEB).

## Project Structure

This project follows a streamlined single-module structure:

- `composeApp/`: The main application module.
  - `src/desktopMain/kotlin/`: Kotlin source code.
    - `it.adbmime.demo`: UI controllers and application entry points.
    - `it.adbmime.utils`: ADB communication and remote input utilities.
  - `src/desktopMain/resources/`: FXML layouts, CSS stylesheets, and image resources.
- `.github/workflows/package.yml`: CI/CD workflow for automated multi-platform packaging.

## Requirements

- JDK 17 or higher.
- ADB (Android Debug Bridge) installed and available in your system PATH.

## Getting Started

### Running from IntelliJ IDEA

To run the application directly from your IDE:

1. Open the project in IntelliJ IDEA.
2. Locate `it.adbmime.demo.Launcher` class in `composeApp/src/desktopMain/kotlin`.
3. Right-click and select **Run 'Launcher.main()'**.

### Building and Packaging

Use Gradle tasks to build and create native installers:

- **Run locally**: `./gradlew :composeApp:run`
- **Build MSI (Windows)**: `./gradlew :composeApp:packageMsi`
- **Build EXE (Windows)**: `./gradlew :composeApp:packageExe`
- **Build DMG (macOS)**: `./gradlew :composeApp:packageDmg`
- **Build DEB (Linux)**: `./gradlew :composeApp:packageDeb`

Installers will be generated in `composeApp/build/compose/binaries/main-release/`.

## License

This project is licensed under the MIT License.