import re
import unittest
from pathlib import Path

from scripts.story_scale import scale_timeline


ROOT = Path(__file__).resolve().parents[1]


class SampleTimelineTests(unittest.TestCase):
    def test_legacy_sample_timeline_scales_after_becoming_mutable(self):
        source = (ROOT / 'engine' / 'what-if' / 'src' / 'main.js').read_text(encoding='utf-8')
        class MemoryFile:
            def read_text(self, encoding): return source
            def write_text(self, value, encoding): self.value = value
        main_file = MemoryFile()
        scale_timeline(main_file, 30)
        scaled = main_file.value
        timeline = re.search(r'export\s+(?:const|let)\s+TIMELINE\s*=\s*\[([\s\S]*?)\n\];', scaled)
        self.assertIsNotNone(timeline)
        durations = [float(x) for x in re.findall(r'\bdur:\s*([\d.]+)', timeline.group(1))]
        self.assertEqual(len(durations), 9)
        self.assertAlmostEqual(sum(durations), 30, places=3)


if __name__ == '__main__':
    unittest.main()
