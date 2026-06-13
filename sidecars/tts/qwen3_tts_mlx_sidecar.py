#!/usr/bin/env python3
import contextlib
import hashlib
import json
import os
import sys
import wave
from pathlib import Path


SCHEMA_VERSION = "dreamreader-tts-sidecar-result/v1"
MAX_GENERATION_SEED = 4_294_967_295


def main() -> int:
    if "--health" in sys.argv:
        return health()

    try:
        request = json.loads(sys.stdin.read())
        # Library noise must stay off stdout; events/results stream as NDJSON
        # lines on the real stdout so the app sees fragments one by one.
        real_stdout = sys.stdout

        def emit(event):
            real_stdout.write(json.dumps(event) + "\n")
            real_stdout.flush()

        with contextlib.redirect_stdout(sys.stderr):
            result = synthesize(request, emit)
        emit({"type": "result", **result})
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


def health() -> int:
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import mlx_audio  # noqa: F401

        ok = True
        error = ""
    except Exception as exc:
        ok = False
        error = str(exc)
    sys.stdout.write(json.dumps({"ok": ok, "adapter": "qwen3-tts-mlx", "error": error}))
    return 0 if ok else 1


def synthesize(request, emit=lambda event: None):
    from mlx_audio.tts.generate import generate_audio
    from mlx_audio.tts.utils import load_model

    output_dir = Path(str(request["outputDirectory"])).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = str(Path(str(request["modelPath"])).resolve())
    loaded_model = load_model(model_path)
    reference = resolve_reference(request)
    voice_binding = request.get("voiceBinding") or {}
    voice_settings = voice_binding.get("settings") if isinstance(voice_binding, dict) else {}
    if not isinstance(voice_settings, dict):
        voice_settings = {}
    engine_id = str(request.get("engineId") or "")
    speaker = qwen_speaker(voice_settings)
    voice_design_prompt = qwen_voice_design_prompt(voice_settings)
    model_type = qwen_model_type(loaded_model, model_path)
    if qwen_requires_reference(engine_id, model_type) and not reference:
        raise RuntimeError(
            "Qwen3-TTS Base requires a cloned voice with reference audio and matching transcript. "
            "Create/select a cloned voice for this engine before generating audio."
        )
    language = language_name(request["plan"].get("source", {}).get("language"))
    temperature = qwen_temperature(voice_settings)
    seed = qwen_seed(request, voice_settings, speaker, voice_design_prompt)

    rendered_segments = []
    for index, segment in enumerate(request["plan"]["segments"]):
        segment_id = str(segment["segmentId"])
        prefix = f"{index:04d}-{safe_name(segment_id)}"
        text = str(segment.get("normalizedText") or segment.get("originalText") or "").strip()
        if not text:
            raise RuntimeError(f"segment {segment_id} has no text")
        kwargs = {
            "model": loaded_model,
            "text": text,
            "output_path": str(output_dir),
            "file_prefix": prefix,
            "audio_format": "wav",
            "join_audio": True,
            "max_tokens": qwen_max_tokens(text, voice_settings),
            "temperature": temperature,
            "top_k": qwen_top_k(voice_settings),
            "top_p": qwen_top_p(voice_settings),
            "verbose": False,
        }
        if model_type == "voice_design":
            kwargs.update({"lang_code": language})
        elif reference:
            kwargs.update({"ref_audio": reference["audioPath"], "ref_text": reference["text"], "lang_code": language})
        else:
            kwargs.update({"voice": speaker, "lang_code": language})
        instruct = qwen_instruction(segment, model_type, voice_design_prompt)
        if instruct:
            kwargs["instruct"] = instruct
        apply_qwen_seed(seed)
        generate_audio(**kwargs)
        audio_path = find_generated_wav(output_dir, prefix)
        duration_ms = wav_duration_ms(audio_path)
        segment_payload = {
            "segmentId": segment_id,
            "segmentIndex": index,
            "audioPath": str(audio_path),
            "mimeType": "audio/wav",
            "durationMs": duration_ms,
        }
        rendered_segments.append(segment_payload)
        emit({"type": "segment", **segment_payload})

    chapter_path = output_dir / "chapter.wav"
    chapter_duration_ms = merge_wavs([Path(item["audioPath"]) for item in rendered_segments], chapter_path)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "segments": rendered_segments,
        "chapter": {"audioPath": str(chapter_path), "mimeType": "audio/wav", "durationMs": chapter_duration_ms},
        "logs": [
            {
                "level": "info",
                "code": "qwen3_tts_mlx_synthesized",
                "details": {
                    "language": language,
                    "modelType": model_type,
                    "segmentCount": len(rendered_segments),
                    "seed": seed,
                    "speaker": speaker,
                    "temperature": temperature,
                    "usedReference": reference is not None,
                },
            }
        ],
    }


def resolve_reference(request):
    reference_audio = request.get("referenceAudioPath")
    reference_text = request.get("referenceText")
    if reference_audio and str(reference_audio).strip() and reference_text and str(reference_text).strip():
        return {"audioPath": str(reference_audio), "text": str(reference_text)}
    return None


def qwen_model_type(loaded_model, model_path: str) -> str:
    model_type = str(getattr(getattr(loaded_model, "config", None), "tts_model_type", "") or "").strip()
    if model_type:
        return model_type
    try:
        config_path = Path(model_path) / "config.json"
        with config_path.open("r", encoding="utf-8") as handle:
            config = json.load(handle)
        configured = str(config.get("tts_model_type") or "").strip()
        if configured:
            return configured
    except Exception:
        pass
    return "base"


def qwen_requires_reference(engine_id: str, model_type: str) -> bool:
    return model_type == "base" or engine_id in {"qwen3-tts-06b-mlx", "qwen3-tts-17b-base-mlx"}


def qwen_instruction(segment, model_type: str, voice_design_prompt: str) -> str:
    if model_type == "voice_design":
        return prosody_instruction(segment, voice_design_prompt)
    if model_type == "custom_voice":
        return prosody_instruction(segment)
    return ""


def find_generated_wav(output_dir: Path, prefix: str) -> Path:
    candidates = sorted(output_dir.glob(f"{prefix}*.wav"))
    if not candidates:
        generated = ", ".join(path.name for path in sorted(output_dir.iterdir())) or "no files"
        raise RuntimeError(f"Qwen3-TTS did not generate a WAV file for {prefix}; output directory contains: {generated}")
    return candidates[0]


def qwen_speaker(settings) -> str:
    speaker = settings.get("speaker")
    if isinstance(speaker, str) and speaker.strip():
        return speaker.strip()
    return os.environ.get("DREAMREADER_QWEN_SPEAKER", "Ryan")


def qwen_voice_design_prompt(settings) -> str:
    prompt = settings.get("voiceDesignPrompt") or settings.get("voiceDescription")
    if isinstance(prompt, str) and prompt.strip():
        return prompt.strip()
    return os.environ.get(
        "DREAMREADER_QWEN_VOICE_DESCRIPTION",
        "A clear neutral audiobook narrator voice with natural pacing, good articulation, and a calm tone.",
    )


def qwen_temperature(settings) -> float:
    configured = settings.get("temperature")
    if isinstance(configured, (float, int)):
        return max(0.0, min(float(configured), 1.5))
    raw = os.environ.get("DREAMREADER_QWEN_TEMPERATURE", "0.7")
    try:
        return max(0.0, min(float(raw), 1.5))
    except ValueError:
        return 0.7


def qwen_top_k(settings) -> int:
    configured = settings.get("topK")
    if isinstance(configured, int):
        return max(0, min(configured, 200))
    raw = os.environ.get("DREAMREADER_QWEN_TOP_K", "50")
    try:
        return max(0, min(int(raw), 200))
    except ValueError:
        return 50


def qwen_top_p(settings) -> float:
    configured = settings.get("topP")
    if isinstance(configured, (float, int)):
        return max(0.0, min(float(configured), 1.0))
    raw = os.environ.get("DREAMREADER_QWEN_TOP_P", "0.9")
    try:
        return max(0.0, min(float(raw), 1.0))
    except ValueError:
        return 0.9


def qwen_max_tokens(text: str, settings) -> int:
    configured = settings.get("maxTokens")
    if isinstance(configured, int):
        return max(32, min(configured, 4096))
    raw = os.environ.get("DREAMREADER_QWEN_MAX_TOKENS")
    if raw:
        try:
            return max(32, min(int(raw), 4096))
        except ValueError:
            pass
    return max(96, min(int(len(text) * 2.2) + 80, 1200))


def qwen_seed(request, settings, speaker: str, voice_design_prompt: str) -> int:
    configured = normalized_generation_seed(request.get("seed"))
    if configured is not None:
        return configured
    configured = settings.get("seed")
    if isinstance(configured, int):
        return normalized_generation_seed(configured) or 0
    raw = os.environ.get("DREAMREADER_QWEN_SEED")
    if raw:
        try:
            return normalized_generation_seed(int(raw)) or 0
        except ValueError:
            pass
    voice_profile = request.get("voiceProfile") if isinstance(request.get("voiceProfile"), dict) else {}
    basis = "\n".join(
        [
            str(request.get("engineId") or ""),
            str(voice_profile.get("id") or ""),
            speaker,
            voice_design_prompt,
            str(request.get("referenceAudioPath") or ""),
        ]
    )
    return int(hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8], 16) % MAX_GENERATION_SEED


def normalized_generation_seed(value):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return max(0, min(value, MAX_GENERATION_SEED))


def apply_qwen_seed(seed: int) -> None:
    try:
        import mlx.core as mx

        mx.random.seed(seed)
    except Exception:
        pass


def prosody_instruction(segment, voice_design_prompt: str = "") -> str:
    prosody = segment.get("prosody") or {}
    parts = [voice_design_prompt.strip()] if voice_design_prompt.strip() else []
    instruction = str(prosody.get("instructionPtBr") or "").strip()
    if instruction:
        parts.append(instruction)
        return " ".join(parts)
    emotion = str(prosody.get("emotion") or "neutral")
    if emotion and emotion != "neutral":
        parts.append(f"Narrar com emoção {emotion}.")
    return " ".join(parts)


def language_name(value) -> str:
    normalized = str(value or "").lower()
    if normalized.startswith("pt-br") or normalized in {"pt_br", "br", "pt"}:
        return os.environ.get("DREAMREADER_QWEN_PTBR_LANG_CODE", "Portuguese")
    if normalized.startswith("pt-pt") or normalized.startswith("pt_pt"):
        return "European Portuguese"
    if normalized.startswith("pt"):
        return "Portuguese"
    if normalized.startswith("en"):
        return "English"
    if normalized.startswith("es"):
        return "Spanish"
    return "Auto"


def merge_wavs(segment_paths: list[Path], target_path: Path) -> int:
    if not segment_paths:
        raise RuntimeError("No Qwen3-TTS audio segments were generated")
    params = None
    total_frames = 0
    silence = b""
    with wave.open(str(target_path), "wb") as target:
        for index, segment_path in enumerate(segment_paths):
            with wave.open(str(segment_path), "rb") as source:
                current = source.getparams()
                if params is None:
                    params = current
                    target.setnchannels(current.nchannels)
                    target.setsampwidth(current.sampwidth)
                    target.setframerate(current.framerate)
                    silence = bytes(current.sampwidth * current.nchannels * int(current.framerate * 0.15))
                elif current.nchannels != params.nchannels or current.sampwidth != params.sampwidth or current.framerate != params.framerate:
                    raise RuntimeError("Qwen3-TTS generated incompatible WAV segment parameters")
                data = source.readframes(source.getnframes())
                target.writeframes(data)
                total_frames += source.getnframes()
                if index < len(segment_paths) - 1:
                    target.writeframes(silence)
                    total_frames += len(silence) // (params.sampwidth * params.nchannels)
    return int(total_frames / params.framerate * 1000)


def wav_duration_ms(wav_path: Path) -> int:
    with wave.open(str(wav_path), "rb") as source:
        frames = source.getnframes()
        if frames <= 0:
            raise RuntimeError(f"Qwen3-TTS generated empty audio: {wav_path}")
        return int(frames / source.getframerate() * 1000)


def safe_name(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in value)
    return safe[:64] or "segment"


if __name__ == "__main__":
    raise SystemExit(main())
