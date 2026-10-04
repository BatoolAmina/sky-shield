"""Cross-language contract tests (run: python -m unittest discover -s ml/tests -v  with PYTHONPATH=ml/src)."""
import json, subprocess, shutil, tempfile, unittest
from pathlib import Path
import numpy as np, pandas as pd
from skyshield_ml.common import ROOT, SeedBootstrap
from skyshield_ml.scorer import components, rule_score
from skyshield_ml.train import export_hgb
from skyshield_ml import models as M

NODE = shutil.which("node")
FEATURES = json.loads((ROOT / "data/v1/manifest.json").read_text())["feature_names"] if (ROOT / "data/v1/manifest.json").exists() else None


@unittest.skipIf(NODE is None or FEATURES is None, "needs node and data/v1")
class Contracts(unittest.TestCase):
    def test_python_and_js_threat_scorers_agree(self):
        df = pd.read_csv(ROOT / "data/v1/test.csv", nrows=3000); df = df[df.label.isin(json.loads((ROOT / "data/v1/manifest.json").read_text())["classes"])].head(40)
        p = np.random.default_rng(0).random(len(df)); py = rule_score(components(df.reset_index(drop=True), p)).values
        js_in = {"names": FEATURES, "rows": df[FEATURES].values.tolist(), "p": p.tolist()}
        script = "import {threatScore} from './packages/sim-core/src/threat.js'; import {readFileSync} from 'node:fs'; const d=JSON.parse(readFileSync(0,'utf8')); console.log(JSON.stringify(d.rows.map((r,i)=>threatScore(r,d.names,d.p[i]).score)))"
        out = subprocess.run([NODE, "--input-type=module", "-e", script], input=json.dumps(js_in), capture_output=True, text=True, cwd=ROOT); self.assertEqual(out.returncode, 0, out.stderr)
        js = np.array(json.loads(out.stdout)); self.assertLess(np.abs(js - py).max(), 1e-9)

    def test_exported_tree_model_matches_sklearn_in_js(self):
        rng = np.random.default_rng(1); X = pd.DataFrame(rng.normal(size=(1500, 6)), columns=[f"f{i}" for i in range(6)]); y = ((X.f0 + X.f1 > 0).astype(int) + (X.f2 > 1)).values
        m = M.make_hgb({"max_leaf_nodes": 7}, 0, 12).fit(X, y)
        with tempfile.TemporaryDirectory() as d:
            mj = Path(d) / "m.json"; export_hgb(m, list(X.columns), ["a", "b", "c"], 1.0, 0.5, {}, mj)
            Xp = X.head(100); (Path(d) / "p.json").write_text(json.dumps({"X": Xp.values.tolist(), "raw": m.decision_function(Xp).tolist()}))
            r = subprocess.run([NODE, str(ROOT / "scripts/parity_check.js"), str(mj), str(Path(d) / "p.json"), str(Path(d) / "o.json")], capture_output=True, text=True, cwd=ROOT); self.assertEqual(r.returncode, 0, r.stderr)
            res = json.loads((Path(d) / "o.json").read_text()); self.assertLess(res["max_abs_raw_error_vs_sklearn"], 1e-6); self.assertEqual(res["argmax_agreement"], 1.0)

    def test_seed_bootstrap_resamples_whole_scenarios(self):
        seeds = np.repeat(np.arange(20), 7); sb = SeedBootstrap(seeds, n_boot=50); idx = sb.idx(sb.draws[0]); counts = np.bincount(seeds[idx], minlength=20)
        self.assertTrue(set(counts % 7) == {0}, "every resampled scenario must be included whole")

    def test_splits_are_disjoint_by_seed(self):
        man = json.loads((ROOT / "data/v1/manifest.json").read_text())["split_seeds"]; names = list(man)
        for i, a in enumerate(names):
            for b in names[i + 1:]: self.assertFalse(set(man[a]) & set(man[b]), f"{a} overlaps {b}")


if __name__ == "__main__":
    unittest.main()
