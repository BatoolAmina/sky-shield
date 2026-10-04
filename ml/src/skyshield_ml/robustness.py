"""Stage 3: robustness sweeps, track-age analysis and ablations (feature groups, tracker type, window length). Models never see these sets in training."""
from __future__ import annotations
import warnings, joblib
import numpy as np, pandas as pd
from scipy.special import softmax
from sklearn.metrics import recall_score
from .common import *
from .train import load_cfg
from . import models as M

warnings.filterwarnings("ignore")
FEATURE_GROUPS = {"fusion": ["rf_frac", "rf_sig", "iff_frac", "eo_drone_frac", "eo_bird_frac", "eo_air_frac", "n_sensor_types", "fusion_conf"], "group": ["group_count", "group_score"], "rcs": ["rcs_mean", "rcs_std"],
                  "geometry": ["radial_rate", "range_to_asset", "cpa_dist", "time_to_cpa", "heading_to_asset_cos"],
                  "kinematics": ["speed_mean", "speed_std", "alt_mean", "alt_std", "vert_rate_abs", "heading_rate_abs", "curvature"]}


def _load_csv(path, C, F):
    df = pd.read_csv(path); df = df[df.label.isin(C)].copy(); df["y"] = df.label.map({c: i for i, c in enumerate(C)}); return df


def _eval(model, df, F, thr=0.5, T=None):
    if T is not None:
        P = softmax(model.decision_function(df[F].astype(np.float64)) / T, axis=1)
    else:
        P = model.predict_proba(df[F].astype(np.float64))
    y = df.y.values; yb = df.threat.values.astype(int)
    return {"macro_f1": macro_f1(y, P.argmax(1)), "accuracy": float((P.argmax(1) == y).mean()), "threat_recall": float(recall_score(yb, threat_of(P) >= thr)), "n": len(df)}


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; fig = out / "figures"; ddir = ROOT / cfg["data_dir"]; D = load_data(ddir); F, C = D["features"], D["classes"]
    S = json.loads((out / "metrics" / "train_summary.json").read_text()); man = D["manifest"]
    mods = {f: joblib.load(out / "models" / f"{f}_s0.joblib") for f in ["logreg", "random_forest", "hgb", "mlp"]}
    # ---------- A. robustness sweeps (test seeds with controlled perturbations) ----------
    rows = []
    for r in man["robustness"]:
        df = _load_csv(ddir / "robustness" / f"{r['name']}.csv", C, F)
        for name, m in mods.items(): rows.append({"sweep": r["sweep"], "level": r["level"], "model": name, **_eval(m, df, F)})
        rows.append({"sweep": r["sweep"], "level": r["level"], "model": "hgb_calibrated@thr", **_eval(mods["hgb"], df, F, S["threat_threshold"], S["temperature"])})
    R = pd.DataFrame(rows); R.to_csv(out / "tables" / "robustness.csv", index=False)
    sweeps = [s for s in ["noise", "clutter", "speed", "radar_outage", "visibility"] if s in set(R.sweep)]
    for metric, fname, title in [("macro_f1", "fig_robustness_macro_f1.png", "Macro-F1"), ("threat_recall", "fig_robustness_threat_recall.png", "Threat recall")]:
        fig_, axs = plt.subplots(1, len(sweeps) + 1, figsize=(4 * (len(sweeps) + 1), 3.6))
        for ax, s in zip(axs, sweeps):
            for name in ["logreg", "random_forest", "hgb", "mlp"]:
                d = R[(R.sweep == s) & (R.model == name)].sort_values("level"); ax.plot(d.level, d[metric], "o-", label=name)
            ax.set_title(f"{title} vs {s}"); ax.set_xlabel({"noise": "noise x", "clutter": "clutter x", "speed": "speed x", "radar_outage": "radar outage fraction", "visibility": "visibility x"}[s])
            if s in ("noise", "clutter"): ax.set_xscale("log")
        axs[0].legend(fontsize=7); off = R[R.sweep.isin(["rf_off", "eo_off"])]; base = R[(R.sweep == "noise") & (R.level == 1)].set_index("model")[metric]
        lab = ["nominal", "RF off", "EO off"]; ax = axs[-1]
        for i, name in enumerate(["logreg", "random_forest", "hgb", "mlp"]):
            v = [base[name]] + [off[(off.sweep == s) & (off.model == name)][metric].iloc[0] for s in ["rf_off", "eo_off"]]; ax.bar(np.arange(3) + i * 0.2, v, 0.2, label=name)
        ax.set_xticks(np.arange(3) + 0.3); ax.set_xticklabels(lab); ax.set_title(f"{title}: sensor loss"); ax.set_ylim(max(0.3, ax.get_ylim()[0]), 1.0); savefig(fig_, fig / fname)
    # ---------- B. performance vs track age (test) ----------
    te = D["test"]; bins = [0, 10, 15, 25, 40, 1e9]; te = te.assign(age_bin=pd.cut(te.track_age, bins)); rows = []
    for b, g in te.groupby("age_bin", observed=True): rows.append({"age_bin": str(b), "n": len(g), **{k: v for k, v in _eval(mods["hgb"], g, F).items() if k != "n"}})
    AG = pd.DataFrame(rows); AG.to_csv(out / "tables" / "performance_by_track_age.csv", index=False)
    fig_, ax = plt.subplots(figsize=(5.5, 3.5)); ax.plot(AG.age_bin, AG.macro_f1, "o-", label="macro-F1"); ax.plot(AG.age_bin, AG.threat_recall, "s-", label="threat recall"); ax.set_xlabel("track age (s)"); ax.set_title("Performance vs track age (primary, test)"); ax.legend(); savefig(fig_, fig / "fig_performance_by_track_age.png")
    # ---------- C. feature-group ablation (retrain primary config on feature subsets) ----------
    Xtr_all, ytr = D["train"], D["train"].y.values; abl = []
    variants = {"all features (primary)": F, **{f"without {g}": [f for f in F if f not in cols] for g, cols in FEATURE_GROUPS.items()}, "radar-only (no fusion group)": [f for f in F if f not in FEATURE_GROUPS["fusion"]],
                "kinematics + geometry only": FEATURE_GROUPS["kinematics"] + FEATURE_GROUPS["geometry"]}
    for name, cols in variants.items():
        m = M.make_hgb(S["params"], 0, S["best_iter"]).fit(Xtr_all[cols].astype(np.float64), ytr)
        for split in ["test", "shifted"]:
            P = m.predict_proba(D[split][cols].astype(np.float64)); y = D[split].y.values
            abl.append({"variant": name, "n_features": len(cols), "split": split, "macro_f1": macro_f1(y, P.argmax(1)), "threat_recall": float(recall_score(D[split].threat.values.astype(int), threat_of(P) >= 0.5))})
    A = pd.DataFrame(abl); A.to_csv(out / "tables" / "ablation_feature_groups.csv", index=False)
    fig_, ax = plt.subplots(1, 2, figsize=(13, 3.8))
    for a, metric in zip(ax, ["macro_f1", "threat_recall"]):
        p = A.pivot(index="variant", columns="split", values=metric).loc[list(variants)[::-1]]; p.plot.barh(ax=a); a.set_title(f"Feature-group ablation: {metric}"); a.set_xlim(max(0.3, p.values.min() - 0.05), 1.0); a.set_ylabel("")
    savefig(fig_, fig / "fig_ablation_feature_groups.png")
    # ---------- D. tracker ablation + window-length ablation (separately generated datasets, SAME scenario seeds) ----------
    gen = []
    for label, d in [("kalman, 15 s window (primary)", ddir), ("alpha-beta tracker, 15 s", ROOT / cfg["data_dir_ab"]), ("kalman, 8 s window", ROOT / (cfg["data_dir"] + "_w8")), ("kalman, 25 s window", ROOT / (cfg["data_dir"] + "_w25"))]:
        if not (d / "manifest.json").exists(): continue
        Dd = load_data(d); m = M.make_hgb(S["params"], 0, S["best_iter"]).fit(Dd["train"][F].astype(np.float64), Dd["train"].y.values)
        for split in ["test", "shifted"]:
            P = m.predict_proba(Dd[split][F].astype(np.float64)); y = Dd[split].y.values
            gen.append({"variant": label, "split": split, "macro_f1": macro_f1(y, P.argmax(1)), "threat_recall": float(recall_score(Dd[split].threat.values.astype(int), threat_of(P) >= 0.5)), "n_test_windows": len(Dd[split])})
    if gen:
        G = pd.DataFrame(gen); G.to_csv(out / "tables" / "ablation_tracker_window.csv", index=False)
        fig_, ax = plt.subplots(figsize=(8, 3.4)); G.pivot(index="variant", columns="split", values="macro_f1").plot.barh(ax=ax); ax.set_title("Tracker type and window-length ablation (macro-F1, primary hyper-parameters)"); ax.set_xlim(0.7, 1.0); ax.set_ylabel(""); savefig(fig_, fig / "fig_ablation_tracker_window.png")
    print("[robustness] done")


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
