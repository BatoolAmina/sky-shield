"""OPTIONAL real-data module: RF drone detection / identification on the public DroneRF dataset (Mendeley Data, doi:10.17632/f4c2b4n755.1).

DroneRF file naming (as described by the dataset authors): <BUI><L|H>_<segment>.csv, e.g. 10000L_0.csv
  BUI digit 1: 0 = no drone (background RF), 1 = drone;  digits 2-3: 00 Bebop, 01 AR, 10 Phantom;  digits 4-5: flight mode.
  L and H are the two halves of the captured band; a segment has both files. We concatenate their features.
ALWAYS verify the naming against your own download. Splits are made by SEGMENT (never by chunk) to avoid leakage between overlapping windows.

Usage:  python -m skyshield_ml.rf_module --root /path/to/DroneRF --out results/rf_real [--max-samples 2000000] [--win 65536]
        python -m skyshield_ml.rf_module --selftest      # code smoke test on SYNTHETIC stand-in files (NOT a result)
"""
from __future__ import annotations
import argparse, re, tempfile, warnings
from pathlib import Path
import numpy as np, pandas as pd
from scipy.signal import welch
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from .common import ROOT, save_json, savefig, style, plt

warnings.filterwarnings("ignore")
NAME = re.compile(r"^(\d{5})([LH])_(\d+)\.csv$"); TYPE = {"00": "bebop", "01": "ar", "10": "phantom"}


def parse_name(fn):
    m = NAME.match(fn)
    if not m: return None
    bui, band, seg = m.groups(); label = "background" if bui[0] == "0" else TYPE.get(bui[1:3], "unknown_drone")
    return {"bui": bui, "band": band, "segment": int(seg), "is_drone": int(bui[0] == "1"), "label": label, "mode": bui[3:5]}


def spectral_features(x, fs=40e6, nbands=24):
    x = np.asarray(x, float); x = x - x.mean(); f, p = welch(x, fs=fs, nperseg=min(4096, len(x))); p = p + 1e-20; pn = p / p.sum()
    edges = np.linspace(0, len(f), nbands + 1).astype(int); band = [np.log10(p[a:b].sum()) for a, b in zip(edges[:-1], edges[1:])]
    centroid = (f * pn).sum() / fs; flat = np.exp(np.log(p).mean()) / p.mean(); ent = -(pn * np.log(pn)).sum() / np.log(len(pn))
    return band + [centroid, flat, ent, x.std(), np.mean(np.abs(x)), ((x[:-1] * x[1:]) < 0).mean()]


def load_segments(root, max_samples=2_000_000, win=65536, max_win_per_file=8):
    root = Path(root); files = {}
    for p in root.rglob("*.csv"):
        i = parse_name(p.name)
        if i: files.setdefault((i["bui"], i["segment"]), {})[i["band"]] = (p, i)
    rows = []
    for (bui, seg), d in sorted(files.items()):
        if "L" not in d or "H" not in d: continue
        sig = {b: pd.read_csv(d[b][0], header=None, nrows=max_samples).iloc[:, 0].values for b in "LH"}; n = min(len(sig["L"]), len(sig["H"])) // win
        for k in range(min(n, max_win_per_file)):
            f = spectral_features(sig["L"][k * win:(k + 1) * win]) + spectral_features(sig["H"][k * win:(k + 1) * win]); info = d["L"][1]
            rows.append({"bui": bui, "segment": seg, "gid": f"{bui}_{seg}", "label": info["label"], "is_drone": info["is_drone"], "mode": info["mode"], **{f"f{j}": v for j, v in enumerate(f)}})
    return pd.DataFrame(rows)


def split_by_segment(df, seed=0, frac=(0.6, 0.2, 0.2)):
    """Stratified (by BUI) split of SEGMENTS: windows of one segment never appear in two splits."""
    rng = np.random.default_rng(seed); out = {}
    for bui, g in df.groupby("bui"):
        ids = g.gid.unique(); rng.shuffle(ids); a, b = int(len(ids) * frac[0]), int(len(ids) * (frac[0] + frac[1]))
        for k, part in zip(["train", "val", "test"], [ids[:a], ids[a:b], ids[b:]]):
            for i in part: out[i] = k
    df = df.copy(); df["split"] = df.gid.map(out); return df


def run(root, out, max_samples, win):
    style(); out = Path(out); out.mkdir(parents=True, exist_ok=True); df = split_by_segment(load_segments(root, max_samples, win)); feats = [c for c in df.columns if c.startswith("f")]
    assert not (set(df[df.split == "train"].gid) & set(df[df.split == "test"].gid)), "segment leakage"
    res = {"windows": df.groupby("split").size().to_dict(), "segments": df.groupby("split").gid.nunique().to_dict()}
    for task, col in [("detection (drone vs background)", "is_drone"), ("identification (background/bebop/ar/phantom)", "label")]:
        tr, te = df[df.split == "train"], df[df.split == "test"]
        for name, m in [("random_forest", RandomForestClassifier(300, n_jobs=-1, random_state=0)), ("hgb", HistGradientBoostingClassifier(max_iter=200, random_state=0))]:
            m.fit(tr[feats], tr[col]); p = m.predict(te[feats]); res[f"{task}|{name}"] = {"accuracy": float(accuracy_score(te[col], p)), "macro_f1": float(f1_score(te[col], p, average="macro"))}
            if name == "hgb":
                labs = sorted(df[col].unique(), key=str); cm = confusion_matrix(te[col], p, labels=labs); fig, ax = plt.subplots(figsize=(4.5, 4)); ax.imshow(cm, cmap="Blues"); ax.grid(False); ax.set_xticks(range(len(labs))); ax.set_yticks(range(len(labs))); ax.set_xticklabels(labs, rotation=30); ax.set_yticklabels(labs); ax.set_title(task[:28]); savefig(fig, out / f"confusion_{col}.png")
    save_json(res, out / "metrics.json"); print(res)


def selftest():
    """Writes SYNTHETIC stand-in files named like DroneRF to exercise parsing, feature extraction and the segment split. Output is NOT a result."""
    rng = np.random.default_rng(0)
    with tempfile.TemporaryDirectory() as d:
        for bui in ["00000", "10000", "10100", "11000"]:
            for seg in range(6):
                for band in "LH":
                    t = np.arange(200000) / 40e6; x = rng.normal(0, 1, t.size) + (0 if bui[0] == "0" else 2 * np.sin(2 * np.pi * (1e6 * (1 + int(bui[1:3], 2))) * t))
                    pd.Series(x).to_csv(Path(d) / f"{bui}{band}_{seg}.csv", header=False, index=False)
        assert parse_name("10000L_0.csv")["label"] == "bebop" and parse_name("11000H_3.csv")["label"] == "phantom" and parse_name("00000L_1.csv")["label"] == "background" and parse_name("junk.csv") is None
        df = split_by_segment(load_segments(d, 200000, 32768, 4)); assert df.gid.nunique() == 24 and not (set(df[df.split == "train"].gid) & set(df[df.split == "test"].gid))
        print(f"[rf_module selftest] parsed {df.gid.nunique()} segments / {len(df)} windows, split by segment: {df.groupby('split').gid.nunique().to_dict()}  (synthetic stand-in, code check only)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--root"); ap.add_argument("--out", default=str(ROOT / "results/rf_real")); ap.add_argument("--max-samples", type=int, default=2_000_000); ap.add_argument("--win", type=int, default=65536); ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(); selftest() if a.selftest else run(a.root, a.out, a.max_samples, a.win)
