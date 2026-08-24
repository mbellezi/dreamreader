#!/usr/bin/env python3
import contextlib
import hashlib
import json
import os
import sys
from pathlib import Path


SCHEMA_VERSION = "dreamreader-tts-sidecar-result/v1"
CACHE_SCHEMA_VERSION = "dreamreader-moss-reference-codes/v1"
MAX_GENERATION_SEED = 4_294_967_295
DEFAULT_MLX_CACHE_LIMIT_MB = 512
MEBIBYTE = 1024 * 1024
LANGUAGE_NAMES = {
    "ar": "Arabic",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "en": "English",
    "es": "Spanish",
    "fa": "Persian",
    "fi": "Finnish",
    "fr": "French",
    "he": "Hebrew",
    "hi": "Hindi",
    "hu": "Hungarian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "mk": "Macedonian",
    "ms": "Malay",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "ru": "Russian",
    "sv": "Swedish",
    "sw": "Swahili",
    "th": "Thai",
    "tl": "Tagalog",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "yue": "Cantonese",
    "zh": "Chinese",
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
    sys.stdout.write(json.dumps({"ok": ok, "adapter": "moss-tts-mlx", "error": error}))
    return 0 if ok else 1


def synthesize(request, emit=lambda event: None):
    from mlx_audio.audio_io import write as audio_write
    from mlx_audio.tts import load

    mlx_memory_policy = configure_mlx_memory()
    output_dir = Path(str(request["outputDirectory"])).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = str(Path(str(request["modelPath"])).resolve())
    model = load(model_path, lazy=True)
    settings = combined_settings(request)
    language = language_name(request)
    seed = moss_seed(request, settings)
    reference = resolve_reference(request)
    reference_codes, reference_cache = reference_codes_for(model, reference, model_path)

    rendered_segments = []
    memory_snapshots = []
    for index, segment in enumerate(request["plan"]["segments"]):
        segment_id = str(segment["segmentId"])
        text = str(segment.get("normalizedText") or segment.get("originalText") or "").strip()
        if not text:
            raise RuntimeError(f"segment {segment_id} has no text")

        target_path = output_dir / f"{index:04d}-{safe_name(segment_id)}.wav"
        kwargs = generation_kwargs(request, settings, segment, text, language)
        if reference_codes is not None:
            kwargs["prompt_audio_codes"] = reference_codes
            if reference.get("text"):
                kwargs["ref_text"] = reference["text"]

        result = None
        reset_mlx_peak_memory()
        try:
            apply_mlx_seed(moss_segment_seed(seed, index, request, segment))
            result = next(model.generate(**kwargs))
            audio_write(str(target_path), result.audio, result.sample_rate)
        finally:
            result = None
            memory_snapshot = clear_mlx_segment_memory()
            memory_snapshot["segmentIndex"] = index
            memory_snapshots.append(memory_snapshot)
        duration_ms = wav_duration_ms(target_path)
        segment_payload = {
            "segmentId": segment_id,
            "segmentIndex": index,
            "audioPath": str(target_path),
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
        "chapter": {
            "audioPath": str(chapter_path),
            "mimeType": "audio/wav",
            "durationMs": chapter_duration_ms,
        },
        "unsupportedProsodyFields": unsupported,
        "logs": [
            {
                "level": "info",
                "code": "moss_tts_v15_mlx_synthesized",
                "details": {
                    "language": language,
                    "runtime": "mlx",
                    "seed": seed,
                    "segmentCount": len(rendered_segments),
                    "usedReference": reference is not None,
                    "referenceCache": reference_cache,
                    "mlxMemoryPolicy": mlx_memory_policy,
                    "segmentMemory": memory_snapshots,
                    "unsupportedProsodyFields": unsupported,
                },
            }
        ],
    }


def generation_kwargs(request, settings, segment, text: str, language: str):
    do_sample = boolean_setting(settings.get("doSample"), True)
    temperature = number_setting(settings.get("temperature"), 1.7, 0.0, 2.0)
    kwargs = {
        "text": text,
        "language": language,
        "max_tokens": integer_setting(settings.get("maxNewTokens"), quality_max_tokens(request.get("quality")), 1, 32768),
        "text_temperature": 1.5 if do_sample else 0.0,
        "audio_temperature": temperature if do_sample else 0.0,
        "audio_top_k": integer_setting(settings.get("topK"), 25, 0, 200),
        "audio_top_p": number_setting(settings.get("topP"), 0.8, 0.0, 1.0),
        "audio_repetition_penalty": number_setting(settings.get("repetitionPenalty"), 1.0, 0.0, 3.0),
    }
    instruction = instruction_for_segment(segment)
    if instruction:
        kwargs["instruction"] = instruction
    return kwargs


def configure_mlx_memory():
    try:
        import mlx.core as mx

        cache_limit_mb = integer_setting(
            environment_number("DREAMREADER_MOSS_CACHE_LIMIT_MB"),
            DEFAULT_MLX_CACHE_LIMIT_MB,
            0,
            16384,
        )
        mx.set_cache_limit(cache_limit_mb * MEBIBYTE)
        memory_limit_mb = environment_number("DREAMREADER_MOSS_MEMORY_LIMIT_MB")
        if memory_limit_mb is not None:
            memory_limit_mb = integer_setting(memory_limit_mb, 0, 1024, 262144)
            mx.set_memory_limit(memory_limit_mb * MEBIBYTE)
        return {
            "available": True,
            "cacheLimitMb": cache_limit_mb,
            **({"memoryLimitMb": memory_limit_mb} if memory_limit_mb is not None else {}),
        }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def reset_mlx_peak_memory() -> None:
    try:
        import mlx.core as mx

        mx.reset_peak_memory()
    except Exception:
        pass


def clear_mlx_segment_memory():
    try:
        import mlx.core as mx

        active_memory_mb = bytes_to_mb(mx.get_active_memory())
        cache_memory_before_mb = bytes_to_mb(mx.get_cache_memory())
        peak_memory_mb = bytes_to_mb(mx.get_peak_memory())
        mx.clear_cache()
        return {
            "available": True,
            "activeMemoryMb": active_memory_mb,
            "cacheMemoryBeforeMb": cache_memory_before_mb,
            "cacheMemoryAfterMb": bytes_to_mb(mx.get_cache_memory()),
            "peakMemoryMb": peak_memory_mb,
        }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def bytes_to_mb(value) -> float:
    return round(float(value) / MEBIBYTE, 2)


def environment_number(name: str):
    value = str(os.environ.get(name) or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def instruction_for_segment(segment) -> str:
    prosody = segment.get("prosody") if isinstance(segment, dict) else {}
    if not isinstance(prosody, dict):
        return ""
    instruction = str(prosody.get("instructionPtBr") or "").strip()
    emotion = str(prosody.get("emotion") or "neutral").strip().lower()
    pace = str(prosody.get("pace") or "normal").strip().lower()
    if instruction:
        if emotion == "neutral" and pace == "normal" and instruction.casefold() == "Tom calmo, narração clara, sem exagero.".casefold():
            return ""
        return instruction
    if emotion == "neutral" and pace == "normal":
        return ""
    return f"Narrar com emocao {emotion} e ritmo {pace}, sem exagero."


def combined_settings(request):
    settings = {}
    binding = request.get("voiceBinding") if isinstance(request.get("voiceBinding"), dict) else {}
    binding_settings = binding.get("settings") if isinstance(binding, dict) else {}
    model_settings = request.get("modelSettings") if isinstance(request.get("modelSettings"), dict) else {}
    if isinstance(binding_settings, dict):
        settings.update(binding_settings)
    if isinstance(model_settings, dict):
        settings.update(model_settings)
    return settings


def resolve_reference(request):
    reference_audio = request.get("referenceAudioPath")
    if not reference_audio or not str(reference_audio).strip():
        return None
    audio_path = Path(str(reference_audio)).resolve()
    if not audio_path.exists():
        raise RuntimeError(f"MOSS-TTS reference audio not found: {audio_path}")
    reference_text = str(request.get("referenceText") or "").strip()
    return {"audioPath": str(audio_path), "text": reference_text}


def reference_codes_for(model, reference, model_path: str):
    if reference is None:
        return None, {"enabled": False, "hit": False}
    import mlx.core as mx

    cache_path = reference_cache_path(reference["audioPath"], model_path, model.config.n_vq)
    try:
        if cache_path.exists():
            codes = mx.load(str(cache_path))
            mx.eval(codes)
            return codes, {"enabled": True, "hit": True, "path": str(cache_path)}
    except Exception:
        try:
            cache_path.unlink(missing_ok=True)
        except OSError:
            pass

    codes = model.encode_reference_audio(
        reference["audioPath"],
        num_quantizers=model.config.n_vq,
    )
    mx.eval(codes)
    cached = False
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = cache_path.with_name(f".{cache_path.name}.{os.getpid()}.tmp.npy")
        mx.save(str(temporary_path), codes)
        os.replace(temporary_path, cache_path)
        cached = True
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except (OSError, UnboundLocalError):
            pass
    return codes, {"enabled": cached, "hit": False, **({"path": str(cache_path)} if cached else {})}


def reference_cache_path(reference_audio_path: str, model_path: str, num_quantizers: int) -> Path:
    cache_root_override = str(os.environ.get("DREAMREADER_MOSS_REFERENCE_CACHE") or "").strip()
    cache_root = Path(cache_root_override).expanduser().resolve() if cache_root_override else Path(model_path).resolve() / ".reference-code-cache"
    digest = hashlib.sha256()
    digest.update(CACHE_SCHEMA_VERSION.encode("utf-8"))
    digest.update(str(num_quantizers).encode("ascii"))
    update_hash_from_file(digest, Path(reference_audio_path))
    model_root = Path(model_path).resolve()
    for relative_path in (
        "config.json",
        "audio_tokenizer/config.json",
        "audio_tokenizer/model.safetensors.index.json",
    ):
        candidate = model_root / relative_path
        if candidate.is_file():
            update_hash_from_file(digest, candidate)
    return cache_root / f"{digest.hexdigest()}.npy"


def update_hash_from_file(digest, path: Path) -> None:
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)


def language_name(request) -> str:
    plan = request.get("plan") if isinstance(request.get("plan"), dict) else {}
    source = plan.get("source") if isinstance(plan.get("source"), dict) else {}
    candidates = [request.get("generationLanguage"), source.get("language"), os.environ.get("DREAMREADER_MOSS_LANGUAGE")]
    for candidate in candidates:
        resolved = normalize_language_name(candidate)
        if resolved:
            return resolved
    return "Portuguese"


def normalize_language_name(value) -> str | None:
    normalized = str(value or "").strip()
    if not normalized or normalized.lower() == "auto":
        return None
    for name in LANGUAGE_NAMES.values():
        if normalized.casefold() == name.casefold():
            return name
    code = normalized.lower().replace("_", "-")
    if code.startswith("yue"):
        return "Cantonese"
    return LANGUAGE_NAMES.get(code.split("-", 1)[0])


def moss_seed(request, settings) -> int:
    configured = normalized_generation_seed(request.get("seed"))
    if configured is not None:
        return configured
    configured = normalized_generation_seed(settings.get("seed"))
    if configured is not None:
        return configured
    profile = request.get("voiceProfile") if isinstance(request.get("voiceProfile"), dict) else {}
    basis = "\n".join(
        [
            str(request.get("engineId") or ""),
            str(profile.get("id") or ""),
            str(request.get("referenceAudioPath") or ""),
            str(settings.get("preset") or ""),
        ]
    )
    return int(hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8], 16) % MAX_GENERATION_SEED


def moss_segment_seed(seed: int, segment_index: int, request, segment=None) -> int:
    if normalized_generation_seed(request.get("seed")) is not None:
        return seed
    stable_index = narration_segment_index(segment, segment_index)
    return (seed + stable_index) % (MAX_GENERATION_SEED + 1)


def narration_segment_index(segment, fallback: int) -> int:
    if not isinstance(segment, dict):
        return fallback
    locator = segment.get("locator")
    locations = locator.get("locations") if isinstance(locator, dict) else None
    candidate = locations.get("segmentIndex") if isinstance(locations, dict) else None
    if isinstance(candidate, int) and not isinstance(candidate, bool) and candidate >= 0:
        return candidate
    return fallback


def normalized_generation_seed(value):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return max(0, min(value, MAX_GENERATION_SEED))


def apply_mlx_seed(seed: int) -> None:
    try:
        import mlx.core as mx

        mx.random.seed(seed)
    except Exception:
        pass


def quality_max_tokens(value) -> int:
    if value == "draft":
        return 320
    if value == "high":
        return 512
    return 420


def merge_wavs(rendered_segments, plan_segments, target_path: Path) -> int:
    import numpy as np
    import soundfile as sf

    if not rendered_segments:
        raise RuntimeError("No MOSS-TTS audio segments were generated")

    first_info = sf.info(rendered_segments[0]["audioPath"])
    total_frames = 0
    with sf.SoundFile(
        str(target_path),
        mode="w",
        samplerate=first_info.samplerate,
        channels=first_info.channels,
        format="WAV",
        subtype="PCM_16",
    ) as target:
        for index, item in enumerate(rendered_segments):
            with sf.SoundFile(item["audioPath"], mode="r") as source:
                if source.samplerate != first_info.samplerate or source.channels != first_info.channels:
                    raise RuntimeError("MOSS-TTS generated incompatible WAV segment parameters")
                while True:
                    block = source.read(65536, dtype="float32", always_2d=True)
                    if len(block) == 0:
                        break
                    target.write(block)
                    total_frames += len(block)
            if index < len(rendered_segments) - 1:
                pause_ms = pause_after_ms(plan_segments[index] if index < len(plan_segments) else {})
                silence_frames = int(first_info.samplerate * pause_ms / 1000)
                if silence_frames > 0:
                    target.write(np.zeros((silence_frames, first_info.channels), dtype=np.float32))
                    total_frames += silence_frames
    return max(1, int(total_frames / first_info.samplerate * 1000))


def wav_duration_ms(wav_path: Path) -> int:
    import soundfile as sf

    info = sf.info(str(wav_path))
    return max(1, int(info.frames / info.samplerate * 1000))


def pause_after_ms(segment) -> int:
    prosody = segment.get("prosody") if isinstance(segment, dict) else {}
    if not isinstance(prosody, dict):
        return 150
    return integer_setting(prosody.get("pauseAfterMs"), 150, 0, 1500)


def unsupported_prosody_fields(segments) -> list[str]:
    unsupported = set()
    for segment in segments:
        prosody = segment.get("prosody") if isinstance(segment, dict) else {}
        if not isinstance(prosody, dict):
            continue
        if str(prosody.get("pitch") or "neutral") != "neutral":
            unsupported.add("pitch")
        if integer_setting(prosody.get("pauseBeforeMs"), 0, 0, 1500) > 0:
            unsupported.add("pauseBeforeMs")
    return sorted(unsupported)


def boolean_setting(value, fallback: bool) -> bool:
    return value if isinstance(value, bool) else fallback


def number_setting(value, fallback: float, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    return max(minimum, min(float(value), maximum))


def integer_setting(value, fallback: int, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    return max(minimum, min(int(value), maximum))


def safe_name(value: str) -> str:
    cleaned = "".join(character if character.isalnum() or character in "-_" else "_" for character in value)
    return cleaned[:96] or "segment"


if __name__ == "__main__":
    raise SystemExit(main())
