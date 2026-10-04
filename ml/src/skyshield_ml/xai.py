"""Stage 6: explainability. TreeSHAP is computed by the SAME JavaScript implementation that runs inside the app (scripts/shap_batch.js),
then verified: local accuracy, deletion-faithfulness vs random/permutation controls, stability across retrained models, and parity with scikit-learn."""
from __future__ import annotations
import subprocess, tempfile, warnings, joblib, shutil
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from scipy.special import softmax
from sklearn.inspection import permutation_importance
from .common import *
from .train import load_cfg, export_hgb
from . import models as M

warnings.filterwarnings("ignore")
NODE = shutil.which("node") or "node"


def node_shap(model_json, X, tmp):
    inp, outp = Path(tmp) / "in.json", Path(tmp) / "out.json"; inp.write_text(json.dumps({"X": X.tolist()}))
    r = subprocess.run([NODE, str(ROOT / "scripts/shap_batch.js"), str(model_json), str(inp), str(outp)], capture_output=True, text=True, cwd=ROOT)
    if r.returncode: raise RuntimeError(r.stderr)
    print(r.stdout.strip()); return json.loads(outp.read_text())


def beeswarm(ax, phi, X, names, k, title, top=10, rng=None):
    rng = rng or np.random.default_rng(0); imp = np.abs(phi).mean(0); idx = np.argsort(-imp)[:top][::-1]
    for row, j in enumerate(idx):
        v = X[:, j]; rank = pd.Series(v).rank(pct=True).values; y = row + rng.uniform(-0.3, 0.3, len(v)); ax.scatter(phi[:, j], y, c=rank, cmap="coolwarm", s=4, alpha=.6, rasterized=True)
    ax.set_yticks(range(len(idx))); ax.set_yticklabels([names[j] for j in idx], fontsize=7); ax.axvline(0, c="k", lw=.6); ax.set_title(title, fontsize=9); ax.set_xlabel("SHAP (log-odds)")


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; fig = out / "figures"; D = load_data(ROOT / cfg["data_dir"]); F, C = D["features"], D["classes"]; S = json.loads((out / "metrics" / "train_summary.json").read_text())
    model = joblib.load(out / "models" / "hgb_s0.joblib"); mj = out / "model" / "model.json"; te = D["test"]; rng = np.random.default_rng(0); checks = {}
    # parity: JS runtime vs scikit-learn
    r = subprocess.run([NODE, str(ROOT / "scripts/parity_check.js"), str(mj), str(out / "model" / "parity.json"), str(out / "metrics" / "js_parity.json")], capture_output=True, text=True, cwd=ROOT); print(r.stdout.strip()); checks["js_parity"] = json.loads((out / "metrics" / "js_parity.json").read_text())
    n = cfg["shap_samples_per_class"]; sub = pd.concat([g.sample(min(n, len(g)), random_state=0) for _, g in te.groupby("y")]).reset_index(drop=True); X = sub[F].values.astype(np.float64)
    with tempfile.TemporaryDirectory() as tmp: sh = node_shap(mj, X, tmp)
    phi = np.array(sh["phi"]); raw = np.array(sh["raw"]); pred = raw.argmax(1); N = len(sub); phi_pred = phi[np.arange(N), pred]; checks["shap_local_accuracy_max_abs_error"] = sh["local_accuracy_max_abs_error"]; checks["shap_seconds_for_n"] = [sh["seconds"], N]
    # ---- global importance ----
    mean_abs = np.abs(phi_pred).mean(0); order = np.argsort(-mean_abs); gdf = pd.DataFrame({"feature": np.array(F)[order], "mean_abs_shap_predicted_class": mean_abs[order]}); gdf.to_csv(out / "tables" / "shap_global_importance.csv", index=False)
    pc = np.array([[np.abs(phi_pred[pred == k, j]).mean() if (pred == k).any() else 0 for j in range(len(F))] for k in range(7)])
    fig_, ax = plt.subplots(1, 2, figsize=(15, 5), gridspec_kw={"width_ratios": [1, 1.5]}); ax[0].barh(np.array(F)[order][::-1], mean_abs[order][::-1]); ax[0].set_title("Global importance: mean |SHAP| of the predicted class"); ax[0].set_xlabel("mean |SHAP| (log-odds)")
    im = ax[1].imshow(pc[:, order], aspect="auto", cmap="magma"); ax[1].grid(False); ax[1].set_xticks(range(len(F))); ax[1].set_xticklabels(np.array(F)[order], rotation=75, ha="right", fontsize=7); ax[1].set_yticks(range(7)); ax[1].set_yticklabels([SHORT[c] for c in C]); ax[1].set_title("Per-class importance (mean |SHAP| over samples predicted as that class)"); fig_.colorbar(im, ax=ax[1]); savefig(fig_, fig / "fig_shap_global_and_per_class.png")
    fig_, axs = plt.subplots(2, 4, figsize=(18, 8))
    for k, ax in zip(range(7), axs.ravel()): beeswarm(ax, phi[:, k, :], X, F, k, f"SHAP beeswarm: class '{SHORT[C[k]]}'", rng=rng)
    axs.ravel()[7].axis("off"); axs.ravel()[7].text(0.1, 0.5, "colour = feature value\n(blue low, red high)\nx = push on the class score", fontsize=10); savefig(fig_, fig / "fig_shap_beeswarm_per_class.png")
    # ---- dependence plots ----
    dep = [("alt_mean", "low_intruder", "range_to_asset"), ("speed_mean", "fast_drone", "radial_rate"), ("rf_frac", "surveillance_drone", "iff_frac"), ("group_score", "swarm_member", "speed_std"), ("rcs_mean", "bird", "alt_mean"), ("iff_frac", "friendly_aircraft", "alt_mean")]
    fig_, axs = plt.subplots(2, 3, figsize=(15, 7.5))
    for ax, (f, cl, col) in zip(axs.ravel(), dep):
        k = C.index(cl); j = F.index(f); sc = ax.scatter(X[:, j], phi[:, k, j], c=X[:, F.index(col)], cmap="viridis", s=6, alpha=.7, rasterized=True); ax.set_xlabel(f); ax.set_ylabel(f"SHAP for '{SHORT[cl]}'"); ax.set_title(f"{f} -> {SHORT[cl]} (colour: {col})", fontsize=9); fig_.colorbar(sc, ax=ax)
    savefig(fig_, fig / "fig_shap_dependence.png")
    # ---- local waterfalls ----
    def pick(cond): i = np.flatnonzero(cond); return int(i[0]) if len(i) else None
    ex = [("correct: low-altitude intruder", pick((sub.y == 2) & (pred == 2))), ("correct: bird", pick((sub.y == 4) & (pred == 4))), ("correct: swarm member", pick((sub.y == 3) & (pred == 3))), ("MISCLASSIFIED", pick(sub.y.values != pred))]
    ex = [e for e in ex if e[1] is not None]; fig_, axs = plt.subplots(1, len(ex), figsize=(5 * len(ex), 4.2)); axs = np.atleast_1d(axs); T = S["temperature"]
    for ax, (title, i) in zip(axs, ex):
        c = pred[i]; v = phi[i, c]; o = np.argsort(-np.abs(v))[:8][::-1]; ax.barh([f"{F[j]} = {X[i, j]:.2f}" for j in o], v[o], color=["#d62728" if x > 0 else "#1f77b4" for x in v[o]]); p = softmax(raw[i] / T)[c]
        ax.set_title(f"{title}\ntrue {SHORT[C[sub.y[i]]]}, predicted {SHORT[C[c]]} (p={p:.2f})", fontsize=8); ax.axvline(0, c="k", lw=.6); ax.set_xlabel("SHAP (log-odds of predicted class)")
    savefig(fig_, fig / "fig_shap_local_waterfalls.png")
    # ---- permutation importance cross-check ----
    ps = te.sample(min(15000, len(te)), random_state=0); pi = permutation_importance(model, ps[F].astype(np.float64), ps.y, scoring="f1_macro", n_repeats=3, random_state=0, n_jobs=1); pimp = pi.importances_mean
    rho = spearmanr(mean_abs, pimp)[0]; checks["spearman_meanabsSHAP_vs_permutation_importance"] = float(rho)
    fig_, ax = plt.subplots(1, 2, figsize=(12, 4.5)); o2 = np.argsort(-pimp); ax[0].barh(np.array(F)[o2][::-1], pimp[o2][::-1], xerr=pi.importances_std[o2][::-1]); ax[0].set_title("Permutation importance (macro-F1 drop, test)"); ax[1].scatter(mean_abs, pimp); [ax[1].annotate(f, (mean_abs[j], pimp[j]), fontsize=6) for j, f in enumerate(F)]
    ax[1].set_xlabel("mean |SHAP|"); ax[1].set_ylabel("permutation importance"); ax[1].set_title(f"SHAP vs permutation importance (Spearman {rho:.2f})"); savefig(fig_, fig / "fig_importance_crosscheck.png")
    pd.DataFrame({"feature": F, "permutation_importance": pimp, "mean_abs_shap": mean_abs}).sort_values("permutation_importance", ascending=False).to_csv(out / "tables" / "importance_crosscheck.csv", index=False)
    # ---- deletion faithfulness of the top-3 explanation (the mentor sentence uses exactly these features) ----
    train = D["train"][F].values.astype(np.float64); base = model.predict(X); p0 = model.predict_proba(X)[np.arange(N), base]; res = {}
    top_shap = np.argsort(-np.abs(phi_pred), 1)[:, :3]; top_perm = np.tile(np.argsort(-pimp)[:3], (N, 1)); top_rand = np.array([rng.choice(len(F), 3, replace=False) for _ in range(N)])
    for name, idx in [("SHAP top-3 (explanation)", top_shap), ("global permutation top-3", top_perm), ("random 3 features", top_rand)]:
        flips, drops = [], []
        for rep in range(5):
            Xp = X.copy(); bg = train[rng.integers(0, len(train), N)]
            for i in range(N): Xp[i, idx[i]] = bg[i, idx[i]]
            pr = model.predict(Xp); flips.append((pr != base).mean()); drops.append((p0 - model.predict_proba(Xp)[np.arange(N), base]).mean())
        res[name] = {"prediction_flip_rate": float(np.mean(flips)), "mean_prob_drop_of_original_class": float(np.mean(drops))}
    checks["deletion_faithfulness"] = res
    fig_, ax = plt.subplots(1, 2, figsize=(10, 3.5)); nm = list(res)
    ax[0].bar(nm, [res[k]["prediction_flip_rate"] for k in nm]); ax[0].set_title("Deletion test: prediction flip rate"); ax[1].bar(nm, [res[k]["mean_prob_drop_of_original_class"] for k in nm]); ax[1].set_title("Mean probability drop of original class")
    for a in ax: a.tick_params(axis="x", rotation=15)
    savefig(fig_, fig / "fig_xai_faithfulness.png")
    # ---- stability: retrain on a seed-bootstrap of train, compare explanations ----
    tr = D["train"]; seeds = tr.seed.unique(); pick_s = np.random.default_rng(7).choice(seeds, len(seeds), replace=True); parts = [tr[tr.seed == s] for s in pick_s]; trb = pd.concat(parts)
    m2 = M.make_hgb(S["params"], 1, S["best_iter"]).fit(trb[F].astype(np.float64), trb.y); ns = min(300, N); sel = np.sort(rng.choice(N, ns, replace=False))
    with tempfile.TemporaryDirectory() as tmp:
        mj2 = Path(tmp) / "m2.json"; export_hgb(m2, F, C, 1.0, 0.5, S.get("feature_stats", {}) or {}, mj2); sh2 = node_shap(mj2, X[sel], tmp)
    phi2 = np.array(sh2["phi"]); pred2 = np.array(sh2["raw"]).argmax(1); p2 = phi2[np.arange(ns), pred2]; same = pred2 == pred[sel]
    ma2 = np.abs(p2[same]).mean(0); stab = spearmanr(mean_abs, ma2)[0]; jac = np.mean([len(set(np.argsort(-np.abs(phi_pred[sel][i]))[:3]) & set(np.argsort(-np.abs(p2[i]))[:3])) / len(set(np.argsort(-np.abs(phi_pred[sel][i]))[:3]) | set(np.argsort(-np.abs(p2[i]))[:3])) for i in np.flatnonzero(same)])
    checks["stability_global_rank_spearman"] = float(stab); checks["stability_local_top3_jaccard"] = float(jac); checks["stability_agreeing_predictions"] = float(same.mean())
    save_json(checks, out / "metrics" / "xai_checks.json"); print("[xai]", {k: v for k, v in checks.items() if not isinstance(v, dict)})


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
