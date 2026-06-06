#!/usr/bin/env python3
import contextlib
import json
import os
import sys
import wave
from pathlib import Path


SCHEMA_VERSION = "dreamreader-tts-sidecar-result/v1"
F5_REFERENCE_MAX_MS = 12_000
F5_REFERENCE_MIN_MS = 1_500
F5_REFERENCE_MAX_TEXT_BYTES_PER_SECOND = 45


def main() -> int:
    if "--health" in sys.argv:
        return health()

    try:
        request = json.loads(sys.stdin.read())
        with contextlib.redirect_stdout(sys.stderr):
            result = synthesize(request)
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


def health() -> int:
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import f5_tts  # noqa: F401
            import soundfile  # noqa: F401

        ok = True
        error = ""
    except Exception as exc:
        ok = False
        error = str(exc)
    sys.stdout.write(json.dumps({"ok": ok, "adapter": "f5-tts-pt-br", "error": error}))
    return 0 if ok else 1


def synthesize(request):
    from f5_tts.api import F5TTS

    install_soundfile_torchaudio_loader()

    output_dir = Path(str(request["outputDirectory"])).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = Path(str(request["modelPath"])).resolve()
    checkpoint = find_checkpoint(model_path)
    vocab_file = find_optional_file(model_path, ["vocab.txt"])
    vocoder_path = find_vocoder_dir(model_path)
    reference = resolve_reference(request, model_path)
    device = os.environ.get("DREAMREADER_TTS_DEVICE", default_device())

    f5tts = F5TTS(
        model=os.environ.get("DREAMREADER_F5_MODEL", "F5TTS_Base"),
        ckpt_file=str(checkpoint),
        vocab_file=str(vocab_file) if vocab_file else "",
        vocoder_local_path=str(vocoder_path) if vocoder_path else None,
        device=device,
        hf_cache_dir=os.environ.get("HF_HOME"),
    )
    reference = prepare_reference(reference, output_dir, int(getattr(f5tts, "target_sample_rate", 24000)))

    rendered_segments = []
    for index, segment in enumerate(request["plan"]["segments"]):
        segment_id = str(segment["segmentId"])
        target_path = output_dir / f"{index:04d}-{safe_name(segment_id)}.wav"
        text = normalize_f5_text(str(segment.get("normalizedText") or segment.get("originalText") or ""))
        if not text:
            raise RuntimeError(f"segment {segment_id} has no text")
        f5tts.infer(
            ref_file=str(reference["audioPath"]),
            ref_text=reference["text"],
            gen_text=text,
            file_wave=str(target_path),
            file_spec=None,
            progress=None,
            show_info=lambda *_args, **_kwargs: None,
            remove_silence=False,
            seed=None,
            speed=f5_speed(),
        )
        duration_ms = wav_duration_ms(target_path)
        rendered_segments.append(
            {
                "segmentId": segment_id,
                "segmentIndex": index,
                "audioPath": str(target_path),
                "mimeType": "audio/wav",
                "durationMs": duration_ms,
            }
        )

    chapter_path = output_dir / "chapter.wav"
    chapter_duration_ms = merge_wavs([Path(item["audioPath"]) for item in rendered_segments], chapter_path)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "segments": rendered_segments,
        "chapter": {"audioPath": str(chapter_path), "mimeType": "audio/wav", "durationMs": chapter_duration_ms},
        "logs": [
            {
                "level": "info",
                "code": "f5_tts_ptbr_synthesized",
                "details": {
                    "device": device,
                    "referenceDurationMs": reference["durationMs"],
                    "referenceEffectiveDurationMs": reference["effectiveDurationMs"],
                    "referenceOriginalSampleRate": reference["originalSampleRate"],
                    "referenceTextBytesPerSecond": reference["textBytesPerSecond"],
                    "referenceWasTrimmed": reference["wasTrimmed"],
                    "segmentCount": len(rendered_segments),
                    "targetSampleRate": reference["targetSampleRate"],
                },
            }
        ],
    }


def resolve_reference(request, model_path: Path):
    requested_audio = request.get("referenceAudioPath")
    requested_text = request.get("referenceText")
    if requested_audio:
        if not str(requested_text or "").strip():
            raise RuntimeError("F5-TTS-pt-br requires a transcript that matches the selected reference audio")
        return {"audioPath": Path(str(requested_audio)).resolve(), "text": normalize_reference_text(str(requested_text))}

    reference_audio = find_reference_audio(model_path)
    reference_text = read_first_existing(model_path, ["reference.txt", "ref_text.txt"])
    if not reference_audio:
        raise RuntimeError("F5-TTS-pt-br requires a reference audio file from the selected voice or model folder")
    if not reference_text:
        raise RuntimeError("F5-TTS-pt-br requires reference text/transcript for the reference audio")
    return {"audioPath": Path(str(reference_audio)).resolve(), "text": normalize_reference_text(str(reference_text))}


def prepare_reference(reference, output_dir: Path, target_sample_rate: int):
    from pydub import AudioSegment

    source = AudioSegment.from_file(reference["audioPath"])
    if len(source) <= 0:
        raise RuntimeError(f"F5-TTS reference audio is empty: {reference['audioPath']}")

    normalized = source.set_channels(1).set_frame_rate(target_sample_rate).set_sample_width(2)
    effective = normalized[:F5_REFERENCE_MAX_MS]
    effective = effective.strip_silence(silence_len=100, silence_thresh=-42, padding=50)
    if len(effective) < F5_REFERENCE_MIN_MS:
        raise RuntimeError(
            "F5-TTS reference audio is too short after trimming silence. "
            "Use a clear spoken sample between 5 and 12 seconds."
        )
    target_path = output_dir / "reference-24khz-mono.wav"
    effective.export(str(target_path), format="wav")

    duration_seconds = max(len(effective) / 1000, 0.001)
    text_bytes_per_second = len(reference["text"].encode("utf-8")) / duration_seconds
    if text_bytes_per_second > F5_REFERENCE_MAX_TEXT_BYTES_PER_SECOND:
        raise RuntimeError(
            "F5-TTS reference transcript appears too long for the usable reference audio. "
            "Use only the exact words spoken in the first 5 to 12 seconds of the sample, "
            "or choose a shorter sample with matching transcript."
        )

    return {
        **reference,
        "audioPath": target_path,
        "durationMs": len(normalized),
        "effectiveDurationMs": len(effective),
        "originalSampleRate": source.frame_rate,
        "targetSampleRate": target_sample_rate,
        "textBytesPerSecond": round(text_bytes_per_second, 2),
        "wasTrimmed": len(normalized) != len(effective),
    }


def normalize_reference_text(text: str) -> str:
    return " ".join(text.strip().split())


def install_soundfile_torchaudio_loader():
    import soundfile as sf
    import torch
    from f5_tts.infer import utils_infer

    def load_with_soundfile(audio_path):
        data, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
        if data.size == 0:
            raise RuntimeError(f"Reference audio is empty: {audio_path}")
        return torch.from_numpy(data.T).contiguous(), sample_rate

    utils_infer.torchaudio.load = load_with_soundfile


def find_checkpoint(model_path: Path) -> Path:
    if model_path.is_file() and model_path.suffix == ".safetensors":
        return model_path
    candidates = [
        model_path / "model_last.safetensors",
        model_path / "model.safetensors",
        model_path / "pt-br" / "model_last.safetensors",
        model_path / "pt-br" / "model.safetensors",
        model_path / "ckpts" / "pt-br" / "model_last.safetensors",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    safetensors = sorted(model_path.rglob("*.safetensors"))
    if safetensors:
        return safetensors[0]
    raise RuntimeError(f"F5-TTS checkpoint not found under {model_path}")


def find_reference_audio(model_path: Path) -> str | None:
    names = ["reference.wav", "ref_audio.wav", "reference.mp3", "ref_audio.mp3", "sample.wav", "sample.mp3"]
    for name in names:
        candidate = model_path / name
        if candidate.exists():
            return str(candidate)
    return None


def find_optional_file(model_path: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = model_path / name
        if candidate.exists():
            return candidate
    return None


def find_optional_dir(model_path: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = model_path / name
        if candidate.is_dir():
            return candidate
    return None


def find_vocoder_dir(model_path: Path) -> Path | None:
    names = ["vocos", "vocoder", "vocos-mel-24khz"]
    return find_optional_dir(model_path, names) or find_optional_dir(model_path.parent, names)


def read_first_existing(model_path: Path, names: list[str]) -> str | None:
    for name in names:
        candidate = model_path / name
        if candidate.exists():
            return candidate.read_text(encoding="utf-8").strip()
    return None


def default_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def normalize_f5_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def f5_speed() -> float:
    raw = os.environ.get("DREAMREADER_F5_SPEED", "1.0")
    try:
        return max(0.3, min(float(raw), 2.0))
    except ValueError:
        return 1.0


def merge_wavs(segment_paths: list[Path], target_path: Path) -> int:
    if not segment_paths:
        raise RuntimeError("No F5-TTS audio segments were generated")
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
                    raise RuntimeError("F5-TTS generated incompatible WAV segment parameters")
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
            raise RuntimeError(f"F5-TTS generated empty audio: {wav_path}")
        return int(frames / source.getframerate() * 1000)


def safe_name(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "-_." else "_" for character in value)
    return safe[:64] or "segment"


if __name__ == "__main__":
    raise SystemExit(main())
