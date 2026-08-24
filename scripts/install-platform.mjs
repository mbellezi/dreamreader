import path from "node:path"

export const INSTALL_BACKENDS = ["auto", "mlx", "cuda", "vulkan"]

const BACKEND_ALIASES = {
  cu: "cuda",
  cuda: "cuda",
  metal: "mlx",
  mlx: "mlx",
  vk: "vulkan",
  vulkan: "vulkan"
}

export function parseInstallBackend(args, env = process.env) {
  const explicit = valueForArg(args, "--backend") ?? env.DREAMREADER_TTS_BACKEND
  const backend = normalizeInstallBackend(explicit ?? "auto")
  if (!INSTALL_BACKENDS.includes(backend)) {
    throw new Error(`Unsupported backend "${explicit}". Use one of: ${INSTALL_BACKENDS.join(", ")}`)
  }
  return backend
}

export function normalizeInstallBackend(value) {
  const normalized = String(value ?? "auto").trim().toLowerCase()
  if (!normalized || normalized === "auto") {
    return "auto"
  }
  return BACKEND_ALIASES[normalized] ?? normalized
}

export function detectInstallPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") {
    return {
      id: "macos-apple-silicon",
      label: "macOS Apple Silicon",
      os: "macos",
      arch,
      defaultBackend: "mlx",
      supportedBackends: ["mlx"],
      pythonTarget: "aarch64-apple-darwin",
      pythonExecutableRelative: path.join("bin", "python"),
      pythonExecutableCandidates: [path.join("bin", "python"), path.join("bin", "python3")]
    }
  }

  if (platform === "linux" && arch === "x64") {
    return linuxPlatform("x86_64-unknown-linux-gnu", arch)
  }

  if (platform === "linux" && arch === "arm64") {
    return linuxPlatform("aarch64-unknown-linux-gnu", arch)
  }

  if (platform === "win32" && arch === "x64") {
    return windowsPlatform("x86_64-pc-windows-msvc", arch)
  }

  if (platform === "win32" && arch === "arm64") {
    return windowsPlatform("aarch64-pc-windows-msvc", arch)
  }

  throw new Error(`Unsupported DreamReader install platform: ${platform}/${arch}`)
}

export function resolveInstallBackend(requestedBackend, installPlatform = detectInstallPlatform()) {
  const requested = normalizeInstallBackend(requestedBackend)
  const backend = requested === "auto" ? installPlatform.defaultBackend : requested
  if (!installPlatform.supportedBackends.includes(backend)) {
    throw new Error(
      `${installPlatform.label} supports ${installPlatform.supportedBackends.join(" or ")} for this installer, not ${backend}.`
    )
  }
  return backend
}

export function pythonExecutablePath(localRoot, installPlatform = detectInstallPlatform()) {
  return path.join(localRoot, "python", installPlatform.pythonExecutableRelative)
}

export function pythonExecutableCandidates(localRoot, installPlatform = detectInstallPlatform()) {
  return installPlatform.pythonExecutableCandidates.map((relativePath) => path.join(localRoot, "python", relativePath))
}

export function modelFolderName(baseName, backend) {
  if (backend === "mlx") {
    return baseName.endsWith("-mlx") ? baseName : `${baseName}-mlx`
  }
  return baseName.replace(/-mlx$/, `-${backend}`)
}

export function backendRuntimeEnvironment(backend) {
  if (backend === "mlx") {
    return {
      DREAMREADER_TTS_BACKEND: "mlx",
      DREAMREADER_TTS_DEVICE: "mps"
    }
  }
  if (backend === "cuda") {
    return {
      DREAMREADER_TTS_BACKEND: "cuda",
      DREAMREADER_TTS_DEVICE: "cuda"
    }
  }
  if (backend === "vulkan") {
    return {
      DREAMREADER_TTS_BACKEND: "vulkan",
      DREAMREADER_TTS_DEVICE: "vulkan"
    }
  }
  return {}
}

export function pipInstallPlanForBackend(backend, projectRoot) {
  const sidecarRoot = path.join(projectRoot, "sidecars", "tts")
  const f5BaseRequirements = path.join(sidecarRoot, "requirements-f5-tts-ptbr-base.txt")
  const f5Requirements = path.join(sidecarRoot, "requirements-f5-tts-ptbr.txt")
  const steps = [
    {
      label: "huggingface_hub",
      args: ["-m", "pip", "install", "huggingface_hub[hf_xet]"]
    }
  ]

  if (backend === "mlx") {
    return [
      ...steps,
      {
        label: "Qwen3-TTS MLX sidecar",
        args: ["-m", "pip", "install", "-r", path.join(sidecarRoot, "requirements-qwen3-tts-mlx.txt")]
      },
      {
        label: "Chatterbox MLX sidecar",
        args: ["-m", "pip", "install", "-r", path.join(sidecarRoot, "requirements-chatterbox-mlx.txt")]
      },
      {
        label: "MOSS-TTS-v1.5 MLX sidecar",
        args: ["-m", "pip", "install", "-r", path.join(sidecarRoot, "requirements-moss-tts-mlx.txt")]
      },
      {
        label: "F5-TTS PyTorch/MPS sidecar",
        args: ["-m", "pip", "install", "-r", f5Requirements]
      }
    ]
  }

  if (backend === "cuda") {
    return [
      ...steps,
      {
        label: "PyTorch CUDA",
        args: [
          "-m",
          "pip",
          "install",
          "torch",
          "torchaudio",
          "--index-url",
          process.env.DREAMREADER_TORCH_CUDA_INDEX_URL || "https://download.pytorch.org/whl/cu128"
        ]
      },
      {
        label: "F5-TTS CUDA sidecar",
        args: ["-m", "pip", "install", "-r", f5BaseRequirements]
      }
    ]
  }

  return [
    ...steps,
    {
      label: "PyTorch Vulkan-capable runtime",
      args: ["-m", "pip", "install", "torch", "torchaudio"]
    },
    {
      label: "F5-TTS Vulkan sidecar",
      args: ["-m", "pip", "install", "-r", f5BaseRequirements]
    }
  ]
}

function valueForArg(args, name) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`))
  if (prefixed) {
    return prefixed.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function linuxPlatform(pythonTarget, arch) {
  return {
    id: `linux-${arch}`,
    label: "Linux",
    os: "linux",
    arch,
    defaultBackend: "cuda",
    supportedBackends: ["cuda", "vulkan"],
    pythonTarget,
    pythonExecutableRelative: path.join("bin", "python"),
    pythonExecutableCandidates: [path.join("bin", "python"), path.join("bin", "python3")]
  }
}

function windowsPlatform(pythonTarget, arch) {
  return {
    id: `windows-${arch}`,
    label: "Windows",
    os: "windows",
    arch,
    defaultBackend: "cuda",
    supportedBackends: ["cuda", "vulkan"],
    pythonTarget,
    pythonExecutableRelative: "python.exe",
    pythonExecutableCandidates: ["python.exe"]
  }
}
