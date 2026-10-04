"""Stage 2: final evaluation on the held-out TEST seeds (and the shifted-distribution set). Reports only what the saved predictions produce."""
from __future__ import annotations
import warnings
import numpy as np, pandas as pd
from scipy.stats import binomtest, spearmanr
from sklearn.calibration import calibration_curve
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, precision_recall_curve, roc_auc_score, roc_curve, precision_score, recall_score, f1_score)
from .common import *
from .train import load_cfg

warnings.filterwarnings("ignore")
PRIMARY = "hgb_s0"


def load_preds(out):
    P = {p.stem: dict(np.load(p)) for p in (out / "preds").glob("*.npz") if p.stem != "hgb_calibrated"}
    return P, dict(np.load(out / "preds" / "hgb_calibrated.npz"))


def threat_metrics(yb, pt, thr):
    pred = pt >= thr
    return {"threat_recall": float(recall_score(yb, pred)), "threat_precision": float(precision_score(yb, pred, zero_division=0)), "threat_f1": float(f1_score(yb, pred)),
            "threat_auc": float(roc_auc_score(yb, pt)), "threat_ap": float(average_precision_score(yb, pt)), "false_alarm_rate": float(((pred) & (yb == 0)).sum() / max(1, (yb == 0).sum()))}


def row_metrics(D, split, P, thr=0.5):
    df = D[split]; y = df.y.values; yb = df.threat.values.astype(int); pred = P.argmax(1)
    conf = P.max(1)
    return {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(macro_f1(y, pred)), "log_loss": float(-np.log(np.clip(P[np.arange(len(y)), y], 1e-12, 1)).mean()),
            "brier": brier_multiclass(y, P), "ece": ece_score(conf, (pred == y).astype(float)), **threat_metrics(yb, threat_of(P), thr)}


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; fig = out / "figures"; D = load_data(ROOT / cfg["data_dir"]); C = D["classes"]
    P, CAL = load_preds(out); S = json.loads((out / "metrics" / "train_summary.json").read_text()); info = S["models"]; thr = S["threat_threshold"]
    sbT = SeedBootstrap(D["test"].seed.values, cfg["n_boot"]); y = D["test"].y.values; yb = D["test"].threat.values.astype(int)
    # ---------- per-model table ----------
    rows = []
    for k in sorted(P):
        for split in ["test", "shifted"]:
            rows.append({"model": k, "family": info[k]["family"], "split": split, **row_metrics(D, split, P[k][split])})
    # primary after calibration (temperature scaling; threshold chosen on valB)
    for variant in ["uncal", "temp", "iso"]:
        for split in ["test", "shifted"]:
            rows.append({"model": f"hgb_{variant}", "family": "hgb_calibration", "split": split, **row_metrics(D, split, CAL[f"{split}_{variant}"], thr if variant != "uncal" else 0.5)})
    M_ = pd.DataFrame(rows); M_.to_csv(out / "tables" / "model_metrics_all.csv", index=False)
    fam = M_[~M_.family.eq("hgb_calibration")].groupby(["family", "split"])[["accuracy", "macro_f1", "threat_recall", "threat_auc", "ece"]].agg(["mean", "std"])
    fam.columns = ["_".join(c) for c in fam.columns]; fam = fam.reset_index(); fam.to_csv(out / "tables" / "model_family_summary.csv", index=False)
    # ---------- bootstrap CIs (seed-cluster) for seed-0 of each family + paired tests vs primary ----------
    fam_keys = {info[k]["family"]: k for k in sorted(P) if info[k]["seed"] == 0}
    ci_rows, paired = [], []
    f1_of = lambda Pm: (lambda idx: macro_f1(y[idx], Pm[idx].argmax(1)))
    rec_of = lambda Pm: (lambda idx: recall_score(yb[idx], threat_of(Pm)[idx] >= 0.5))
    for f, k in fam_keys.items():
        Pm = P[k]["test"]; lo, hi, _ = sbT.ci(f1_of(Pm)); rlo, rhi, _ = sbT.ci(rec_of(Pm))
        ci_rows.append({"family": f, "macro_f1": macro_f1(y, Pm.argmax(1)), "macro_f1_lo": lo, "macro_f1_hi": hi, "threat_recall": recall_score(yb, threat_of(Pm) >= 0.5), "threat_recall_lo": rlo, "threat_recall_hi": rhi})
        if k != PRIMARY:
            d, dlo, dhi, p = sbT.paired_diff(f1_of(P[PRIMARY]["test"]), f1_of(Pm)); a = P[PRIMARY]["test"].argmax(1) == y; b = Pm.argmax(1) == y
            n01, n10 = int((a & ~b).sum()), int((~a & b).sum()); mc = binomtest(n01, n01 + n10, 0.5).pvalue if n01 + n10 else 1.0
            paired.append({"primary": PRIMARY, "other": k, "delta_macro_f1": d, "ci_lo": dlo, "ci_hi": dhi, "bootstrap_p": p, "mcnemar_primary_only_correct": n01, "mcnemar_other_only_correct": n10, "mcnemar_p": mc})
    CI = pd.DataFrame(ci_rows); CI.to_csv(out / "tables" / "model_ci_test.csv", index=False); pd.DataFrame(paired).to_csv(out / "tables" / "paired_tests_vs_primary.csv", index=False)
    # ---------- Fig: model comparison ----------
    order = list(CI.sort_values("macro_f1").family); fig_, ax = plt.subplots(1, 3, figsize=(14, 3.8)); xs = np.arange(len(order)); w = 0.38
    ci = CI.set_index("family").loc[order]; sh = M_[(M_.split == "shifted") & M_.model.isin([fam_keys[f] for f in order])].set_index("family").loc[order]
    ax[0].bar(xs - w / 2, ci.macro_f1, w, yerr=[ci.macro_f1 - ci.macro_f1_lo, ci.macro_f1_hi - ci.macro_f1], label="test (95% CI by seed)", capsize=3); ax[0].bar(xs + w / 2, sh.macro_f1, w, label="shifted")
    ax[0].set_xticks(xs); ax[0].set_xticklabels(order, rotation=20); ax[0].set_ylim(max(0.5, ci.macro_f1.min() - 0.1), 1.0); ax[0].set_title("Macro-F1"); ax[0].legend()
    ax[1].bar(xs - w / 2, ci.threat_recall, w, yerr=[ci.threat_recall - ci.threat_recall_lo, ci.threat_recall_hi - ci.threat_recall], capsize=3); ax[1].bar(xs + w / 2, sh.threat_recall, w)
    ax[1].set_xticks(xs); ax[1].set_xticklabels(order, rotation=20); ax[1].set_ylim(0.8, 1.0); ax[1].set_title("Threat recall @0.5")
    lat = [info[fam_keys[f]]["ms_per_row_batch"] for f in order]; ax[2].bar(xs, lat); ax[2].set_yscale("log"); ax[2].set_xticks(xs); ax[2].set_xticklabels(order, rotation=20); ax[2].set_title("Batch inference latency (ms / window, CPU)")
    savefig(fig_, fig / "fig_model_comparison.png")
    # per-class F1 grouped
    fig_, ax = plt.subplots(figsize=(10, 3.8)); fams = list(fam_keys)
    for i, f in enumerate(fams): ax.bar(np.arange(7) + i * 0.8 / len(fams), per_class(y, P[fam_keys[f]]["test"].argmax(1), C).f1, 0.8 / len(fams), label=f)
    ax.set_xticks(np.arange(7) + 0.4); ax.set_xticklabels([SHORT[c] for c in C]); ax.set_ylim(0.7, 1); ax.set_title("Per-class F1 on test"); ax.legend(ncol=len(fams)); savefig(fig_, fig / "fig_per_class_f1.png")
    per_class(y, P[PRIMARY]["test"].argmax(1), C).to_csv(out / "tables" / "primary_per_class_test.csv", index=False)
    # accuracy vs latency
    fig_, ax = plt.subplots(figsize=(5, 3.8))
    for f in fams: ax.scatter(info[fam_keys[f]]["ms_per_row_batch"], CI.set_index("family").loc[f, "macro_f1"], s=60); ax.annotate(f, (info[fam_keys[f]]["ms_per_row_batch"], CI.set_index("family").loc[f, "macro_f1"]), fontsize=7)
    ax.set_xscale("log"); ax.set_xlabel("ms per window (batch, CPU)"); ax.set_ylabel("macro-F1 (test)"); ax.set_title("Accuracy vs latency"); savefig(fig_, fig / "fig_accuracy_vs_latency.png")
    # ---------- confusion matrices (primary, calibrated argmax identical to raw argmax) ----------
    for split in ["test", "shifted"]:
        yy = D[split].y.values; cm = confusion_matrix(yy, P[PRIMARY][split].argmax(1), labels=range(7)); cmn = cm / cm.sum(1, keepdims=True)
        fig_, ax = plt.subplots(1, 2, figsize=(12, 4.8))
        for a, m, t, fmt in [(ax[0], cm, "counts", "d"), (ax[1], cmn, "row-normalised", ".2f")]:
            a.imshow(m, cmap="Blues"); a.grid(False); a.set_xticks(range(7)); a.set_yticks(range(7)); a.set_xticklabels([SHORT[c] for c in C], rotation=45); a.set_yticklabels([SHORT[c] for c in C]); a.set_xlabel("predicted"); a.set_ylabel("true"); a.set_title(f"{PRIMARY} {split}: {t}")
            for i in range(7):
                for j in range(7): a.text(j, i, format(m[i, j], fmt), ha="center", va="center", fontsize=7, color="white" if m[i, j] > m.max() * 0.6 else "black")
        savefig(fig_, fig / f"fig_confusion_{split}.png"); pd.DataFrame(cm, index=C, columns=C).to_csv(out / "tables" / f"confusion_{split}.csv")
    # binary threat confusion at the chosen threshold
    for split in ["test", "shifted"]:
        ybs = D[split].threat.values.astype(int); pt = threat_of(CAL[f"{split}_temp"]); pred = (pt >= thr).astype(int); cm = confusion_matrix(ybs, pred)
        pd.DataFrame(cm, index=["non-threat", "threat"], columns=["pred non-threat", "pred threat"]).to_csv(out / "tables" / f"confusion_threat_{split}.csv")
    # ---------- ROC / PR (one-vs-rest, primary calibrated) ----------
    Pt = CAL["test_temp"]; fig_, ax = plt.subplots(1, 2, figsize=(11, 4.2)); aucs = {}
    for i, c in enumerate(C):
        yi = (y == i).astype(int); fpr, tpr, _ = roc_curve(yi, Pt[:, i]); aucs[c] = roc_auc_score(yi, Pt[:, i]); ax[0].plot(fpr, tpr, label=f"{SHORT[c]} (AUC {aucs[c]:.3f})")
        pr, rc, _ = precision_recall_curve(yi, Pt[:, i]); ax[1].plot(rc, pr, label=f"{SHORT[c]} (AP {average_precision_score(yi, Pt[:, i]):.3f})")
    ax[0].plot([0, 1], [0, 1], "k:", lw=0.8); ax[0].set_xlabel("FPR"); ax[0].set_ylabel("TPR"); ax[0].set_title("One-vs-rest ROC (test)"); ax[0].legend(loc="lower right"); ax[1].set_xlabel("recall"); ax[1].set_ylabel("precision"); ax[1].set_title("One-vs-rest precision-recall (test)"); ax[1].legend(loc="lower left")
    savefig(fig_, fig / "fig_roc_pr_ovr_primary.png"); save_json({"ovr_auc_test": aucs, "macro_auc": float(np.mean(list(aucs.values())))}, out / "metrics" / "auc_primary.json")
    # binary threat ROC / PR for all families + operating point
    fig_, ax = plt.subplots(1, 2, figsize=(11, 4.2))
    for f in fams:
        pt = threat_of(P[fam_keys[f]]["test"]); fpr, tpr, _ = roc_curve(yb, pt); ax[0].plot(fpr, tpr, label=f"{f} ({roc_auc_score(yb, pt):.4f})"); pr, rc, _ = precision_recall_curve(yb, pt); ax[1].plot(rc, pr, label=f"{f} ({average_precision_score(yb, pt):.4f})")
    ptc = threat_of(Pt); fpr_op = ((ptc >= thr) & (yb == 0)).sum() / (yb == 0).sum(); tpr_op = ((ptc >= thr) & (yb == 1)).sum() / (yb == 1).sum()
    ax[0].scatter([fpr_op], [tpr_op], c="k", zorder=5, label=f"operating pt (thr {thr:.2f})"); ax[0].set_xlim(0, 0.2); ax[0].set_ylim(0.8, 1.0); ax[0].set_title("Binary threat detection ROC (zoomed, test)"); ax[0].set_xlabel("FPR"); ax[0].set_ylabel("TPR"); ax[0].legend(loc="lower right")
    ax[1].set_ylim(0.8, 1.0); ax[1].set_xlim(0.7, 1.0); ax[1].set_title("Binary threat precision-recall (test)"); ax[1].set_xlabel("recall"); ax[1].set_ylabel("precision"); ax[1].legend(loc="lower left"); savefig(fig_, fig / "fig_threat_roc_pr_models.png")
    # cost curve on valB with chosen threshold
    pB = threat_of(CAL["valB_temp"]); ybB = D["valB"].threat.values; g = np.linspace(0.01, 0.99, 99); cost = [S["cost_ratio"] * ((pB < t) & (ybB == 1)).sum() + ((pB >= t) & (ybB == 0)).sum() for t in g]
    fig_, ax = plt.subplots(1, 2, figsize=(10, 3.6)); ax[0].plot(g, cost); ax[0].axvline(thr, c="r", ls="--"); ax[0].set_title(f"Expected cost on valB (miss:false-alarm = {S['cost_ratio']:.0f}:1)"); ax[0].set_xlabel("threat threshold")
    pt_t = threat_of(Pt); rec = [((pt_t >= t) & (yb == 1)).sum() / (yb == 1).sum() for t in g]; fa = [((pt_t >= t) & (yb == 0)).sum() / (yb == 0).sum() for t in g]; ax[1].plot(g, rec, label="threat recall"); ax[1].plot(g, fa, label="false-alarm rate"); ax[1].axvline(thr, c="r", ls="--"); ax[1].legend(); ax[1].set_title("Test operating characteristics vs threshold"); ax[1].set_xlabel("threat threshold"); savefig(fig_, fig / "fig_threat_threshold_cost.png")
    # ---------- calibration ----------
    fig_, ax = plt.subplots(1, 3, figsize=(15, 4.2)); calrows = []
    for v, lab in [("uncal", "uncalibrated"), ("temp", "temperature scaling"), ("iso", "isotonic")]:
        Q = CAL[f"test_{v}"]; conf = Q.max(1); cor = (Q.argmax(1) == y).astype(float); fr, mp = calibration_curve(cor, conf, n_bins=12, strategy="quantile"); ax[0].plot(mp, fr, "o-", label=f"{lab} (ECE {ece_score(conf, cor):.4f})")
        Qs = CAL[f"shifted_{v}"]; cs = Qs.max(1); cors = (Qs.argmax(1) == D['shifted'].y.values).astype(float); fr2, mp2 = calibration_curve(cors, cs, n_bins=12, strategy="quantile"); ax[1].plot(mp2, fr2, "o-", label=f"{lab} (ECE {ece_score(cs, cors):.4f})")
        calrows.append({"variant": v, "ece_test": ece_score(conf, cor), "brier_test": brier_multiclass(y, Q), "logloss_test": float(-np.log(np.clip(Q[np.arange(len(y)), y], 1e-12, 1)).mean()), "ece_shifted": ece_score(cs, cors)})
    for a, t in zip(ax[:2], ["test", "shifted"]): a.plot([0, 1], [0, 1], "k:"); a.set_xlabel("mean predicted confidence"); a.set_ylabel("observed accuracy"); a.set_title(f"Reliability diagram ({t}, top-label)"); a.legend(loc="upper left")
    ax[2].hist(Pt.max(1), bins=30, alpha=.7, label="all"); ax[2].hist(Pt.max(1)[Pt.argmax(1) != y], bins=30, alpha=.8, label="errors"); ax[2].set_yscale("log"); ax[2].set_title("Confidence histogram (calibrated, test)"); ax[2].legend(); savefig(fig_, fig / "fig_calibration.png")
    pd.DataFrame(calrows).to_csv(out / "tables" / "calibration_summary.csv", index=False)
    # ---------- training curves ----------
    lc = pd.read_csv(out / "tables" / "hgb_learning_curve.csv"); th = pd.read_csv(out / "tables" / "tuning_history.csv"); mc = {p.stem: pd.read_csv(p) for p in (out / "tables").glob("mlp_curve_s*.csv")}
    fig_, ax = plt.subplots(1, 3, figsize=(15, 3.8)); ax[0].plot(lc.iteration, lc.train_logloss, label="train (20k subsample)"); ax[0].plot(lc.iteration, lc.valA_logloss, label="validation (valA seeds)"); ax[0].axvline(S["best_iter"], c="r", ls="--", label=f"selected iter {S['best_iter']}"); ax[0].set_title("Gradient-boosted trees: log-loss"); ax[0].set_xlabel("boosting iteration"); ax[0].legend()
    for k, c in mc.items(): ax[1].plot(c.epoch, c.train_loss, c="C0", alpha=.7); ax[1].plot(c.epoch, c.val_loss, c="C1", alpha=.7)
    ax[1].set_title("MLP (256-128-64): train (blue) vs validation (orange) loss, 3 seeds"); ax[1].set_xlabel("epoch")
    ax[2].plot(th.index, th.val_logloss, "o", alpha=.5, label="trial"); ax[2].plot(th.index, th.val_logloss.cummin(), "r-", label="best so far"); ax[2].set_title(f"Hyper-parameter search ({S['engine']})"); ax[2].set_xlabel("trial"); ax[2].set_ylabel("valA log-loss"); ax[2].legend(); savefig(fig_, fig / "fig_training_curves.png")
    imp = {p: spearmanr(th[p], th.val_logloss)[0] for p in ["learning_rate", "max_leaf_nodes", "min_samples_leaf", "l2_regularization", "max_features"]}
    fig_, ax = plt.subplots(figsize=(5, 3.2)); ax.barh(list(imp), list(imp.values())); ax.set_title("Tuning: Spearman(param, val log-loss)"); savefig(fig_, fig / "fig_tuning_param_effects.png")
    summary = {"primary": PRIMARY, "test": row_metrics(D, "test", P[PRIMARY]["test"]), "shifted": row_metrics(D, "shifted", P[PRIMARY]["shifted"]), "calibrated_threshold": thr,
               "calibrated_test": row_metrics(D, "test", CAL["test_temp"], thr), "calibrated_shifted": row_metrics(D, "shifted", CAL["shifted_temp"], thr),
               "primary_macro_f1_ci_test": [float(CI.set_index("family").loc["hgb", "macro_f1_lo"]), float(CI.set_index("family").loc["hgb", "macro_f1_hi"])]}
    save_json(summary, out / "metrics" / "primary_summary.json"); print("[evaluate] primary test macroF1=%.4f threatRecall@thr=%.4f shifted macroF1=%.4f" % (summary["test"]["macro_f1"], summary["calibrated_test"]["threat_recall"], summary["shifted"]["macro_f1"]))


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
