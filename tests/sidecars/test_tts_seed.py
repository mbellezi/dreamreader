import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load_sidecar(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TtsSidecarSeedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qwen = load_sidecar("qwen3_tts_mlx_sidecar", "sidecars/tts/qwen3_tts_mlx_sidecar.py")
        cls.chatterbox = load_sidecar("chatterbox_mlx_sidecar", "sidecars/tts/chatterbox_mlx_sidecar.py")
        cls.moss = load_sidecar("moss_tts_mlx_sidecar", "sidecars/tts/moss_tts_mlx_sidecar.py")
        cls.f5 = load_sidecar("f5_tts_ptbr_sidecar", "sidecars/tts/f5_tts_ptbr_sidecar.py")

    def test_qwen_prefers_fixed_request_seed(self):
        seed = self.qwen.qwen_seed({"seed": 9876, "voiceProfile": {"id": "voice-a"}}, {"seed": 1234}, "Ryan", "prompt")

        self.assertEqual(seed, 9876)

    def test_qwen_maps_generation_languages(self):
        self.assertEqual(self.qwen.language_name("fr"), "French")
        self.assertEqual(self.qwen.language_name("de-DE"), "German")
        self.assertEqual(self.qwen.language_name("ja"), "Japanese")
        self.assertEqual(self.qwen.language_name("zh-CN"), "Chinese")

    def test_qwen_chunked_decode_patch_is_opt_in(self):
        self.assertFalse(self.qwen.qwen_chunked_decode_patch_enabled({}))
        self.assertFalse(
            self.qwen.qwen_chunked_decode_patch_enabled(
                {"modelSettings": {"qwenChunkedDecodePatchEnabled": False}}
            )
        )
        self.assertTrue(
            self.qwen.qwen_chunked_decode_patch_enabled(
                {"modelSettings": {"qwenChunkedDecodePatchEnabled": True}}
            )
        )

    def test_chatterbox_uses_fixed_request_seed_for_every_segment(self):
        request = {"seed": 9876}
        seed = self.chatterbox.chatterbox_seed(request, {"seed": 1234})

        self.assertEqual(seed, 9876)
        self.assertEqual(self.chatterbox.chatterbox_segment_seed(seed, 0, request), 9876)
        self.assertEqual(self.chatterbox.chatterbox_segment_seed(seed, 8, request), 9876)

    def test_chatterbox_keeps_segment_variation_without_fixed_request_seed(self):
        request = {}
        seed = self.chatterbox.chatterbox_seed(request, {"seed": 1234})

        self.assertEqual(seed, 1234)
        self.assertEqual(self.chatterbox.chatterbox_segment_seed(seed, 0, request), 1234)
        self.assertEqual(self.chatterbox.chatterbox_segment_seed(seed, 8, request), 1242)

    def test_f5_reads_fixed_request_seed(self):
        self.assertEqual(self.f5.f5_seed({"seed": 9876}), 9876)
        self.assertIsNone(self.f5.f5_seed({}))

    def test_moss_prefers_fixed_seed_and_maps_portuguese(self):
        request = {"seed": 9876, "plan": {"source": {"language": "pt-BR"}}}

        self.assertEqual(self.moss.moss_seed(request, {"seed": 1234}), 9876)
        self.assertEqual(self.moss.moss_segment_seed(9876, 4, request), 9876)
        self.assertEqual(self.moss.language_name(request), "Portuguese")

    def test_moss_uses_locator_index_for_stable_batch_and_single_segment_seed(self):
        segment = {"locator": {"locations": {"segmentIndex": 8}}}

        self.assertEqual(self.moss.moss_segment_seed(9876, 8, {}, segment), 9884)
        self.assertEqual(self.moss.moss_segment_seed(9876, 0, {}, segment), 9884)

    def test_moss_obeys_explicit_seed_for_every_segment(self):
        request = {"seed": 9876}
        segment = {"locator": {"locations": {"segmentIndex": 8}}}

        self.assertEqual(self.moss.moss_segment_seed(9876, 0, request, segment), 9876)
        self.assertEqual(self.moss.moss_segment_seed(9876, 8, request, segment), 9876)

    def test_moss_reference_cache_key_changes_with_audio_and_model_config(self):
        import tempfile

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            model = root / "model"
            tokenizer = model / "audio_tokenizer"
            tokenizer.mkdir(parents=True)
            audio = root / "reference.wav"
            audio.write_bytes(b"voice-a")
            (model / "config.json").write_text('{"n_vq": 32}', encoding="utf-8")
            (tokenizer / "config.json").write_text('{"version": 1}', encoding="utf-8")

            first = self.moss.reference_cache_path(str(audio), str(model), 32)
            audio.write_bytes(b"voice-b")
            second = self.moss.reference_cache_path(str(audio), str(model), 32)
            (tokenizer / "config.json").write_text('{"version": 2}', encoding="utf-8")
            third = self.moss.reference_cache_path(str(audio), str(model), 32)

            self.assertEqual(first.parent, model.resolve() / ".reference-code-cache")
            self.assertNotEqual(first.name, second.name)
            self.assertNotEqual(second.name, third.name)

    def test_moss_maps_v15_generation_settings(self):
        kwargs = self.moss.generation_kwargs(
            {"quality": "standard"},
            {
                "doSample": True,
                "maxNewTokens": 5000,
                "repetitionPenalty": 1.1,
                "temperature": 1.6,
                "topK": 30,
                "topP": 0.85,
            },
            {"prosody": {"instructionPtBr": "Narrar com calma."}},
            "Texto de teste.",
            "Portuguese",
        )

        self.assertEqual(kwargs["max_tokens"], 5000)
        self.assertEqual(kwargs["audio_temperature"], 1.6)
        self.assertEqual(kwargs["audio_top_k"], 30)
        self.assertEqual(kwargs["audio_top_p"], 0.85)
        self.assertEqual(kwargs["instruction"], "Narrar com calma.")

    def test_moss_uses_bounded_quality_token_defaults(self):
        self.assertEqual(self.moss.quality_max_tokens("draft"), 320)
        self.assertEqual(self.moss.quality_max_tokens("standard"), 420)
        self.assertEqual(self.moss.quality_max_tokens("high"), 512)

    def test_moss_clears_mlx_cache_and_reports_segment_memory(self):
        calls = []
        fake_core = types.ModuleType("mlx.core")
        fake_core.get_active_memory = lambda: 3 * 1024 * 1024
        fake_core.get_cache_memory = lambda: 0 if calls else 2 * 1024 * 1024
        fake_core.get_peak_memory = lambda: 5 * 1024 * 1024
        fake_core.clear_cache = lambda: calls.append("clear")
        fake_mlx = types.ModuleType("mlx")
        fake_mlx.core = fake_core

        with patch.dict(sys.modules, {"mlx": fake_mlx, "mlx.core": fake_core}):
            snapshot = self.moss.clear_mlx_segment_memory()

        self.assertEqual(calls, ["clear"])
        self.assertEqual(
            snapshot,
            {
                "available": True,
                "activeMemoryMb": 3.0,
                "cacheMemoryBeforeMb": 2.0,
                "cacheMemoryAfterMb": 0.0,
                "peakMemoryMb": 5.0,
            },
        )

    def test_moss_releases_each_generation_result_before_clearing_cache(self):
        source = (ROOT / "sidecars/tts/moss_tts_mlx_sidecar.py").read_text(encoding="utf-8")

        self.assertIn("finally:\n            result = None\n            memory_snapshot = clear_mlx_segment_memory()", source)

    def test_moss_omits_redundant_default_instruction_for_neutral_segments(self):
        kwargs = self.moss.generation_kwargs(
            {"quality": "standard"},
            {},
            {
                "prosody": {
                    "emotion": "neutral",
                    "pace": "normal",
                    "instructionPtBr": "Tom calmo, narração clara, sem exagero.",
                }
            },
            "Jiddu Krishnamurti",
            "Portuguese",
        )

        self.assertNotIn("instruction", kwargs)

    def test_f5_infer_uses_resolved_seed(self):
        source = (ROOT / "sidecars/tts/f5_tts_ptbr_sidecar.py").read_text(encoding="utf-8")

        self.assertIn("seed = f5_seed(request)", source)
        self.assertIn("seed=seed", source)


if __name__ == "__main__":
    unittest.main()
