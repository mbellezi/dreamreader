#!/usr/bin/env python3
import contextlib
import hashlib
import inspect
import json
import os
import sys
import wave
from pathlib import Path


SCHEMA_VERSION = "dreamreader-tts-sidecar-result/v1"
SUPPORTED_LANG_CODES = {
    "ar",
    "da",
    "de",
    "el",
    "en",
    "es",
    "fi",
    "fr",
    "he",
    "hi",
    "it",
    "ja",
    "ko",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ru",
    "sv",
    "sw",
    "tr",
    "zh",
}
LANGUAGE_ALIASES = {
    "arabic": "ar",
    "chinese": "zh",
    "danish": "da",
    "dutch": "nl",
    "english": "en",
    "finnish": "fi",
    "french": "fr",
    "german": "de",
    "greek": "el",
    "hebrew": "he",
    "hindi": "hi",
    "italian": "it",
    "japanese": "ja",
    "korean": "ko",
    "malay": "ms",
    "norwegian": "no",
    "polish": "pl",
    "portuguese": "pt",
    "russian": "ru",
    "spanish": "es",
    "swahili": "sw",
    "swedish": "sv",
    "turkish": "tr",
}
EMOTION_EXAGGERATION = {
    "neutral": 0.5,
    "warm": 0.56,
    "tense": 0.68,
    "sad": 0.42,
    "joyful": 0.7,
    "angry": 0.82,
    "suspense": 0.72,
    "formal": 0.45,
}


def main() -> int:
    if "--health" in sys.argv:
        return health()

    try:
        request = json.loads(sys.stdin.read())
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
            import soundfile  # noqa: F401

        ok = True
        error = ""
    except Exception as exc:
        ok = False
        error = str(exc)
    sys.stdout.write(json.dumps({"ok": ok, "adapter": "chatterbox-mlx", "error": error}))
    return 0 if ok else 1


def synthesize(request, emit=lambda event: None):
    from mlx_audio.tts.generate import generate_audio
    from mlx_audio.tts.utils import load_model

    output_dir = Path(str(request["outputDirectory"])).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = str(Path(str(request["modelPath"])).resolve())
    loaded_model = load_model(model_path)
    accepted_params = accepted_generate_params(generate_audio)
    reference = resolve_reference(request)
    language = language_code(request)
    settings = combined_settings(request)
    seed = chatterbox_seed(request, settings)

    rendered_segments = []
    for index, segment in enumerate(request["plan"]["segments"]):
        segment_id = str(segment["segmentId"])
        prefix = f"{index:04d}-{safe_name(segment_id)}"
        text = str(segment.get("normalizedText") or segment.get("originalText") or "").strip()
        if not text:
            raise RuntimeError(f"segment {segment_id} has no text")

        controls = prosody_controls(segment, settings)
        kwargs = {
            "model": loaded_model,
            "text": text,
            "output_path": str(output_dir),
            "file_prefix": prefix,
            "audio_format": "wav",
            "join_audio": True,
            "lang_code": language,
            "verbose": False,
        }
        include_supported(kwargs, accepted_params, ["temperature"], controls["temperature"])
        include_supported(kwargs, accepted_params, ["exaggeration"], controls["exaggeration"])
        include_supported(kwargs, accepted_params, ["cfg_weight", "cfg"], controls["cfgWeight"])
        max_tokens = chatterbox_max_tokens(settings)
        if max_tokens is not None:
            include_supported(kwargs, accepted_params, ["max_tokens", "max_new_tokens"], max_tokens)
        if reference:
            kwargs["ref_audio"] = reference["audioPath"]
            if reference.get("text"):
                kwargs["ref_text"] = reference["text"]

        apply_mlx_seed(seed + index)
        generate_audio(**filter_generate_kwargs(kwargs, accepted_params))
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
    chapter_duration_ms = merge_wavs(rendered_segments, request["plan"]["segments"], chapter_path)
    unsupported = unsupported_prosody_fields(request["plan"]["segments"])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "segments": rendered_segments,
        "chapter": {"audioPath": str(chapter_path), "mimeType": "audio/wav", "durationMs": chapter_duration_ms},
        "unsupportedProsodyFields": unsupported,
        "logs": [
            {
                "level": "info",
                "code": "chatterbox_mlx_synthesized",
                "details": {
                    "language": language,
                    "segmentCount": len(rendered_segments),
                    "seed": seed,
                    "usedReference": reference is not None,
                    "unsupportedProsodyFields": unsupported,
                },
            }
        ],
    }


def accepted_generate_params(generate_audio):
    try:
        signature = inspect.signature(generate_audio)
    except Exception:
        return None
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()):
        return None
    return set(signature.parameters.keys())


def include_supported(kwargs, accepted_params, names, value) -> None:
    if accepted_params is None:
        kwargs[names[0]] = value
        return
    for name in names:
        if name in accepted_params:
            kwargs[name] = value
            return


def filter_generate_kwargs(kwargs, accepted_params):
    if accepted_params is None:
        return kwargs
    return {key: value for key, value in kwargs.items() if key in accepted_params}


def resolve_reference(request):
    reference_audio = request.get("referenceAudioPath")
    if not reference_audio or not str(reference_audio).strip():
        return None
    audio_path = Path(str(reference_audio)).resolve()
    if not audio_path.exists():
        raise RuntimeError(f"Chatterbox reference audio not found: {audio_path}")
    reference_text = str(request.get("referenceText") or "").strip()
    return {"audioPath": str(audio_path), "text": reference_text}


def combined_settings(request):
    settings = {}
    voice_binding = request.get("voiceBinding") if isinstance(request.get("voiceBinding"), dict) else {}
    voice_settings = voice_binding.get("settings") if isinstance(voice_binding, dict) else {}
    model_settings = request.get("modelSettings") if isinstance(request.get("modelSettings"), dict) else {}
    if isinstance(voice_settings, dict):
        settings.update(voice_settings)
    if isinstance(model_settings, dict):
        settings.update(model_settings)
    return settings


def prosody_controls(segment, settings):
    prosody = segment.get("prosody") if isinstance(segment, dict) else {}
    if not isinstance(prosody, dict):
        prosody = {}
    base_exaggeration = number_setting(settings, ["exaggeration"], "DREAMREADER_CHATTERBOX_EXAGGERATION", 0.5, 0.0, 1.5)
    intensity = clamp_number(prosody.get("intensity"), 0.0, 1.0, 0.2)
    emotion = str(prosody.get("emotion") or "neutral")
    target_exaggeration = EMOTION_EXAGGERATION.get(emotion, EMOTION_EXAGGERATION["neutral"])
    exaggeration = base_exaggeration + (target_exaggeration - base_exaggeration) * max(0.25, intensity)
    if emotion == "neutral":
        exaggeration += (intensity - 0.2) * 0.12

    cfg_weight = number_setting(settings, ["cfgWeight", "cfg_weight", "cfg", "cfgStrength"], "DREAMREADER_CHATTERBOX_CFG_WEIGHT", 0.5, 0.0, 2.0)
    pace = str(prosody.get("pace") or "normal").lower()
    if pace == "slow":
        cfg_weight -= 0.15
    elif pace == "fast":
        cfg_weight += 0.08
    if exaggeration > 0.65 and intensity > 0.55:
        cfg_weight -= 0.08

    return {
        "cfgWeight": round(max(0.0, min(cfg_weight, 2.0)), 3),
        "exaggeration": round(max(0.0, min(exaggeration, 1.5)), 3),
        "temperature": number_setting(settings, ["temperature"], "DREAMREADER_CHATTERBOX_TEMPERATURE", 0.8, 0.0, 2.0),
    }


def chatterbox_max_tokens(settings):
    configured = first_number(settings, ["maxNewTokens", "maxTokens", "max_tokens"])
    if configured is not None:
        return max(1, min(int(configured), 32768))
    raw = os.environ.get("DREAMREADER_CHATTERBOX_MAX_TOKENS")
    if raw:
        try:
            return max(1, min(int(raw), 32768))
        except ValueError:
            pass
    return None


def chatterbox_seed(request, settings) -> int:
    configured = request.get("seed")
    if isinstance(configured, int):
        return max(0, min(configured, 2**31 - 1))
    configured = settings.get("seed")
    if isinstance(configured, int):
        return max(0, min(configured, 2**31 - 1))
    raw = os.environ.get("DREAMREADER_CHATTERBOX_SEED")
    if raw:
        try:
            return max(0, min(int(raw), 2**31 - 1))
        except ValueError:
            pass
    voice_profile = request.get("voiceProfile") if isinstance(request.get("voiceProfile"), dict) else {}
    basis = "\n".join(
        [
            str(request.get("engineId") or ""),
            str(voice_profile.get("id") or ""),
            str(request.get("referenceAudioPath") or ""),
            str(settings.get("preset") or ""),
        ]
    )
    return int(hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8], 16) % (2**31 - 1)


def apply_mlx_seed(seed: int) -> None:
    try:
        import mlx.core as mx

        mx.random.seed(seed)
    except Exception:
        pass


def language_code(request) -> str:
    candidates = [
        request.get("generationLanguage"),
        request.get("plan", {}).get("source", {}).get("language") if isinstance(request.get("plan"), dict) else None,
        os.environ.get("DREAMREADER_CHATTERBOX_LANG_CODE"),
    ]
    for candidate in candidates:
        code = normalize_language_code(candidate)
        if code:
            return code
    return "pt"


def normalize_language_code(value) -> str | None:
    normalized = str(value or "").strip().lower().replace("_", "-")
    if not normalized or normalized == "auto":
        return None
    if normalized in SUPPORTED_LANG_CODES:
        return normalized
    if normalized.startswith("pt"):
        return "pt"
    if normalized.startswith("zh"):
        return "zh"
    short = normalized.split("-", 1)[0]
    if short in SUPPORTED_LANG_CODES:
        return short
    return LANGUAGE_ALIASES.get(normalized)


def unsupported_prosody_fields(segments) -> list[str]:
    unsupported = set()
    for segment in segments:
        prosody = segment.get("prosody") if isinstance(segment, dict) else {}
        if not isinstance(prosody, dict):
            continue
        if str(prosody.get("pitch") or "neutral") != "neutral":
            unsupported.add("pitch")
        if clamp_number(prosody.get("pauseBeforeMs"), 0, 1500, 0) > 0:
            unsupported.add("pauseBeforeMs")
        if str(prosody.get("instructionPtBr") or "").strip():
            unsupported.add("instructionPtBr")
    return sorted(unsupported)


def find_generated_wav(output_dir: Path, prefix: str) -> Path:
    candidates = sorted(output_dir.glob(f"{prefix}*.wav"))
    if not candidates:
        generated = ", ".join(path.name for path in sorted(output_dir.iterdir())) or "no files"
        raise RuntimeError(f"Chatterbox MLX did not generate a WAV file for {prefix}; output directory contains: {generated}")
    return candidates[0]


def merge_wavs(rendered_segments, plan_segments, target_path: Path) -> int:
    if not rendered_segments:
        raise RuntimeError("No Chatterbox audio segments were generated")
    params = None
    total_frames = 0
    with wave.open(str(target_path), "wb") as target:
        for index, item in enumerate(rendered_segments):
            segment_path = Path(item["audioPath"])
            with wave.open(str(segment_path), "rb") as source:
                current = source.getparams()
                if params is None:
                    params = current
                    target.setnchannels(current.nchannels)
                    target.setsampwidth(current.sampwidth)
                    target.setframerate(current.framerate)
                elif current.nchannels != params.nchannels or current.sampwidth != params.sampwidth or current.framerate != params.framerate:
                    raise RuntimeError("Chatterbox generated incompatible WAV segment parameters")
                data = source.readframes(source.getnframes())
                target.writeframes(data)
                total_frames += source.getnframes()
                if index < len(rendered_segments) - 1:
                    pause_ms = pause_after_ms(plan_segments[index] if index < len(plan_segments) else {})
                    silence_frames = int(current.framerate * (pause_ms / 1000))
                    silence = bytes(current.sampwidth * current.nchannels * silence_frames)
                    target.writeframes(silence)
                    total_frames += silence_frames
    return int(total_frames / params.framerate * 1000)


def pause_after_ms(segment) -> int:
    prosody = segment.get("prosody") if isinstance(segment, dict) else {}
    if not isinstance(prosody, dict):
        return 150
    return int(clamp_number(prosody.get("pauseAfterMs"), 0, 1500, 150))


def wav_duration_ms(wav_path: Path) -> int:
    with wave.open(str(wav_path), "rb") as source:
        frames = source.getnframes()
        if frames <= 0:
            raise RuntimeError(f"Chatterbox generated empty audio: {wav_path}")
        return int(frames / source.getframerate() * 1000)


def number_setting(settings, names, env_name: str, default: float, minimum: float, maximum: float) -> float:
    configured = first_number(settings, names)
    if configured is not None:
        return max(minimum, min(float(configured), maximum))
    raw = os.environ.get(env_name)
    if raw:
        try:
            return max(minimum, min(float(raw), maximum))
        except ValueError:
            pass
    return default


def first_number(settings, names):
    for name in names:
        value = settings.get(name)
        if isinstance(value, (float, int)):
            return value
    return None


def clamp_number(value, minimum: float, maximum: float, fallback: float) -> float:
    if isinstance(value, (float, int)):
        return max(minimum, min(float(value), maximum))
    return fallback


def safe_name(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in value)
    return safe[:64] or "segment"


if __name__ == "__main__":
    raise SystemExit(main())
