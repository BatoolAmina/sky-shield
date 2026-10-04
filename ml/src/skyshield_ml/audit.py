"""Stage 0: data audit. Difficulty, class overlap, split integrity and leakage tests. All numbers come from the generated data."""
from __future__ import annotations
import warnings
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from .common import *
from .train import load_cfg
from . import models as M

warnings.filterwarnings("ignore")


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]
    for sub in ["tables", "figures", "metrics", "preds", "models", "model"]: (out / sub).mkdir(parents=True, exist_ok=True)
    D = load_data(ROOT / cfg["data_dir"]); F, C = D["features"], D["classes"]; res = {}
    # 1. split integrity: scenario seeds must be disjoint across splits
    S = {k: set(D[k].seed.unique()) for k in ["train", "valA", "valB", "test"]}; S["shifted"] = set(D["shifted"].seed.unique())
    pairs = [(a, b, len(S[a] & S[b])) for a in S for b in S if a < b]
    res["seed_overlap_between_splits"] = {f"{a}|{b}": n for a, b, n in pairs}; assert all(n == 0 for _, _, n in pairs), "SEED LEAKAGE"
    res["n_seeds"] = {k: len(v) for k, v in S.items()}; res["windows"] = {k: len(D[k]) for k in ["train", "valA", "valB", "test", "shifted"]}
    res["dropped_windows_not_in_7_classes"] = D["dropped"]
    # 2. class balance + windows per seed
    cnt = pd.DataFrame({k: D[k].label.value_counts() for k in ["train", "valA", "valB", "test", "shifted"]}).reindex(C).fillna(0).astype(int); cnt.to_csv(out / "tables" / "class_counts.csv")
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.6)); cnt[["train", "test", "shifted"]].plot.bar(ax=ax[0]); ax[0].set_title("Windows per class and split"); ax[0].set_xticklabels([SHORT[c] for c in C], rotation=0)
    D["train"].groupby("seed").size().plot.hist(bins=30, ax=ax[1]); ax[1].set_title("Windows per scenario seed (train)"); ax[1].set_xlabel("windows"); savefig(fig, out / "figures" / "fig_data_class_balance.png")
    # 3. class overlap: single-feature one-vs-rest AUC (|AUC-0.5|*2) heatmap
    tr = D["train"]; A = np.zeros((len(C), len(F)))
    for i in range(len(C)):
        yb = (tr.y == i).values
        for j, f in enumerate(F): A[i, j] = abs(roc_auc_score(yb, tr[f].values) - 0.5) * 2
    fig, ax = plt.subplots(figsize=(13, 3.8)); im = ax.imshow(A, aspect="auto", cmap="viridis"); ax.set_xticks(range(len(F))); ax.set_xticklabels(F, rotation=75, ha="right"); ax.set_yticks(range(len(C))); ax.set_yticklabels([SHORT[c] for c in C])
    ax.set_title("Single-feature separability (2*|AUC-0.5|, one-vs-rest): how much classes overlap per feature"); ax.grid(False); fig.colorbar(im); savefig(fig, out / "figures" / "fig_data_feature_separability.png")
    pd.DataFrame(A, index=C, columns=F).to_csv(out / "tables" / "single_feature_separability.csv")
    res["max_single_feature_separability"] = float(A.max())
    # 4. feature distributions by class (key features)
    key = ["speed_mean", "alt_mean", "range_to_asset", "rcs_mean", "heading_rate_abs", "group_score", "rf_frac", "radial_rate"]
    fig, axs = plt.subplots(2, 4, figsize=(15, 6))
    for ax, f in zip(axs.ravel(), key):
        data = [tr.loc[tr.label == c, f].clip(tr[f].quantile(.01), tr[f].quantile(.99)).values for c in C]
        ax.violinplot(data, showmedians=True); ax.set_xticks(range(1, 8)); ax.set_xticklabels([SHORT[c] for c in C], rotation=60, fontsize=7); ax.set_title(f)
    savefig(fig, out / "figures" / "fig_data_feature_distributions.png")
    # 5. range must not identify the class (leakage by geometry)
    from sklearn.metrics import accuracy_score
    r = HistGradientBoostingClassifier(max_iter=60, random_state=0).fit(tr[["range_to_asset"]].iloc[::3], tr.y.iloc[::3]); pr = r.predict(D["valA"][["range_to_asset"]])
    res["range_only_macro_f1_valA"] = float(macro_f1(D["valA"].y, pr)); res["chance_macro_f1"] = 1 / len(C)
    # 6. shuffled-label control: must be at chance
    rng = np.random.default_rng(0); ysh = rng.permutation(tr.y.values[::3])
    sh = HistGradientBoostingClassifier(max_iter=60, random_state=0).fit(tr[F].iloc[::3], ysh); res["shuffled_label_macro_f1_valA"] = float(macro_f1(D["valA"].y, sh.predict(D["valA"][F])))
    # 7. adversarial validation (seed-wise split): can a model tell train windows from test / shifted windows?
    def adv(other):
        a = tr.sample(20000, random_state=0).assign(_d=0); b = D[other].sample(min(20000, len(D[other])), random_state=0).assign(_d=1); X = pd.concat([a, b])
        us = X.seed.unique(); rng = np.random.default_rng(1); held = set(rng.choice(us, len(us) // 3, replace=False)); m = X.seed.isin(held)
        c = HistGradientBoostingClassifier(max_iter=80, random_state=0).fit(X.loc[~m, F], X.loc[~m, "_d"]); return float(roc_auc_score(X.loc[m, "_d"], c.predict_proba(X.loc[m, F])[:, 1]))
    res["adversarial_validation_auc_train_vs_test"] = adv("test"); res["adversarial_validation_auc_train_vs_shifted"] = adv("shifted")
    # 8. baseline difficulty: logistic regression on valA
    lr = M.make_lr(F).fit(tr[F], tr.y); p = lr.predict(D["valA"][F]); res["logreg_valA_macro_f1"] = float(macro_f1(D["valA"].y, p)); res["logreg_valA_accuracy"] = float(accuracy_score(D["valA"].y, p))
    save_json(res, out / "metrics" / "data_audit.json"); print("[audit]", {k: v for k, v in res.items() if not isinstance(v, dict)})


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
