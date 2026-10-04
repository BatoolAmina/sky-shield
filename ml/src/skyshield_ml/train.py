"""Stage 1: tune on valA, train all models, calibrate on valB, choose threat threshold, export JS model + parity file."""
from __future__ import annotations
import copy, json, sys, time, warnings
from pathlib import Path
import joblib, numpy as np, pandas as pd, yaml
from scipy.optimize import minimize_scalar
from scipy.special import softmax
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss
from sklearn.pipeline import Pipeline
from . import models as M
from .common import *

warnings.filterwarnings("ignore")


def load_cfg(path):
    return yaml.safe_load(Path(path).read_text())


def _staged_eval(model, Xv, yv):
    losses, f1s = [], []
    for p in model.staged_predict_proba(Xv):
        losses.append(log_loss(yv, p, labels=range(p.shape[1]))); f1s.append(macro_f1(yv, p.argmax(1)))
    return np.array(losses), np.array(f1s)


def tune_hgb(D, cfg, out):
    F = D["features"]; tr = D["train"].iloc[:: cfg["tune_stride"]]
    Xt, yt = XY(tr, F, np.float64); Xa, ya = XY(D["valA"], F, np.float64)
    hist = []

    def run_trial(p):
        m = M.make_hgb(p, seed=cfg["random_state"], max_iter=cfg["tune_max_iter"]).fit(Xt, yt)
        l, f = _staged_eval(m, Xa, ya); b = int(l.argmin())
        hist.append({**p, "best_iter": b + 1, "val_logloss": float(l[b]), "val_macro_f1": float(f[b])}); return float(l[b])

    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        def obj(t):
            return run_trial(dict(learning_rate=t.suggest_float("learning_rate", 0.03, 0.2, log=True), max_leaf_nodes=t.suggest_categorical("max_leaf_nodes", [15, 31, 63]),
                                  min_samples_leaf=t.suggest_int("min_samples_leaf", 20, 200), l2_regularization=t.suggest_float("l2_regularization", 0.0, 5.0),
                                  max_features=t.suggest_float("max_features", 0.5, 1.0)))
        optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=cfg["random_state"])).optimize(obj, n_trials=cfg["tune_trials"])
        engine = "optuna-TPE"
    except ImportError:
        r = np.random.default_rng(cfg["random_state"]); engine = "random-search"
        for _ in range(cfg["tune_trials"]):
            run_trial(dict(learning_rate=float(np.exp(r.uniform(np.log(0.03), np.log(0.2)))), max_leaf_nodes=int(r.choice([15, 31, 63])), min_samples_leaf=int(r.integers(20, 201)),
                           l2_regularization=float(r.uniform(0, 5)), max_features=float(r.uniform(0.5, 1.0))))
    h = pd.DataFrame(hist); h.index.name = "trial"; h.to_csv(out / "tables" / "tuning_history.csv")
    best = h.loc[h.val_logloss.idxmin()]
    params = {k: (int(best[k]) if k in ("max_leaf_nodes", "min_samples_leaf") else float(best[k])) for k in ["learning_rate", "max_leaf_nodes", "min_samples_leaf", "l2_regularization", "max_features"]}
    return params, int(best.best_iter), engine, h


def train_mlp(D, seed, cfg):
    F = D["features"]; Xt, yt = XY(D["train"], F, np.float64); Xa, ya = XY(D["valA"], F, np.float64)
    pre = M.preproc(F).fit(Xt); Ztr, Zva = pre.transform(Xt), pre.transform(Xa)
    from sklearn.neural_network import MLPClassifier
    clf = MLPClassifier(hidden_layer_sizes=(256, 128, 64), alpha=1e-4, batch_size=256, learning_rate_init=1e-3, random_state=seed)
    sub = np.random.default_rng(seed).choice(len(yt), min(20000, len(yt)), replace=False)
    curve, best, best_l, bad = [], None, 1e9, 0
    for ep in range(cfg["mlp_max_epochs"]):
        clf.partial_fit(Ztr, yt, classes=np.arange(len(D["classes"])))
        tl = log_loss(yt[sub], clf.predict_proba(Ztr[sub]), labels=range(7)); vp = clf.predict_proba(Zva); vl = log_loss(ya, vp, labels=range(7))
        curve.append({"epoch": ep + 1, "train_loss": tl, "val_loss": vl, "val_macro_f1": macro_f1(ya, vp.argmax(1))})
        if vl < best_l - 1e-4: best_l, best, bad = vl, copy.deepcopy(clf), 0
        else:
            bad += 1
            if bad >= cfg["mlp_patience"]: break
    return Pipeline([("pre", pre), ("clf", best)]), pd.DataFrame(curve)


def temperature_fit(raw, y):
    def nll(T): return log_loss(y, softmax(raw / T, axis=1), labels=range(raw.shape[1]))
    r = minimize_scalar(nll, bounds=(0.3, 5.0), method="bounded"); return float(r.x)


def iso_fit(P, y):
    return [IsotonicRegression(out_of_bounds="clip").fit(P[:, k], (y == k).astype(float)) for k in range(P.shape[1])]


def iso_apply(isos, P):
    Q = np.column_stack([i.predict(P[:, k]) for k, i in enumerate(isos)]); Q = np.clip(Q, 1e-6, None); return Q / Q.sum(1, keepdims=True)


def export_hgb(model, features, classes, T, thr, stats, path, unknown_thr=None):
    trees = []
    for it in model._predictors:
        for k, tp in enumerate(it):
            n = tp.nodes
            trees.append({"k": k, "feat": n["feature_idx"].astype(int).tolist(), "thr": [round(float(v), 9) for v in n["num_threshold"]], "left": n["left"].astype(int).tolist(),
                          "right": n["right"].astype(int).tolist(), "val": [round(float(v), 8) for v in n["value"]], "cnt": n["count"].astype(int).tolist(),
                          "leaf": n["is_leaf"].astype(int).tolist(), "mgl": n["missing_go_to_left"].astype(int).tolist()})
    j = {"format": "skyshield-hgb-v1", "feature_names": features, "classes": classes, "baseline": [float(v) for v in model._baseline_prediction.ravel()], "trees": trees,
         "temperature": T, "threat_class_idx": [0, 1, 2, 3], "threat_threshold": thr, "unknown_maxprob_threshold": unknown_thr, "feature_stats": stats}
    Path(path).parent.mkdir(parents=True, exist_ok=True); Path(path).write_text(json.dumps(j, separators=(",", ":")))
    return len(trees)


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style()
    out = ROOT / cfg["out_dir"]
    for s in ["tables", "figures", "metrics", "preds", "models", "model"]: (out / s).mkdir(parents=True, exist_ok=True)
    D = load_data(ROOT / cfg["data_dir"]); F, C = D["features"], D["classes"]; log = {}
    print(f"[train] rows train={len(D['train'])} valA={len(D['valA'])} valB={len(D['valB'])} test={len(D['test'])} shifted={len(D['shifted'])}")
    t0 = time.time(); cache = out / "tables" / "tuning_history.csv"
    if cache.exists() and cfg.get("reuse_tuning", True):
        hist = pd.read_csv(cache); best = hist.loc[hist.val_logloss.idxmin()]; engine = "cached " + ("optuna-TPE" if "optuna" in sys.modules else "random-search")
        params = {k: (int(best[k]) if k in ("max_leaf_nodes", "min_samples_leaf") else float(best[k])) for k in ["learning_rate", "max_leaf_nodes", "min_samples_leaf", "l2_regularization", "max_features"]}; best_iter = int(best.best_iter)
        print(f"[train] reusing cached tuning history ({len(hist)} trials)")
    else:
        params, best_iter, engine, hist = tune_hgb(D, cfg, out)
    print(f"[train] tuning ({engine}, {cfg['tune_trials']} trials) {time.time()-t0:.0f}s best={params} iter={best_iter}")
    Xtr, ytr = XY(D["train"], F, np.float64); preds, fitted, info = {}, {}, {}

    def evalset(m): return {k: m.predict_proba(XY(D[k], F, np.float64)[0]) for k in ["valA", "valB", "test", "shifted"]}
    def latency(m):
        X = XY(D["test"], F, np.float64)[0].iloc[:2000]; t = time.perf_counter(); m.predict_proba(X); batch = (time.perf_counter() - t) / len(X) * 1000
        x1 = X.iloc[[0]]; t = time.perf_counter(); [m.predict_proba(x1) for _ in range(30)]; return {"ms_per_row_batch": batch, "ms_single_row": (time.perf_counter() - t) / 30 * 1000}

    jobs = [("logreg", 0, lambda s: M.make_lr(F, s).fit(Xtr, ytr))]
    jobs += [("random_forest", s, (lambda s: M.make_rf(F, s, cfg["rf_trees"]).fit(Xtr, ytr))) for s in cfg["rf_seeds"]]
    jobs += [("hgb", 0, lambda s: M.make_hgb(params, 0, best_iter).fit(Xtr, ytr))]
    for name, est in M.optional_challengers().items():
        jobs.append((name, 0, (lambda s, est=est: est.fit(Xtr, ytr, sample_weight=M.sample_weights(ytr)))))
    mlp_curves = {}
    for name, s, fit in jobs:
        with Timer() as tm: m = fit(s)
        key = f"{name}_s{s}"; preds[key] = evalset(m); info[key] = {"family": name, "seed": s, "train_seconds": tm.s, **latency(m)}
        joblib.dump(m, out / "models" / f"{key}.joblib"); np.savez_compressed(out / "preds" / f"{key}.npz", **preds[key])
        if name == "hgb": fitted[key] = m          # only the primary stays in memory; others are on disk
        del m
        print(f"[train] {key:18s} {tm.s:6.1f}s  valA macroF1={macro_f1(D['valA'].y, preds[key]['valA'].argmax(1)):.4f}")
    for s in cfg["mlp_seeds"]:
        with Timer() as tm: m, curve = train_mlp(D, s, cfg)
        key = f"mlp_s{s}"; preds[key] = evalset(m); info[key] = {"family": "mlp", "seed": s, "train_seconds": tm.s, **latency(m), "epochs": int(len(curve))}; mlp_curves[key] = curve
        joblib.dump(m, out / "models" / f"{key}.joblib"); np.savez_compressed(out / "preds" / f"{key}.npz", **preds[key]); del m
        curve.to_csv(out / "tables" / f"mlp_curve_s{s}.csv", index=False)
        print(f"[train] {key:18s} {tm.s:6.1f}s  valA macroF1={macro_f1(D['valA'].y, preds[key]['valA'].argmax(1)):.4f} epochs={len(curve)}")

    # learning curve of the primary model (train vs valA logloss per boosting iteration)
    Xa, ya = XY(D["valA"], F, np.float64); sub = np.random.default_rng(0).choice(len(ytr), 20000, replace=False)
    cm = M.make_hgb(params, 0, max(300, best_iter * 2)).fit(Xtr, ytr)
    lv, fv = _staged_eval(cm, Xa, ya); lt, ft = _staged_eval(cm, Xtr.iloc[sub], ytr[sub])
    pd.DataFrame({"iteration": np.arange(1, len(lv) + 1), "train_logloss": lt, "valA_logloss": lv, "train_macro_f1": ft, "valA_macro_f1": fv}).to_csv(out / "tables" / "hgb_learning_curve.csv", index=False)

    # ---- calibration (fit on valB only) + threshold (valB only) for the primary model ----
    prim = fitted["hgb_s0"]; yB = D["valB"].y.values
    rawB = prim.decision_function(XY(D["valB"], F, np.float64)[0]); T = temperature_fit(rawB, yB)
    isos = iso_fit(preds["hgb_s0"]["valB"], yB)
    cal = {}
    for k in ["valA", "valB", "test", "shifted"]:
        raw = prim.decision_function(XY(D[k], F, np.float64)[0])
        cal[k] = {"uncal": preds["hgb_s0"][k], "temp": softmax(raw / T, axis=1), "iso": iso_apply(isos, preds["hgb_s0"][k])}
    pthr = threat_of(cal["valB"]["temp"]); yb = D["valB"].threat.values; cost = cfg["cost_miss_over_false_alarm"]
    grid = np.linspace(0.01, 0.99, 99); costs = [cost * ((pthr < g) & (yb == 1)).sum() + ((pthr >= g) & (yb == 0)).sum() for g in grid]
    thr = float(grid[int(np.argmin(costs))])
    print(f"[train] temperature T={T:.3f}  threat threshold={thr:.2f} (cost miss:false-alarm = {cost}:1)")

    # ---- persist ----
    np.savez_compressed(out / "preds" / "hgb_calibrated.npz", **{f"{k}_{c}": v for k, d in cal.items() for c, v in d.items()})
    stats = {f: {q: float(D["train"][f].quantile(p)) for q, p in [("p10", .1), ("p25", .25), ("median", .5), ("p75", .75), ("p90", .9)]} for f in F}
    unk_thr = float(np.quantile(cal["valB"]["temp"].max(1), 0.05))   # 95% of known-class validation windows are at least this confident
    ntrees = export_hgb(prim, F, C, T, thr, stats, out / "model" / "model.json", unk_thr)
    Xp = D["test"].sample(200, random_state=0); rawp = prim.decision_function(Xp[F].astype(np.float64))
    save_json({"X": Xp[F].values.tolist(), "raw": rawp.tolist()}, out / "model" / "parity.json")
    save_json({"params": params, "best_iter": best_iter, "engine": engine, "temperature": T, "threat_threshold": thr, "unknown_maxprob_threshold": unk_thr, "cost_ratio": cost, "n_trees_exported": ntrees,
               "models": info, "features": F, "classes": C, "counts": {k: len(D[k]) for k in ["train", "valA", "valB", "test", "shifted"]}, "dropped_windows": D["dropped"],
               "challengers_installed": sorted(M.optional_challengers().keys()), "tuning_seconds": time.time() - t0}, out / "metrics" / "train_summary.json")
    print(f"[train] done; exported {ntrees} trees -> {out/'model'/'model.json'}")


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
