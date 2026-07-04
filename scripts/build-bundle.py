#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = PROJECT_ROOT / "dist"


class BuildError(RuntimeError):
    pass


@dataclass(frozen=True)
class Host:
    os: str
    arch: str


@dataclass(frozen=True)
class Target:
    id: str
    os: str
    artifact_ext: str
    readium_key: str


TARGETS = {
    "linux-appimage": Target(
        id="linux-appimage",
        os="linux",
        artifact_ext="AppImage",
        readium_key="linux",
    ),
    "windows-msi": Target(
        id="windows-msi",
        os="windows",
        artifact_ext="msi",
        readium_key="win32",
    ),
    "mac-dmg": Target(
        id="mac-dmg",
        os="macos",
        artifact_ext="dmg",
        readium_key="darwin",
    ),
}

ARCH_TO_NPM_CPU = {
    "x64": "x64",
    "arm64": "arm64",
}

ARCH_TO_READIUM = {
    "x64": "x86_64",
    "arm64": "arm64",
}

RUNTIME_DEPENDENCIES = {
    ("windows", "x64"): [
        "node_modules/ffmpeg-static/ffmpeg.exe",
        "node_modules/@node-llama-cpp/win-x64",
    ],
    ("windows", "arm64"): [
        "node_modules/ffmpeg-static/ffmpeg.exe",
        "node_modules/@node-llama-cpp/win-arm64",
    ],
    ("linux", "x64"): [
        "node_modules/ffmpeg-static/ffmpeg",
        "node_modules/@node-llama-cpp/linux-x64",
    ],
    ("linux", "arm64"): [
        "node_modules/ffmpeg-static/ffmpeg",
        "node_modules/@node-llama-cpp/linux-arm64",
    ],
    ("macos", "x64"): [
        "node_modules/ffmpeg-static/ffmpeg",
        "node_modules/@node-llama-cpp/mac-x64",
    ],
    ("macos", "arm64"): [
        "node_modules/ffmpeg-static/ffmpeg",
        "node_modules/@node-llama-cpp/mac-arm64-metal",
    ],
}

LINUX_IMAGE = "node:25-bookworm"

DOCKER_PLATFORMS = {
    "x64": "linux/amd64",
    "arm64": "linux/arm64",
}

MACOS_INSTALL_COMMANDS = {
    "node": [["brew", "install", "node"]],
    "wine": [["brew", "install", "--cask", "wine-stable"]],
    "docker": [["brew", "install", "--cask", "docker"]],
}

WINDOWS_WINGET_INSTALL_COMMANDS = {
    "node": [["winget", "install", "--id", "OpenJS.NodeJS.LTS", "-e"]],
    "docker": [["winget", "install", "--id", "Docker.DockerDesktop", "-e"]],
}

WINDOWS_CHOCO_INSTALL_COMMANDS = {
    "node": [["choco", "install", "-y", "nodejs-lts"]],
    "docker": [["choco", "install", "-y", "docker-desktop"]],
}

MANUAL_INSTALL_COMMANDS = {
    "linux": {
        "node": [
            "sudo apt-get update && sudo apt-get install -y nodejs npm",
            "or install Node.js LTS from https://nodejs.org/",
        ],
        "wine": [
            "sudo dpkg --add-architecture i386",
            "sudo apt-get update",
            "sudo apt-get install -y wine wine64 wine32",
        ],
        "docker": [
            "sudo apt-get update && sudo apt-get install -y docker.io",
            "sudo systemctl enable --now docker",
            "sudo usermod -aG docker $USER",
        ],
    },
    "macos": {
        "node": ["brew install node"],
        "wine": ["brew install --cask wine-stable"],
        "docker": ["brew install --cask docker", "open -a Docker"],
    },
    "windows": {
        "node": ["winget install --id OpenJS.NodeJS.LTS -e"],
        "docker": ["winget install --id Docker.DockerDesktop -e"],
        "wsl": ["wsl --install -d Ubuntu"],
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build DreamReader desktop bundles with dependency checks."
    )
    parser.add_argument(
        "--target",
        action="append",
        choices=[*TARGETS.keys(), "all"],
        help="Bundle target. May be passed more than once. Defaults to the native host target.",
    )
    parser.add_argument(
        "--arch",
        choices=["x64", "arm64"],
        default=None,
        help="Target architecture. Defaults to x64 for Windows/Linux and host arch for macOS.",
    )
    parser.add_argument(
        "--linux-runner",
        choices=["auto", "native", "wsl", "docker"],
        default="auto",
        help="Runner for linux-appimage when the host is not Linux.",
    )
    parser.add_argument(
        "--no-install-deps",
        action="store_true",
        help="Do not try to install missing system dependencies; print commands and stop.",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Validate system dependencies and stop before npm/build steps.",
    )
    parser.add_argument(
        "--skip-npm-ci",
        action="store_true",
        help="Reuse the existing node_modules tree.",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip npm run build and reuse the existing out/ directory.",
    )
    parser.add_argument(
        "--keep-intermediate",
        action="store_true",
        help="Keep intermediate Windows NSIS artifacts created for Wrapped MSI.",
    )
    parser.add_argument(
        "--signed-mac",
        action="store_true",
        help="Do not disable macOS signing/notarization in electron-builder.",
    )
    parser.add_argument(
        "--inside-linux-container",
        action="store_true",
        help=argparse.SUPPRESS,
    )

    args = parser.parse_args()
    host = detect_host()
    targets = expand_targets(args.target, host)
    arch = args.arch or default_arch(host, targets)
    verify_project_root()

    print("DreamReader bundle builder")
    print(f"Host: {host.os}/{host.arch}")
    print(f"Targets: {', '.join(target.id for target in targets)}")
    print(f"Target arch: {arch}")

    try:
        for target in targets:
            build_or_delegate(target, arch, host, args)
    except BuildError as error:
        print("")
        print(f"Build stopped: {error}", file=sys.stderr)
        return 1

    return 0


def detect_host() -> Host:
    if sys.platform.startswith("linux"):
        host_os = "linux"
    elif sys.platform == "darwin":
        host_os = "macos"
    elif sys.platform in {"win32", "cygwin", "msys"}:
        host_os = "windows"
    else:
        raise BuildError(f"Unsupported host platform: {sys.platform}")

    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        arch = "x64"
    elif machine in {"aarch64", "arm64"}:
        arch = "arm64"
    else:
        raise BuildError(f"Unsupported host architecture: {machine}")
    return Host(os=host_os, arch=arch)


def default_arch(host: Host, targets: list[Target]) -> str:
    if all(target.os == "macos" for target in targets):
        return host.arch
    return "x64"


def expand_targets(values: list[str] | None, host: Host) -> list[Target]:
    if not values:
        if host.os == "linux":
            return [TARGETS["linux-appimage"]]
        if host.os == "windows":
            return [TARGETS["windows-msi"]]
        return [TARGETS["mac-dmg"]]

    if "all" not in values:
        return [TARGETS[value] for value in values]

    result = [TARGETS["linux-appimage"], TARGETS["windows-msi"]]
    if host.os == "macos":
        result.append(TARGETS["mac-dmg"])
    else:
        print("Skipping macOS targets for --target all because macOS bundles require a macOS host.")
    return result


def verify_project_root() -> None:
    package_json = PROJECT_ROOT / "package.json"
    electron_config = PROJECT_ROOT / "electron.vite.config.ts"
    if not package_json.exists() or not electron_config.exists():
        raise BuildError(f"Run this script from the DreamReader repository: {PROJECT_ROOT}")


def build_or_delegate(target: Target, arch: str, host: Host, args: argparse.Namespace) -> None:
    if arch not in ARCH_TO_NPM_CPU:
        raise BuildError(f"Unsupported target architecture: {arch}")

    if target.os == "linux" and host.os != "linux" and not args.inside_linux_container:
        delegate_linux_build(target, arch, host, args)
        return

    if target.os == "macos" and host.os != "macos":
        raise BuildError("macOS DMG bundles require a macOS host.")

    print("")
    print(f"==> Building {target.id}")
    env = os.environ.copy()
    ensure_system_dependencies(target, host, args, env)
    if args.check_only:
        print(f"Dependency check passed for {target.id}.")
        return

    ensure_node_workspace(target, arch, host, args, env)
    run_electron_builder(target, arch, host, args, env)
    artifacts = verify_artifacts(target, arch)
    cleanup_intermediate_files(target, arch, args.keep_intermediate)
    print_artifact_summary(artifacts)


def ensure_system_dependencies(
    target: Target,
    host: Host,
    args: argparse.Namespace,
    env: dict[str, str],
) -> None:
    missing = missing_system_dependencies(target, host)
    if missing:
        install_and_recheck(missing, host, args)

    verify_node_commands(host)
    if target_needs_wine(target, host):
        configure_wine_environment(env, host)


def missing_system_dependencies(target: Target, host: Host) -> list[str]:
    missing = []
    if not command_exists(npm_command()) or not command_exists(npx_command()):
        missing.append("node")
    if target_needs_wine(target, host) and find_wine() is None:
        missing.append("wine")
    return sorted(set(missing))


def verify_node_commands(host: Host) -> None:
    if not command_exists(npm_command()):
        raise_dependency_error("node", host)
    if not command_exists(npx_command()):
        raise_dependency_error("node", host)


def target_needs_wine(target: Target, host: Host) -> bool:
    return target.os == "windows" and host.os != "windows"


def configure_wine_environment(env: dict[str, str], host: Host) -> None:
    wine_path = find_wine()
    if wine_path is None:
        raise_dependency_error("wine", host)
    env["PATH"] = f"{str(wine_path.parent)}{os.pathsep}{env.get('PATH', '')}"
    env.setdefault("WINEDEBUG", "-all")
    print(f"Using Wine: {wine_path}")


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def find_wine() -> Path | None:
    found = shutil.which("wine")
    if found:
        return Path(found)
    candidates = [
        Path("/opt/wine-devel/bin/wine"),
        Path("/opt/wine-stable/bin/wine"),
        Path("/usr/local/bin/wine"),
        Path("/usr/bin/wine"),
        Path("/Applications/Wine Stable.app/Contents/Resources/wine/bin/wine"),
        Path("/Applications/Wine Devel.app/Contents/Resources/wine/bin/wine"),
    ]
    return next((candidate for candidate in candidates if candidate.exists()), None)


def install_and_recheck(missing: list[str], host: Host, args: argparse.Namespace) -> None:
    unique = sorted(set(missing))
    if args.no_install_deps:
        for dependency in unique:
            print_manual_install(dependency, host)
        raise BuildError("Missing dependencies. Install them and rerun the script.")

    for dependency in unique:
        print("")
        print(f"Missing dependency: {dependency}")
        installed = try_install_dependency(dependency, host)
        if not installed:
            print_manual_install(dependency, host)
            raise BuildError(f"Could not auto-install {dependency}.")


def try_install_dependency(dependency: str, host: Host) -> bool:
    commands = install_commands(dependency, host)
    if not commands:
        return False
    for command in commands:
        print(f"$ {format_command(command)}")
        result = subprocess.run(command, cwd=PROJECT_ROOT)
        if result.returncode != 0:
            return False
    return True


def install_commands(dependency: str, host: Host) -> list[list[str]]:
    if host.os == "linux":
        return linux_install_commands(dependency)
    if host.os == "macos":
        return macos_install_commands(dependency)
    if host.os == "windows":
        return windows_install_commands(dependency)
    return []


def linux_install_commands(dependency: str) -> list[list[str]]:
    sudo = sudo_prefix()
    if shutil.which("apt-get"):
        return apt_install_commands(dependency, sudo)

    package_manager = first_available_linux_package_manager()
    if package_manager is not None:
        command_prefix, packages = package_manager
        package = packages.get(dependency)
        if package:
            return [sudo + command_prefix + package.split()]

    return []


def apt_install_commands(dependency: str, sudo: list[str]) -> list[list[str]]:
    if dependency == "wine":
        return [
            sudo + ["dpkg", "--add-architecture", "i386"],
            sudo + ["apt-get", "update"],
            sudo + ["apt-get", "install", "-y", "wine", "wine64", "wine32"],
        ]

    packages = {
        "node": "nodejs npm",
        "docker": "docker.io",
    }
    package = packages.get(dependency)
    if not package:
        return []
    return [
        sudo + ["apt-get", "update"],
        sudo + ["apt-get", "install", "-y", *package.split()],
    ]


def first_available_linux_package_manager() -> tuple[list[str], dict[str, str]] | None:
    package_managers = [
        ("dnf", ["dnf", "install", "-y"], {"node": "nodejs", "wine": "wine", "docker": "docker"}),
        ("pacman", ["pacman", "-Sy", "--noconfirm"], {"node": "nodejs npm", "wine": "wine", "docker": "docker"}),
        (
            "zypper",
            ["zypper", "--non-interactive", "install"],
            {"node": "nodejs npm", "wine": "wine", "docker": "docker"},
        ),
    ]
    for executable, command_prefix, packages in package_managers:
        if shutil.which(executable):
            return command_prefix, packages
    return None


def macos_install_commands(dependency: str) -> list[list[str]]:
    if not shutil.which("brew"):
        return []
    return MACOS_INSTALL_COMMANDS.get(dependency, [])


def windows_install_commands(dependency: str) -> list[list[str]]:
    if dependency == "wsl":
        return [["wsl.exe", "--install", "-d", "Ubuntu"]]
    if shutil.which("winget"):
        return WINDOWS_WINGET_INSTALL_COMMANDS.get(dependency, [])
    if shutil.which("choco"):
        return WINDOWS_CHOCO_INSTALL_COMMANDS.get(dependency, [])
    return []


def sudo_prefix() -> list[str]:
    if os.name == "nt":
        return []
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return []
    return ["sudo"]


def print_manual_install(dependency: str, host: Host) -> None:
    print("")
    print(f"Manual install commands for {dependency}:")
    for command in manual_install_commands(dependency, host):
        print(f"  {command}")


def manual_install_commands(dependency: str, host: Host) -> list[str]:
    commands = MANUAL_INSTALL_COMMANDS.get(host.os, {}).get(dependency)
    if commands:
        return commands
    return [f"Install {dependency} using your platform package manager."]


def raise_dependency_error(dependency: str, host: Host) -> NoReturn:
    print_manual_install(dependency, host)
    raise BuildError(f"Dependency is still missing after install attempt: {dependency}")


def delegate_linux_build(target: Target, arch: str, host: Host, args: argparse.Namespace) -> None:
    runner = args.linux_runner
    if runner == "native":
        raise BuildError("linux-appimage cannot be built natively from this host.")

    if host.os == "windows" and runner in {"auto", "wsl"} and wsl_available():
        run_linux_build_in_wsl(target, arch, args)
        return

    if runner == "wsl":
        if not args.no_install_deps:
            try_install_dependency("wsl", host)
        if not wsl_available():
            raise_dependency_error("wsl", host)
        run_linux_build_in_wsl(target, arch, args)
        return

    if runner in {"auto", "docker"}:
        ensure_docker(host, args)
        run_linux_build_in_docker(target, arch, args)
        return

    raise BuildError("No Linux runner is available. Use WSL2 or Docker.")


def wsl_available() -> bool:
    return shutil.which("wsl.exe") is not None and subprocess.run(
        ["wsl.exe", "true"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0


def ensure_docker(host: Host, args: argparse.Namespace) -> None:
    if not shutil.which("docker"):
        if args.no_install_deps:
            print_manual_install("docker", host)
            raise BuildError("Docker is required for this cross-build.")
        if not try_install_dependency("docker", host):
            print_manual_install("docker", host)
            raise BuildError("Could not auto-install Docker.")
    result = subprocess.run(
        ["docker", "info"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        print_manual_install("docker", host)
        raise BuildError("Docker is installed but the daemon is not reachable.")


def run_linux_build_in_wsl(target: Target, arch: str, args: argparse.Namespace) -> None:
    win_root = str(PROJECT_ROOT)
    wsl_path = subprocess.check_output(
        ["wsl.exe", "wslpath", "-a", win_root],
        text=True,
    ).strip()
    command = [
        "cd",
        shlex.quote(wsl_path),
        "&&",
        "python3",
        "scripts/build-bundle.py",
        "--target",
        target.id,
        "--arch",
        arch,
        "--inside-linux-container",
    ]
    append_passthrough_flags(command, args)
    run(["wsl.exe", "bash", "-lc", " ".join(command)])


def run_linux_build_in_docker(target: Target, arch: str, args: argparse.Namespace) -> None:
    docker_platform = DOCKER_PLATFORMS[arch]
    script_command = [
        "python3",
        "scripts/build-bundle.py",
        "--target",
        target.id,
        "--arch",
        arch,
        "--inside-linux-container",
    ]
    append_passthrough_flags(script_command, args)
    inner = [
        "apt-get update",
        "apt-get install -y python3 git xz-utils zip",
        format_command(script_command),
    ]
    repo = str(PROJECT_ROOT)
    docker_command = [
        "docker",
        "run",
        "--rm",
        "-t",
        "--platform",
        docker_platform,
        "-v",
        f"{repo}:/workspace",
        "-w",
        "/workspace",
        LINUX_IMAGE,
        "bash",
        "-lc",
        " && ".join(inner),
    ]
    run(docker_command)


def append_passthrough_flags(command: list[str], args: argparse.Namespace) -> None:
    if args.no_install_deps:
        command.append("--no-install-deps")
    if args.check_only:
        command.append("--check-only")
    if args.skip_npm_ci:
        command.append("--skip-npm-ci")
    if args.skip_build:
        command.append("--skip-build")
    if args.keep_intermediate:
        command.append("--keep-intermediate")


def ensure_node_workspace(
    target: Target,
    arch: str,
    host: Host,
    args: argparse.Namespace,
    env: dict[str, str],
) -> None:
    if not args.skip_npm_ci:
        run([npm_command(), "ci"], env=env)

    run([npm_command(), "run", "download:readium-cli", "--", "--all"], env=env)
    verify_readium(target, arch)

    if not args.skip_build:
        run([npm_command(), "run", "build"], env=env)
    elif not (PROJECT_ROOT / "out" / "main" / "index.js").exists():
        raise BuildError("--skip-build was used, but out/main/index.js does not exist.")

    prepare_target_runtime_dependencies(target, arch, host, env)


def prepare_target_runtime_dependencies(
    target: Target,
    arch: str,
    host: Host,
    env: dict[str, str],
) -> None:
    npm_os = npm_os_for_target(target)
    npm_cpu = ARCH_TO_NPM_CPU[arch]
    target_env = env.copy()
    target_env["npm_config_platform"] = npm_os
    target_env["npm_config_arch"] = npm_cpu
    if target.os != host.os or target.os == "windows" or arch != host.arch:
        run(
            [
                npm_command(),
                "install",
                "--include=optional",
                f"--os={npm_os}",
                f"--cpu={npm_cpu}",
                "--package-lock=false",
                "--no-save",
            ],
            env=target_env,
        )
        run([npm_command(), "rebuild", "ffmpeg-static"], env=target_env)
    verify_runtime_dependencies(target, arch)


def verify_readium(target: Target, arch: str) -> None:
    readium_arch = ARCH_TO_READIUM[arch]
    executable = "readium.exe" if target.os == "windows" else "readium"
    path = PROJECT_ROOT / "vendor" / "readium" / f"{target.readium_key}-{readium_arch}" / executable
    if not path.exists():
        raise BuildError(f"Readium CLI for {target.os}/{arch} is missing: {path}")


def verify_runtime_dependencies(target: Target, arch: str) -> None:
    required = runtime_dependency_paths(target, arch)
    missing = [path for path in required if not (PROJECT_ROOT / path).exists()]
    if missing:
        lines = "\n".join(f"  - {path}" for path in missing)
        raise BuildError(f"Target runtime dependencies are missing:\n{lines}")


def runtime_dependency_paths(target: Target, arch: str) -> list[str]:
    return RUNTIME_DEPENDENCIES.get((target.os, arch), [])


def npm_os_for_target(target: Target) -> str:
    if target.os == "windows":
        return "win32"
    if target.os == "macos":
        return "darwin"
    return "linux"


def run_electron_builder(
    target: Target,
    arch: str,
    host: Host,
    args: argparse.Namespace,
    env: dict[str, str],
) -> None:
    if target.id == "windows-msi":
        with windows_msi_config() as config_path:
            run([npx_command(), "electron-builder", "--win", f"--{arch}", "--config", str(config_path)], env=env)
        return

    if target.os == "linux":
        run([npx_command(), "electron-builder", "--linux", "AppImage", f"--{arch}"], env=env)
        return

    if target.os == "macos":
        mac_args = [npx_command(), "electron-builder", "--mac", target.artifact_ext, f"--{arch}"]
        if not args.signed_mac:
            mac_args.extend(["-c.mac.identity=-", "-c.mac.notarize=false", "-c.dmg.sign=false"])
        run(mac_args, env=env)
        return

    raise BuildError(f"Unsupported target: {target.id}")


class windows_msi_config:
    def __init__(self) -> None:
        self.path = DIST_DIR / ".dreamreader-electron-builder-windows-msi.json"

    def __enter__(self) -> Path:
        DIST_DIR.mkdir(exist_ok=True)
        package = load_package_json()
        base_config = copy.deepcopy(package.get("build", {}))
        base_config["compression"] = "store"
        win_config = copy.deepcopy(base_config.get("win", {}))
        win_config["target"] = ["nsis", "msiWrapped"]
        win_config["signAndEditExecutable"] = False
        base_config["win"] = win_config
        wrapped = copy.deepcopy(base_config.get("msiWrapped", {}))
        wrapped["wrappedInstallerArgs"] = "/S"
        base_config["msiWrapped"] = wrapped
        msi = copy.deepcopy(base_config.get("msi", {}))
        msi["additionalLightArgs"] = ["-ct", "1"]
        base_config["msi"] = msi
        self.path.write_text(json.dumps(base_config, indent=2) + "\n", encoding="utf-8")
        return self.path

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


def cleanup_intermediate_files(target: Target, arch: str, keep: bool) -> None:
    if keep or target.id != "windows-msi":
        return
    package = load_package_json()
    product = package["productName"]
    version = package["version"]
    for candidate in [
        DIST_DIR / f"{product}-{version}-win-{arch}.exe",
        DIST_DIR / f"{product}-{version}-win-{arch}.exe.blockmap",
        DIST_DIR / "latest.yml",
    ]:
        if candidate.exists():
            candidate.unlink()


def verify_artifacts(target: Target, arch: str) -> list[Path]:
    package = load_package_json()
    product = package["productName"]
    version = package["version"]

    if target.id == "linux-appimage":
        pattern = f"{product}-{version}-linux-*.AppImage"
    elif target.id == "windows-msi":
        pattern = f"{product}-{version}-win-{arch}.msi"
    elif target.id == "mac-dmg":
        pattern = f"{product}-{version}-mac-*.dmg"
    else:
        raise BuildError(f"No artifact pattern for target {target.id}")

    artifacts = sorted(DIST_DIR.glob(pattern))
    if not artifacts:
        raise BuildError(f"No artifact produced for {target.id}; expected dist/{pattern}")
    return artifacts


def print_artifact_summary(artifacts: list[Path]) -> None:
    print("")
    print("Artifacts:")
    for artifact in artifacts:
        size = artifact.stat().st_size
        print(f"  {artifact.relative_to(PROJECT_ROOT)}")
        print(f"    size: {format_bytes(size)}")
        print(f"    sha256: {sha256(artifact)}")
        file_command = shutil.which("file")
        if file_command:
            result = subprocess.run(
                [file_command, str(artifact)],
                text=True,
                capture_output=True,
            )
            if result.returncode == 0:
                print(f"    type: {result.stdout.strip()}")


def load_package_json() -> dict:
    return json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def format_bytes(size: int) -> str:
    value = float(size)
    for unit in ["B", "KB", "MB", "GB"]:
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_command() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def run(command: list[str], env: dict[str, str] | None = None) -> None:
    print("")
    print(f"$ {format_command(command)}")
    result = subprocess.run(command, cwd=PROJECT_ROOT, env=env)
    if result.returncode != 0:
        raise BuildError(f"Command failed with exit code {result.returncode}: {format_command(command)}")


def format_command(command: list[str]) -> str:
    return " ".join(shlex.quote(str(part)) for part in command)


if __name__ == "__main__":
    raise SystemExit(main())
