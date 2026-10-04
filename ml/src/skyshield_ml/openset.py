"""Stage 4: unknown-track (open-set) detection. Leave-one-class-out: hold a class out of training, treat its test windows as 'unknown'."""
from __future__ import annotations
import warnings
import numpy as np, pandas as pd
from scipy.stats import entropy
from sklearn.ensemble import IsolationForest
from sklearn.metrics import roc_auc_score, roc_curve, average_precision_score
from .common import *
from .train import load_cfg
from . import models as M

warnings.filterwarnings("ignore")


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; D = load_data(ROOT / cfg["data_dir"]); F, C = D["features"], D["classes"]; S = json.loads((out / "metrics" / "train_summary.json").read_text())
    tr = D["train"].iloc[::2]; te = D["test"]; rows = []; curves = {}
    for c, name in enumerate(C):
        keep = tr.y != c; known = te.y != c; unk = (~known).astype(int).values
        clf = M.make_hgb(S["params"], 0, max(40, S["best_iter"] // 2)); ymap = {k: i for i, k in enumerate([k for k in range(7) if k != c])}
        clf.fit(tr.loc[keep, F], tr.loc[keep, "y"].map(ymap)); P = clf.predict_proba(te[F])
        iso = IsolationForest(n_estimators=200, contamination=0.05, random_state=0, n_jobs=-1).fit(tr.loc[keep, F])
        scores = {"isolation_forest": -iso.score_samples(te[F]), "max_softmax": 1 - P.max(1), "entropy": entropy(P.T)}
        for k, s in scores.items():
            fpr, tpr, _ = roc_curve(unk, s); tpr5 = float(np.interp(0.05, fpr, tpr)); rows.append({"held_out_class": name, "detector": k, "auroc": roc_auc_score(unk, s), "aupr": average_precision_score(unk, s), "tpr_at_5pct_fpr": tpr5})
            curves[(name, k)] = (fpr, tpr)
    R = pd.DataFrame(rows); R.to_csv(out / "tables" / "openset_leave_one_class_out.csv", index=False)
    piv = R.pivot(index="held_out_class", columns="detector", values="auroc").loc[C]
    fig, ax = plt.subplots(1, 3, figsize=(16, 4)); piv.plot.bar(ax=ax[0]); ax[0].set_title("Unknown detection AUROC (leave-one-class-out)"); ax[0].set_xticklabels([SHORT[c] for c in C], rotation=0); ax[0].axhline(0.5, c="k", ls=":"); ax[0].set_ylim(0.3, 1)
    R.groupby("detector")[["auroc", "aupr", "tpr_at_5pct_fpr"]].mean().plot.bar(ax=ax[1]); ax[1].set_title("Mean over held-out classes"); ax[1].tick_params(axis="x", rotation=15)
    for k, ls in [("isolation_forest", "-"), ("max_softmax", "--"), ("entropy", ":")]:
        for name in ["bird", "low_intruder", "swarm_member"]: f, t = curves[(name, k)]; ax[2].plot(f, t, ls, label=f"{k[:8]}|{SHORT[name]}")
    ax[2].plot([0, 1], [0, 1], "k:", lw=.7); ax[2].set_title("ROC examples"); ax[2].legend(fontsize=6, ncol=3); ax[2].set_xlabel("FPR"); ax[2].set_ylabel("TPR"); savefig(fig, out / "figures" / "fig_openset_unknown_detection.png")
    save_json(R.groupby("detector")[["auroc", "aupr", "tpr_at_5pct_fpr"]].mean().to_dict(), out / "metrics" / "openset_mean.json"); print("[openset]\n", R.groupby("detector")[["auroc", "tpr_at_5pct_fpr"]].mean().round(3))


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
