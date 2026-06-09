import os
import sys
import platform
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_ROOT = PROJECT_ROOT / ".dreamreader-local" / "models"

MLX_MODELS = {
    "qwen3-tts-06b-mlx": {
        "repo_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        "local_dir": MODELS_ROOT / "qwen3-tts-06b-mlx",
    },
    "qwen3-tts-17b-mlx": {
        "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit",
        "local_dir": MODELS_ROOT / "qwen3-tts-17b-mlx",
    },
    "qwen3-tts-17b-base-mlx": {
        "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit",
        "local_dir": MODELS_ROOT / "qwen3-tts-17b-base-mlx",
    },
    "chatterbox-multilingual-mlx": {
        "repo_id": "mlx-community/chatterbox-fp16",
        "local_dir": MODELS_ROOT / "chatterbox-multilingual-mlx",
    },
    "f5-tts-pt-br": {
        "repo_id": "firstpixel/F5-TTS-pt-br",
        "local_dir": MODELS_ROOT / "f5-tts-pt-br",
    },
    "vocos-mel-24khz": {
        "repo_id": "charactr/vocos-mel-24khz",
        "local_dir": MODELS_ROOT / "vocos-mel-24khz",
    },
}

PYTORCH_MODEL_REPOS = {
    "qwen3-tts-06b": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "qwen3-tts-17b": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "qwen3-tts-17b-base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "chatterbox-multilingual": "ResembleAI/chatterbox",
}


def pytorch_models(backend: str) -> dict[str, dict[str, Path | str]]:
    models = {
        f"{model_id}-{backend}": {
            "repo_id": repo_id,
            "local_dir": MODELS_ROOT / f"{model_id}-{backend}",
        }
        for model_id, repo_id in PYTORCH_MODEL_REPOS.items()
    }
    models.update(
        {
            "f5-tts-pt-br": {
                "repo_id": "firstpixel/F5-TTS-pt-br",
                "local_dir": MODELS_ROOT / "f5-tts-pt-br",
            },
            "vocos-mel-24khz": {
                "repo_id": "charactr/vocos-mel-24khz",
                "local_dir": MODELS_ROOT / "vocos-mel-24khz",
            },
        }
    )
    return models


def resolve_backend(requested: str) -> str:
    value = (requested or "auto").lower()
    if value in {"cu", "cuda"}:
        return "cuda"
    if value in {"vk", "vulkan"}:
        return "vulkan"
    if value in {"mlx", "metal"}:
        return "mlx"
    if value != "auto":
        raise ValueError(f"Unsupported backend {requested!r}; use auto, mlx, cuda or vulkan.")

    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "mlx"
    if system in {"linux", "windows"}:
        return "cuda"
    raise ValueError(f"Unsupported platform for backend auto: {platform.system()}/{platform.machine()}")


def models_for_backend(backend: str) -> dict[str, dict[str, Path | str]]:
    if backend == "mlx":
        return MLX_MODELS
    if backend in {"cuda", "vulkan"}:
        return pytorch_models(backend)
    raise ValueError(f"Unsupported backend {backend!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download DreamReader local TTS model snapshots.")
    parser.add_argument("models", nargs="*", help="Model ids to download. Defaults to all models for the selected backend.")
    parser.add_argument("--backend", default=os.environ.get("DREAMREADER_TTS_BACKEND", "auto"), help="auto, mlx, cuda or vulkan")
    parser.add_argument("--list", action="store_true", help="List model ids for the selected backend and exit.")
    args = parser.parse_args()

    try:
        backend = resolve_backend(args.backend)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    models = models_for_backend(backend)
    if args.list:
        print(f"Backend: {backend}")
        for model_id in models:
            print(model_id)
        return 0

    requested = args.models or list(models.keys())
    unknown = [model for model in requested if model not in models]
    if unknown:
        print(f"Unknown model id(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Available for backend {backend}: {', '.join(models)}", file=sys.stderr)
        return 1

    token = os.environ.get("HF_TOKEN") or None
    from huggingface_hub import snapshot_download

    print(f"DreamReader model backend: {backend}")
    for model_id in requested:
        item = models[model_id]
        local_dir = item["local_dir"]
        local_dir.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {item['repo_id']} -> {local_dir.relative_to(PROJECT_ROOT)}")
        snapshot_download(
            repo_id=item["repo_id"],
            local_dir=str(local_dir),
            token=token,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
