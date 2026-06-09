import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_ROOT = PROJECT_ROOT / ".dreamreader-local" / "models"

MODELS = {
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


def main() -> int:
    requested = sys.argv[1:] or list(MODELS.keys())
    unknown = [model for model in requested if model not in MODELS]
    if unknown:
        print(f"Unknown model id(s): {', '.join(unknown)}", file=sys.stderr)
        return 1

    token = os.environ.get("HF_TOKEN") or None
    for model_id in requested:
        item = MODELS[model_id]
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
