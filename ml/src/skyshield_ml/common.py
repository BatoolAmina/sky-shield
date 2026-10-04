"""Shared helpers: paths, data loading (seed-wise splits), metrics, bootstrap by scenario seed, plotting style."""
from __future__ import annotations
import json, time
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import f1_score, precision_recall_fscore_support, log_loss

ROOT = Path(__file__).resolve().parents[3]
CAT = ["rf_sig"]
META = ["split", "seed", "t", "track", "label", "threat", "purity", "oracle", "true_range", "true_tti"]


def load_manifest(data_dir):
    return json.loads((Path(data_dir) / "manifest.json").read_text())


def load_data(data_dir):
    """Returns dict of DataFrames (only windows whose dominant truth is one of the 7 classes) + meta."""
    d = Path(data_dir); m = load_manifest(d); C = m["classes"]; idx = {c: i for i, c in enumerate(C)}
    out = {"manifest": m, "features": m["feature_names"], "classes": C, "dropped": {}}
    for name in ["train", "val", "test", "shifted"]:
        f = d / f"{name}.csv"
        if not f.exists():
            continue
        df = pd.read_csv(f); df["row_id"] = np.arange(len(df))          # row_id aligns with the raw sequence file
        out["dropped"][name] = df.label.value_counts().to_dict()
        df = df[df.label.isin(C)].copy(); df["y"] = df.label.map(idx).astype(int)
        out[name] = df.reset_index(drop=True)
    if "val" in out:
        out["valA"] = out["val"][out["val"].split == "valA"].reset_index(drop=True)
        out["valB"] = out["val"][out["val"].split == "valB"].reset_index(drop=True)
    return out


def XY(df, features, dtype=np.float64):
    return df[features].astype(dtype), df["y"].values


def threat_of(proba, n_threat=4):
    return proba[:, :n_threat].sum(1)


def macro_f1(y, p):
    return f1_score(y, p, average="macro")


def per_class(y, p, C):
    pr, rc, f1, sup = precision_recall_fscore_support(y, p, labels=range(len(C)), zero_division=0)
    return pd.DataFrame({"class": C, "precision": pr, "recall": rc, "f1": f1, "support": sup})


def ece_score(conf, correct, bins=15):
    edges = np.linspace(0, 1, bins + 1); e = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(e)


def brier_multiclass(y, proba):
    oh = np.eye(proba.shape[1])[y]
    return float(((proba - oh) ** 2).sum(1).mean())


class SeedBootstrap:
    """Cluster bootstrap: resample scenario SEEDS (not rows), because windows of one scenario are correlated."""
    def __init__(self, seeds, n_boot=400, rng=0):
        self.groups = [np.flatnonzero(seeds == s) for s in np.unique(seeds)]
        r = np.random.default_rng(rng); n = len(self.groups)
        self.draws = [r.integers(0, n, n) for _ in range(n_boot)]

    def idx(self, d):
        return np.concatenate([self.groups[i] for i in d])

    def ci(self, fn, alpha=0.05):
        v = np.array([fn(self.idx(d)) for d in self.draws])
        return float(np.quantile(v, alpha / 2)), float(np.quantile(v, 1 - alpha / 2)), v

    def paired_diff(self, fn_a, fn_b):
        """Differences A-B on identical resamples -> (mean, lo, hi, two-sided bootstrap p)."""
        d = np.array([fn_a(self.idx(x)) - fn_b(self.idx(x)) for x in self.draws])
        p = 2 * min((d <= 0).mean(), (d >= 0).mean())
        return float(d.mean()), float(np.quantile(d, 0.025)), float(np.quantile(d, 0.975)), float(min(1.0, p))


def save_json(obj, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))


def style():
    plt.rcParams.update({"figure.dpi": 110, "savefig.dpi": 140, "axes.grid": True, "grid.alpha": 0.25, "axes.spines.top": False, "axes.spines.right": False,
                         "font.size": 9, "axes.titlesize": 10, "legend.fontsize": 8})


def savefig(fig, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


class Timer:
    def __enter__(self): self.t = time.perf_counter(); return self
    def __exit__(self, *a): self.s = time.perf_counter() - self.t


SHORT = {"surveillance_drone": "Surveil.", "fast_drone": "Fast", "low_intruder": "Low-alt", "swarm_member": "Swarm", "bird": "Bird", "friendly_aircraft": "Friendly", "civil_aircraft": "Civil"}
