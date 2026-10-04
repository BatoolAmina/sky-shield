#!/usr/bin/env python
"""One command, whole project: simulate -> audit -> train -> evaluate -> robustness/ablations -> open-set -> scorer -> XAI -> adversary -> tests -> REPORT.md

    python scripts/run_pipeline.py                 # full run (default config)
    python scripts/run_pipeline.py --quick         # small smoke run (minutes)
    python scripts/run_pipeline.py --skip-datagen  # reuse existing data/
    python scripts/run_pipeline.py --with-gpu      # also run the optional PyTorch sequence model (needs torch)
"""
import argparse, os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or sys.exit("Node.js >= 20 is required (https://nodejs.org)")
ENV = {**os.environ, "PYTHONPATH": str(ROOT / "ml" / "src"), "PYTHONUNBUFFERED": "1"}


def sh(cmd, label):
    t = time.time(); print(f"\n=== {label} ===", flush=True)
    r = subprocess.run(cmd, cwd=ROOT, env=ENV)
    if r.returncode: sys.exit(f"step failed: {label}")
    print(f"--- {label}: {time.time()-t:.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--config", default="ml/configs/default.yaml"); ap.add_argument("--quick", action="store_true"); ap.add_argument("--skip-datagen", action="store_true")
    ap.add_argument("--with-gpu", action="store_true"); ap.add_argument("--seeds", type=int, default=None); a = ap.parse_args()
    seeds = a.seeds or (240 if a.quick else 1200); shifted = 40 if a.quick else 150; cfg = a.config
    py = [sys.executable, "-u", "-m"]; gen = [NODE, "apps/datagen/src/cli.js"]
    if a.quick:
        import yaml; c = yaml.safe_load((ROOT / cfg).read_text()); c.update(out_dir="results/quick", data_dir="data/quick", data_dir_ab="data/quick_ab", tune_trials=4, rf_trees=60, rf_seeds=[0], mlp_seeds=[0], mlp_max_epochs=8, n_boot=100, shap_samples_per_class=40)
        cfg = "ml/configs/_quick.yaml"; (ROOT / cfg).write_text(yaml.safe_dump(c))
    import yaml; C = yaml.safe_load((ROOT / cfg).read_text()); d = C["data_dir"]
    sh([NODE, "--test", "packages/sim-core/test/*.test.js"], "unit tests: simulator, determinism, TreeSHAP vs brute force, sessions")
    if not a.skip_datagen:
        sh(gen + ["--out", d, "--seeds", str(seeds), "--shifted", str(shifted), "--sequences", "--robustness"], f"datagen {d}")
        sh(gen + ["--out", C["data_dir_ab"], "--seeds", str(seeds), "--shifted", str(shifted), "--filter", "ab"], "datagen alpha-beta tracker (ablation)")
        for w in (8, 25): sh(gen + ["--out", f"{d}_w{w}", "--seeds", str(seeds), "--shifted", str(shifted), "--window", str(w)], f"datagen window {w}s (ablation)")
    for m, label in [("audit", "data audit + leakage tests"), ("train", "tune + train + calibrate + export"), ("evaluate", "final evaluation"), ("robustness", "robustness + ablations"), ("openset", "open-set unknown detection"), ("scorer", "threat-priority ranking"), ("xai", "explainability")]:
        sh(py + [f"skyshield_ml.{m}", cfg], label)
    if a.with_gpu: sh(py + ["skyshield_ml.seq_torch", cfg], "GPU sequence model"); sh(py + ["skyshield_ml.evaluate", cfg], "re-evaluate including sequence model")
    out = C["out_dir"]; sh([NODE, "scripts/adversary_eval.js", f"{out}/metrics", "20" if a.quick else "60", "60" if a.quick else "300"], "adversary experiments")
    sh(py + ["skyshield_ml.adversary_plots", cfg], "adversary plots"); sh([NODE, "--test", "apps/server/test/*.test.js"], "server tests (incl. mentor model integration)")
    sh(py + ["skyshield_ml.report", cfg], "REPORT.md"); print(f"\nDone. Open {out}/REPORT.md and the figures in {out}/figures/")


if __name__ == "__main__":
    main()
