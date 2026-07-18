# Cross-platform Bundle Builds

The `scripts/build-bundle.py` script orchestrates DreamReader Electron bundles for Linux, Windows, and macOS.

It validates dependencies before building, attempts to install system dependencies when possible, and stops if a required dependency remains missing. On Linux, it tries to use `sudo` to install packages; if automatic installation fails, it prints the manual commands and does not continue packaging.

## Quick Start

```bash
python3 scripts/build-bundle.py --target linux-appimage
python3 scripts/build-bundle.py --target windows-msi
python3 scripts/build-bundle.py --target mac-dmg
python3 scripts/build-bundle.py --target all
```

Useful options:

```bash
python3 scripts/build-bundle.py --target windows-msi --check-only
python3 scripts/build-bundle.py --target windows-msi --no-install-deps
python3 scripts/build-bundle.py --target windows-msi --keep-intermediate
python3 scripts/build-bundle.py --target linux-appimage --linux-runner docker
python3 scripts/build-bundle.py --target linux-appimage --linux-runner wsl
```

By default, the script runs:

1. system dependency checks/installation;
2. `npm ci`;
3. `npm run download:readium-cli -- --all`;
4. `npm run build`;
5. installation of optional dependencies for the target platform with `npm --os/--cpu`;
6. `electron-builder`;
7. artifact and SHA256 verification.

The `voices/*.zip` packages are included in `resources/voices` for every target. The
`voices/old` directory is not included in the bundle. On first launch of a packaged
application, each missing package is imported silently; on later launches, bootstrap
only reconciles bindings with TTS engines installed since the previous run. When a
compatible engine is installed while the app is open, bindings to every voice with a
sample are also created immediately, without requiring a restart.

Use `--skip-npm-ci` or `--skip-build` only when you are certain that `node_modules/` and `out/` already correspond to the target.

After a cross-build, `node_modules/` may be prepared for the target platform because optional dependencies such as `ffmpeg-static` and `node-llama-cpp` are reinstalled with `npm --os/--cpu`. To return to the development state for the current machine, run `npm ci`.

## Targets

### Linux AppImage

Native Linux command:

```bash
python3 scripts/build-bundle.py --target linux-appimage
```

On Windows or macOS, a Linux build must run inside Linux. The script supports:

- WSL2 on Windows, with `--linux-runner wsl`;
- Docker on Windows/macOS/Linux, with `--linux-runner docker`;
- `--linux-runner auto`, which tries WSL2 on Windows and then Docker.

The Docker runner uses the `node:25-bookworm` image, mounts the repository at `/workspace`, and executes the same script inside the container. It sets the container platform according to `--arch`: `linux/amd64` for `--arch x64` and `linux/arm64` for `--arch arm64`. On Apple Silicon macOS, the default target remains `x64`; Docker then uses amd64 emulation. To generate an ARM64 AppImage, run:

```bash
python3 scripts/build-bundle.py --target linux-appimage --arch arm64 --linux-runner docker
```

### Windows MSI

Command:

```bash
python3 scripts/build-bundle.py --target windows-msi
```

The `windows-msi` target uses Wrapped MSI. This means:

- the published artifact is `dist/DreamReader-<version>-win-x64.msi`;
- the MSI contains an internally generated NSIS installer;
- the internal installer runs silently with `/S`;
- by default, the script removes the intermediate `.exe` and `.blockmap` after the MSI is validated.

Use `--keep-intermediate` to retain these diagnostic files.

On Linux/macOS, `electron-builder` needs Wine to create the Windows installer. The script looks for `wine` on `PATH` and in common locations such as `/opt/wine-devel/bin/wine`. On Linux with `apt`, if Wine is missing, the script tries:

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine wine64 wine32
```

### macOS DMG

Command:

```bash
python3 scripts/build-bundle.py --target mac-dmg
```

macOS bundles require a macOS host. On Apple Silicon, the default `mac-dmg` target is `arm64`. To explicitly request an Apple Silicon DMG:

```bash
python3 scripts/build-bundle.py --target mac-dmg --arch arm64
```

By default, the script disables signing/notarization for local builds (`-c.mac.identity=-`, `-c.mac.notarize=false`). Use `--signed-mac` to leave the `electron-builder` signing configuration active.

macOS ZIP is not exposed by this script. It can be useful for file-based distribution or Electron auto-update, but is not part of the requested workflow.

## Known Limitations

- macOS DMG is not generated outside macOS.
- On Apple Silicon macOS, `mac-dmg` uses `arm64` by default; on other macOS hosts, use `--arch arm64` to request an Apple Silicon DMG.
- Linux AppImage outside Linux requires WSL2 or Docker.
- On Apple Silicon macOS, x64 Linux AppImage through Docker depends on `linux/amd64` emulation; use `--arch arm64` for an ARM64 build.
- Windows MSI outside Windows requires Wine.
- The MSI is a Wrapped MSI, not an MSI with every application file declared directly in WiX tables.
- Docker builds may create or alter `node_modules/`, `out/`, and `dist/` inside the mounted volume. On Linux/macOS, check permissions if Docker runs as root.
