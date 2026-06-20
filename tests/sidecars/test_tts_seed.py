import importlib.util
from pathlib import Path
import unittest


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
        cls.f5 = load_sidecar("f5_tts_ptbr_sidecar", "sidecars/tts/f5_tts_ptbr_sidecar.py")

    def test_qwen_prefers_fixed_request_seed(self):
        seed = self.qwen.qwen_seed({"seed": 9876, "voiceProfile": {"id": "voice-a"}}, {"seed": 1234}, "Ryan", "prompt")

        self.assertEqual(seed, 9876)

    def test_qwen_maps_generation_languages(self):
        self.assertEqual(self.qwen.language_name("fr"), "French")
        self.assertEqual(self.qwen.language_name("de-DE"), "German")
        self.assertEqual(self.qwen.language_name("ja"), "Japanese")
        self.assertEqual(self.qwen.language_name("zh-CN"), "Chinese")

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

    def test_f5_infer_uses_resolved_seed(self):
        source = (ROOT / "sidecars/tts/f5_tts_ptbr_sidecar.py").read_text(encoding="utf-8")

        self.assertIn("seed = f5_seed(request)", source)
        self.assertIn("seed=seed", source)


if __name__ == "__main__":
    unittest.main()
