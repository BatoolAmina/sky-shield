"""Stage 5: evaluate the hybrid threat scorer's PRIORITY RANKING against an oracle computed from ground truth (true threat x time-to-impact x proximity)."""
from __future__ import annotations
import json, warnings
import numpy as np, pandas as pd
from scipy.stats import kendalltau
from sklearn.linear_model import Ridge
from .common import *
from .train import load_cfg

warnings.filterwarnings("ignore")
SC = json.loads((ROOT / "packages/sim-core/src/model/scorer.json").read_text())


def components(df, pthreat):
    zone = np.where(df.range_to_asset <= 1500, SC["zone_values"]["restricted"], np.where(df.range_to_asset <= 4000, SC["zone_values"]["warning"], SC["zone_values"]["safe"]))
    urg = np.exp(-df.time_to_cpa / 60) * np.where(df.cpa_dist < 1500, 1.0, np.exp(-(df.cpa_dist - 1500) / 2500))
    return pd.DataFrame({"threat": pthreat, "time": urg.values, "zone": zone, "dist": np.exp(-df.range_to_asset / 4000).values, "group": df.group_score.values})


def rule_score(comp):
    w = SC["weights"]; return 100 * sum(w[k] * comp[k] for k in w)


def ndcg_at_k(gains, scores, k=3):
    o = np.argsort(-scores)[:k]; ideal = np.sort(gains)[::-1][:k]; disc = 1 / np.log2(np.arange(2, k + 2)); dcg = (gains[o] * disc[: len(o)]).sum(); idcg = (ideal * disc[: len(ideal)]).sum()
    return dcg / idcg if idcg > 0 else np.nan


def rank_eval(df, score, seed=0):
    """Per snapshot (scenario seed, time): Kendall tau, NDCG@3 and top-1 hit vs the oracle priority."""
    r = np.random.default_rng(seed); taus, nd, top1 = [], [], []; df = df.assign(_s=score)
    for _, g in df.groupby(["seed", "t"]):
        if len(g) < 3 or g.oracle.nunique() < 2: continue
        o = g.oracle.values; s = g._s.values; t = kendalltau(o, s)[0]
        if not np.isnan(t): taus.append(t)
        nd.append(ndcg_at_k(o, s)); top1.append(float(np.argmax(o) == np.argmax(s)))
    return {"kendall_tau": float(np.nanmean(taus)), "ndcg_at_3": float(np.nanmean(nd)), "top1_hit": float(np.mean(top1)), "n_snapshots": len(top1)}


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; D = load_data(ROOT / cfg["data_dir"]); CAL = dict(np.load(out / "preds" / "hgb_calibrated.npz"))
    res = {}
    for split in ["test", "shifted"]:
        df = D[split]; pt = threat_of(CAL[f"{split}_temp"]); comp = components(df, pt); rng = np.random.default_rng(0)
        # fitted scorer: ridge on the 5 components -> oracle, trained on TRAIN seeds (train p_threat from calibrated primary is not stored; use valB for fitting, test untouched)
        if split == "test":
            vb = D["valB"]; cv = components(vb, threat_of(CAL["valB_temp"])); ridge = Ridge(alpha=1.0, positive=True).fit(cv, vb.oracle); res["fitted_weights"] = dict(zip(cv.columns, ridge.coef_.round(3))); res["rule_weights"] = SC["weights"]
        cands = {"oracle (upper bound)": df.oracle.values, "rule-based hybrid score": rule_score(comp).values, "fitted (ridge on components)": ridge.predict(comp), "classifier threat prob only": pt,
                 "closest-first (distance only)": -df.range_to_asset.values, "random": rng.random(len(df))}
        for name, s in cands.items(): res[f"{split}|{name}"] = rank_eval(df, s)
    R = pd.DataFrame({k: v for k, v in res.items() if "|" in k}).T; R.index = pd.MultiIndex.from_tuples([i.split("|") for i in R.index], names=["split", "scorer"]); R.to_csv(out / "tables" / "threat_scorer_ranking.csv")
    save_json(res, out / "metrics" / "threat_scorer.json")
    fig, ax = plt.subplots(1, 3, figsize=(15, 3.8)); t = R.loc["test"]
    for a, m in zip(ax, ["kendall_tau", "ndcg_at_3", "top1_hit"]):
        both = R[m].unstack(0)[["test", "shifted"]]; both.plot.barh(ax=a); a.set_title(f"Priority ranking vs oracle: {m}"); a.set_ylabel("")
    savefig(fig, out / "figures" / "fig_threat_scorer_ranking.png"); print("[scorer]\n", t.round(3))


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
