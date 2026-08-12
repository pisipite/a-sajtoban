import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "collect.py"
SPEC = importlib.util.spec_from_file_location("collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_normalized_handles_hungarian_accents(self):
        self.assertEqual(collector.normalized("Közpénz – K-Monitor"), "kozpenz k monitor")

    def test_strip_source_suffix(self):
        self.assertEqual(collector.strip_source_suffix("Egy fontos hír - Telex", "Telex"), "Egy fontos hír")
        self.assertEqual(collector.strip_source_suffix("Itthon: hír - | hvg.hu", "hvg.hu"), "Itthon: hír")

    def test_exact_name_scores_high(self):
        item = {
            "title": "Új jelentést közölt a K-Monitor",
            "description": "Közpénzekről és átláthatóságról",
            "source": "Telex",
        }
        score, reasons, _topic = collector.score_candidate(item, {"telex"}, {})
        self.assertGreaterEqual(score, 60)
        self.assertIn("A név szerepel a címben", reasons)

    def test_old_and_new_reference_column_order(self):
        old_csv = "dátum,cím,forrás,téma,link\n2021-01-01,Cikk,Telex,közpénz,https://example.com/1\n".encode()
        new_csv = "dátum,cím,forrás,link,téma,típus\n2026-01-01,Cikk 2,24.hu,https://example.com/2,kampány,említés\n".encode()
        old = collector.parse_reference_csv(old_csv, "2021")[0]
        new = collector.parse_reference_csv(new_csv, "2026")[0]
        self.assertEqual(old["url"], "https://example.com/1")
        self.assertEqual(old["topic"], "közpénz")
        self.assertEqual(new["article_type"], "említés")

    def test_legacy_hungarian_characters_are_repaired(self):
        self.assertEqual(collector.clean_text("közpénzbõl és népszerû"), "közpénzből és népszerű")

    def test_sentence_context_keeps_the_mention(self):
        text = "Első mondat. A K-Monitor szerint átláthatóbb működés szükséges. Ez a következő mondat."
        context = collector.sentence_context(text)
        self.assertIn("K-Monitor", context)
        self.assertIn("következő", context)


if __name__ == "__main__":
    unittest.main()
