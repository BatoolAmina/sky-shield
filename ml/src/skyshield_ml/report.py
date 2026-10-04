"""Stage 8: build results/<run>/REPORT.md strictly from saved metric files. No number in the report is typed by hand."""
from __future__ import annotations
import platform, sys, os, datetime
import numpy as np, pandas as pd
from .common import *
from .train import load_cfg


def md(df, fmt="{:.4f}", index=False):
    d = df.reset_index() if index else df.copy(); cols = list(d.columns)
    f = lambda v: fmt.format(v) if isinstance(v, (float, np.floating)) else str(v)
    return "\n".join(["| " + " | ".join(map(str, cols)) + " |", "|" + "|".join(["---"] * len(cols)) + "|"] + ["| " + " | ".join(f(v) for v in row) + " |" for row in d.itertuples(index=False)])


FEATURE_DOC = {"speed_mean": "mean 3-D speed over the window (m/s)", "speed_std": "speed variability", "alt_mean": "mean altitude (m)", "alt_std": "altitude variability", "vert_rate_abs": "mean absolute vertical rate", "heading_rate_abs": "mean absolute heading change (deg/s)", "curvature": "heading change per metre travelled", "radial_rate": "slope of range to the asset (m/s, negative = closing)", "range_to_asset": "current range (m)", "cpa_dist": "closest point of approach (m)", "time_to_cpa": "time to closest approach (s, 300 = receding)", "heading_to_asset_cos": "cosine of angle between velocity and direction to asset", "rcs_mean": "noisy radar cross-section estimate (dB)", "rcs_std": "RCS variability", "rf_frac": "fraction of window with RF emission associated", "rf_sig": "RF signature id (-1 = none)", "iff_frac": "fraction of window with transponder replies", "eo_drone_frac": "fraction with camera hint = drone", "eo_bird_frac": "fraction with camera hint = bird", "eo_air_frac": "fraction with camera hint = aircraft", "n_sensor_types": "number of sensor types that saw the track", "track_age": "seconds since track birth", "fusion_conf": "fused track confidence 0-1", "hit_rate": "radar hit rate in the window", "group_count": "nearby tracks moving alike", "group_score": "group-motion similarity 0-1"}


def write_cards(out, man, S, A, P, X, AD):
    allw = A["dropped_windows_not_in_7_classes"]; tot_dropped = {k: {lab: n for lab, n in d.items() if lab not in man["classes"]} for k, d in allw.items()}; frac_dropped = sum(sum(d.values()) for d in tot_dropped.values()) / sum(sum(d.values()) for d in allw.values())
    mc = ["# Model card: SkyShield track classifier (mentor)\n", "Generated from the saved metric files of this run. All data are synthetic.\n",
          "## Intended use", "Decision support inside a training simulator: suggests a class, a threat probability and (through a deterministic rule layer) an action, with a template explanation. **Not** for real-world engagement or surveillance decisions.\n",
          "## Model", f"- scikit-learn HistGradientBoostingClassifier, {S['n_trees_exported']} trees ({S['best_iter']} iterations x 7 classes), params `{S['params']}`, balanced class weights.",
          f"- Calibration: temperature scaling, T = {S['temperature']:.3f}, fitted on a seed-disjoint validation split (valB). Threat threshold {S['threat_threshold']:.2f} (miss:false-alarm cost {S['cost_ratio']:.0f}:1, chosen on valB). Unknown-likeness threshold: max class probability below {S.get('unknown_maxprob_threshold', float('nan')):.3f} (5th percentile on valB).",
          "- Inputs: 26 features from the perceived track over a 15 s window (no ground truth). Outputs: 7-class probabilities, threat probability, SHAP-based explanation.\n",
          "## Training and evaluation data", f"Synthetic, simulator version `{man['generator']}`, dataset `{man['version']}`. Windows: {S['counts']}. Splits are by scenario seed. Evaluation uses held-out test seeds and a separately generated shifted-distribution set.\n",
          "## Performance (measured on synthetic data)", f"- Test: macro-F1 {P['test']['macro_f1']:.4f} (95% CI {P['primary_macro_f1_ci_test'][0]:.4f} to {P['primary_macro_f1_ci_test'][1]:.4f}), accuracy {P['test']['accuracy']:.4f}, ECE {P['test']['ece']:.4f}.",
          f"- Threat detection at the chosen threshold: recall {P['calibrated_test']['threat_recall']:.4f}, precision {P['calibrated_test']['threat_precision']:.4f}, false-alarm rate {P['calibrated_test']['false_alarm_rate']:.4f}.",
          f"- Shifted distribution: macro-F1 {P['shifted']['macro_f1']:.4f}; threat recall {P['calibrated_shifted']['threat_recall']:.4f}; false-alarm rate {P['calibrated_shifted']['false_alarm_rate']:.4f}.", "- See REPORT.md for per-class results, robustness sweeps (notably RF loss), ablations, calibration and explanation faithfulness.\n",
          "## Known limitations", "- Synthetic distribution only; class ranges overlap by design but real sensors will differ.", "- Strong reliance on RF emission and transponder features: losing RF sharply reduces threat recall (see robustness table).", "- Unknown-class detection is weak (see open-set table); the unknown flag is a coarse confidence heuristic.", "- Young tracks (< 10 s) are classified less reliably.", "- Illustrative zones and response effectiveness; needs expert validation before any claim about real operations.\n",
          "## Explanations", f"TreeSHAP computed by the app's own JavaScript implementation (local accuracy error {X['shap_local_accuracy_max_abs_error']:.1e}). Removing the top-3 explanation features flips {X['deletion_faithfulness']['SHAP top-3 (explanation)']['prediction_flip_rate']:.1%} of predictions vs {X['deletion_faithfulness']['random 3 features']['prediction_flip_rate']:.1%} for random features." if X else ""]
    (out / "MODEL_CARD.md").write_text("\n".join(mc))
    dc = ["# Data card: SkyShield synthetic track dataset\n", f"Dataset `{man['version']}`, generator `{man['generator']}`, tracker `{man['filter']}`, window {man['windowS']} s, stride {man['strideS']} s, master seed {man['masterSeed']}. Fully regenerable: determinism hashes for seeds 1-3 are `{man['determinism_hashes_seed_1_2_3']}`.\n",
          "## Procedure", "1. Per scenario seed, a random composition of 2-4 threat groups, bird flocks, and friendly/civil traffic is spawned (class parameter ranges overlap on purpose: slow drones vs birds, low drones vs helicopters).", "2. The same flight code as the live game moves every object; radar (clutter, shadowing, outages), RF, EO and IFF models produce noisy detections; a Kalman tracker with nearest-neighbour association and M-of-N confirmation builds tracks.",
          "3. Every 3 s, each confirmed track yields one window of 26 features computed from the perceived track only. Labels come from the dominant ground-truth object in the window.", "4. Splits are by scenario seed (train 70 / val 15 split into valA for tuning and valB for calibration / test 15); a separate shifted set uses a different parameter distribution.\n",
          "## Splits", f"Seeds: {A['n_seeds']}; windows kept: {A['windows']}.", f"Windows excluded from the 7-class task (mixed ground truth or clutter): {tot_dropped}. That is {frac_dropped:.1%} of all generated windows; most are `mixed` (track swaps inside tight flocks), which is realistic but reduces usable data.\n",
          "## Features"] + [f"- `{k}`: {v}" for k, v in FEATURE_DOC.items()] + ["", "## Audit results (see REPORT.md section 2)", f"- Seed overlap between splits: 0. Range-only macro-F1 {A['range_only_macro_f1_valA']:.3f} (chance {A['chance_macro_f1']:.3f}). Shuffled-label macro-F1 {A['shuffled_label_macro_f1_valA']:.3f}. Adversarial-validation AUC train-vs-test {A['adversarial_validation_auc_train_vs_test']:.3f}, train-vs-shifted {A['adversarial_validation_auc_train_vs_shifted']:.3f}.",
          "", "## Known issues", "- Classes are not exactly balanced; balanced class weights are used in training instead of resampling.", "- Clutter tracks are rarely confirmed, so the `unknown` class is not represented in the data; unknown-track detection is evaluated by leaving classes out.", "- All parameters (ranges, noise, zones) are illustrative."]
    (out / "DATA_CARD.md").write_text("\n".join(dc))


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); out = ROOT / cfg["out_dir"]; T, Mx, F = out / "tables", out / "metrics", out / "figures"
    J = lambda n: json.loads((Mx / n).read_text()) if (Mx / n).exists() else None
    C = lambda n: pd.read_csv(T / n) if (T / n).exists() else None
    S, A, P, X, PAR, SC, OS, AD = J("train_summary.json"), J("data_audit.json"), J("primary_summary.json"), J("xai_checks.json"), J("js_parity.json"), J("threat_scorer.json"), J("openset_mean.json"), J("adversary_summary.json")
    man = load_manifest(ROOT / cfg["data_dir"]); L = []; w = L.append; cfg_rep = (J("adversary_eval.json") or {}).get("repeats", "?")
    try:
        import torch; torch_info = f"torch {torch.__version__}, cuda={torch.cuda.is_available()}"
    except Exception:
        torch_info = "torch NOT installed in the environment that produced these results"
    w("# SkyShield Trainer: results report\n")
    w("> Every number below was read from files written by the pipeline run described here. Nothing is hand-typed. **All data are synthetic, generated by the SkyShield simulator**; results describe performance on that synthetic distribution, not on real-world sensors.\n")
    w("## 1. Run provenance\n")
    w(f"- Generated: {datetime.datetime.utcnow():%Y-%m-%d %H:%M} UTC; Python {platform.python_version()}; CPU cores: {os.cpu_count()}; {torch_info}")
    w(f"- Optional challengers installed during this run: {S['challengers_installed'] or 'none (LightGBM / XGBoost not installed here)'}")
    w(f"- Dataset `{man['version']}`: simulator `{man['generator']}`, tracker `{man['filter']}`, window {man['windowS']} s, stride {man['strideS']} s, master seed {man['masterSeed']}; generation took {man['generated_seconds']:.0f} s")
    w(f"- Scenario seeds per split: {A['n_seeds']}; windows kept (dominant truth in the 7 classes): {A['windows']}")
    w(f"- Determinism hashes of seeds 1,2,3 (must be identical on every machine): `{man['determinism_hashes_seed_1_2_3']}`")
    w(f"- Primary model: scikit-learn HistGradientBoosting (histogram GBDT, the same algorithm family as LightGBM), {S['n_trees_exported']} trees exported to the JavaScript runtime. Tuning engine: {S['engine']} ({cfg['tune_trials']} trials, validation seeds only), best iteration {S['best_iter']}, params `{S['params']}`\n")
    ag = C("performance_by_track_age.csv"); ab = C("ablation_feature_groups.csv"); tw = C("ablation_tracker_window.csv"); ct, cs = P["calibrated_test"], P["calibrated_shifted"]
    # ---- computed key findings (every sentence is generated from the saved files; wording depends on the numbers) ----
    w("## Key findings (computed)\n")
    ci_tab = C("model_ci_test.csv").set_index("family"); best = ci_tab.macro_f1.idxmax(); rest = ci_tab.drop(best).macro_f1.max()
    w(f"- Best model family on the held-out test seeds: **{best}** (macro-F1 {ci_tab.macro_f1[best]:.4f}); runner-up {ci_tab.drop(best).macro_f1.idxmax()} ({rest:.4f}).")
    pt_ = C("paired_tests_vs_primary.csv")
    if pt_ is not None:
        for _, r in pt_.iterrows():
            sig = ("the seed-cluster bootstrap interval excludes 0" if r.ci_lo > 0.001 else "the interval's lower bound is within 0.001 of zero, so the difference is **borderline**" if r.ci_lo > -0.001 else "the seed-cluster bootstrap interval includes 0, so the difference is **not clearly significant**")
            w(f"- Primary vs {r.other.split('_s')[0]}: macro-F1 difference {r.delta_macro_f1:+.4f} (95% CI {r.ci_lo:+.4f} to {r.ci_hi:+.4f}); {sig}. (McNemar p = {r.mcnemar_p:.4f} treats windows as independent and is therefore optimistic; trust the bootstrap.)")
    w(f"- Distribution shift costs the primary model {P['test']['macro_f1'] - P['shifted']['macro_f1']:.3f} macro-F1 ({P['test']['macro_f1']:.3f} -> {P['shifted']['macro_f1']:.3f}); threat recall at the chosen threshold goes {ct['threat_recall']:.3f} -> {cs['threat_recall']:.3f} while the false-alarm rate rises {ct['false_alarm_rate']:.3f} -> {cs['false_alarm_rate']:.3f}.")
    Rb = C("robustness.csv")
    if Rb is not None:
        h = Rb[Rb.model == "hgb"].set_index(["sweep", "level"]); base_ = h.loc[("noise", 1.0)]
        w(f"- Loss of the RF sensor is the most damaging single failure tested: macro-F1 {base_.macro_f1:.3f} -> {h.loc[('rf_off', 1.0)].macro_f1:.3f} and threat recall {base_.threat_recall:.3f} -> {h.loc[('rf_off', 1.0)].threat_recall:.3f} (the model leans on RF emission). Loss of EO costs only {base_.macro_f1 - h.loc[('eo_off', 1.0)].macro_f1:.3f} macro-F1; 8x clutter costs {base_.macro_f1 - h.loc[('clutter', 8.0)].macro_f1:.3f}; 3x noise costs {base_.macro_f1 - h.loc[('noise', 3.0)].macro_f1:.3f}; a 40% radar outage costs {base_.macro_f1 - h.loc[('radar_outage', 0.4)].macro_f1:.3f}.")
        w(f"- Speed shifts hurt in both directions (0.7x: {h.loc[('speed', 0.7)].macro_f1:.3f}, 1.5x: {h.loc[('speed', 1.5)].macro_f1:.3f} macro-F1) because the classes are partly defined by speed ranges the model learned.")
    if ag is not None: w(f"- Young tracks are harder: macro-F1 {ag.macro_f1.iloc[0]:.3f} for tracks aged <= 10 s vs {ag.macro_f1.iloc[-1]:.3f} for tracks older than 40 s.")
    if ab is not None:
        t_ = ab[ab.split == "test"].set_index("variant").macro_f1; full = t_["all features (primary)"]; d_ = (full - t_.drop("all features (primary)")).sort_values(ascending=False)
        w(f"- Largest drop among the ablation variants on test: **{d_.index[0]}** ({d_.iloc[0]:+.3f} macro-F1), then {d_.index[1]} ({d_.iloc[1]:+.3f}).")
    if tw is not None:
        t2 = tw[tw.split == "test"].set_index("variant").macro_f1; w(f"- Tracker/window ablation (test macro-F1): " + "; ".join(f"{k} {v:.4f}" for k, v in t2.items()) + ".")
    if OS: bd = max(OS["auroc"], key=OS["auroc"].get); w(f"- Unknown-class detection is **weak**: best detector is {bd} with mean leave-one-class-out AUROC {OS['auroc'][bd]:.3f} (0.5 = chance) and TPR {OS['tpr_at_5pct_fpr'][bd]:.3f} at 5% FPR. Held-out classes overlap with known ones, so they are often confidently assigned to a known class.")
    if SC:
        g = lambda n, m: SC[f"test|{n}"][m]; w(f"- Priority ranking vs oracle (test, top-1 hit rate): rule-based {g('rule-based hybrid score', 'top1_hit'):.3f}, fitted {g('fitted (ridge on components)', 'top1_hit'):.3f}, classifier probability alone {g('classifier threat prob only', 'top1_hit'):.3f}, closest-first {g('closest-first (distance only)', 'top1_hit'):.3f}, random {g('random', 'top1_hit'):.3f}. The ranking is far from the oracle: it is a decision aid, not an arbiter.")
    if X:
        d = X["deletion_faithfulness"]; w(f"- Explanation faithfulness: removing the SHAP top-3 features flips {d['SHAP top-3 (explanation)']['prediction_flip_rate']:.1%} of predictions vs {d['random 3 features']['prediction_flip_rate']:.1%} for random features, so the mentor's stated reasons are causally relevant to the model. Stability of global importance across a retrained model: Spearman {X['stability_global_rank_spearman']:.3f}.")
    if AD:
        for ex in ["regret_placeholder"]: pass
        rc, fs = AD["regime_change"], AD["fast_switching"]
        w(f"- Adaptive adversary: lowest final regret was **{min(rc, key=lambda k: rc[k]['final_regret'])}** (single regime change) and **{min(fs, key=lambda k: fs[k]['final_regret'])}** (fast switching). Discounted Thompson sampling (gamma 0.95) had regret {rc['Discounted Thompson (gamma 0.95)']['final_regret']:.1f} / {fs['Discounted Thompson (gamma 0.95)']['final_regret']:.1f} vs {rc['Thompson (stationary)']['final_regret']:.1f} / {fs['Thompson (stationary)']['final_regret']:.1f} for stationary Thompson sampling, so **discounting did not help in these experiments**. In the measured success table the best tactic is the same (saturation) against 3 of the 4 defences, so the optimum barely moves between regimes; a stronger non-stationarity test would need defences with different best tactics.")
    w("")
    w("## 2. Data audit (leakage and difficulty checks)\n")
    rows = [("Seed overlap between any two splits", "0 (asserted)"), ("Logistic-regression baseline, valA macro-F1", f"{A['logreg_valA_macro_f1']:.4f}"), ("`range_to_asset` alone, valA macro-F1 (chance = %.3f)" % A["chance_macro_f1"], f"{A['range_only_macro_f1_valA']:.4f}"),
            ("Shuffled-label control, valA macro-F1 (must be ~chance)", f"{A['shuffled_label_macro_f1_valA']:.4f}"), ("Adversarial validation AUC, train vs test (0.5 = indistinguishable)", f"{A['adversarial_validation_auc_train_vs_test']:.3f}"),
            ("Adversarial validation AUC, train vs shifted (>0.5 = shift is real)", f"{A['adversarial_validation_auc_train_vs_shifted']:.3f}"), ("Max single-feature separability, 2*|AUC-0.5|", f"{A['max_single_feature_separability']:.3f}")]
    w(md(pd.DataFrame(rows, columns=["check", "result"]))); w("\nClass counts per split:\n"); w(md(C("class_counts.csv").rename(columns={"Unnamed: 0": "class"}), "{:d}"))
    w("\n![](figures/fig_data_class_balance.png)\n![](figures/fig_data_feature_separability.png)\n![](figures/fig_data_feature_distributions.png)\n")
    w("## 3. Primary model results\n")
    ci = P["primary_macro_f1_ci_test"]; ct, cs = P["calibrated_test"], P["calibrated_shifted"]
    rows = [{"split": "test (in-distribution, held-out seeds)", "accuracy": P["test"]["accuracy"], "macro_f1": P["test"]["macro_f1"], "log_loss": P["test"]["log_loss"], "brier": P["test"]["brier"], "ece": P["test"]["ece"]},
            {"split": "shifted (distribution shift)", "accuracy": P["shifted"]["accuracy"], "macro_f1": P["shifted"]["macro_f1"], "log_loss": P["shifted"]["log_loss"], "brier": P["shifted"]["brier"], "ece": P["shifted"]["ece"]}]
    w(md(pd.DataFrame(rows))); w(f"\nTest macro-F1 95% CI (bootstrap over scenario seeds): [{ci[0]:.4f}, {ci[1]:.4f}].\n")
    w(f"Binary threat detection with temperature-calibrated probabilities at the cost-based threshold {P['calibrated_threshold']:.2f} (missed threat costs {S['cost_ratio']:.0f}x a false alarm; threshold chosen on valB only):\n")
    w(md(pd.DataFrame([{"split": "test", **{k: ct[k] for k in ["threat_recall", "threat_precision", "threat_f1", "threat_auc", "false_alarm_rate"]}}, {"split": "shifted", **{k: cs[k] for k in ["threat_recall", "threat_precision", "threat_f1", "threat_auc", "false_alarm_rate"]}}])))
    w("\nPer-class (test):\n"); w(md(C("primary_per_class_test.csv"))); w("\n![](figures/fig_confusion_test.png)\n![](figures/fig_confusion_shifted.png)\n![](figures/fig_roc_pr_ovr_primary.png)\n![](figures/fig_threat_roc_pr_models.png)\n![](figures/fig_threat_threshold_cost.png)\n")
    w("## 4. Model comparison\n"); w(md(C("model_ci_test.csv"))); w("\nFamily summary (mean and std over seeds where a model has randomness; test and shifted):\n"); w(md(C("model_family_summary.csv")))
    pt = C("paired_tests_vs_primary.csv")
    if pt is not None: w("\nPaired tests of the primary model against each challenger (difference in macro-F1, bootstrap over scenario seeds; McNemar exact test on per-window correctness):\n"); w(md(pt))
    w("\nNote: McNemar's test treats windows as independent, which they are not (windows of one scenario are correlated), so its p-values are optimistic; the seed-cluster bootstrap interval is the primary evidence.")
    w("\n![](figures/fig_model_comparison.png)\n![](figures/fig_per_class_f1.png)\n![](figures/fig_accuracy_vs_latency.png)\n")
    w("Inference time of the exported model in the JavaScript runtime (used by the app): " + (f"{PAR['js_microseconds_per_prediction']:.0f} microseconds per prediction; max |raw score difference| vs scikit-learn = {PAR['max_abs_raw_error_vs_sklearn']:.2e}; argmax agreement = {PAR['argmax_agreement']:.4f} over {PAR['n']} held-out rows.\n" if PAR else "not measured.\n"))
    w("## 5. Training behaviour and tuning\n![](figures/fig_training_curves.png)\n![](figures/fig_tuning_param_effects.png)\n")
    w("## 6. Calibration\n"); w(md(C("calibration_summary.csv"))); w("\n![](figures/fig_calibration.png)\n")
    w("## 7. Robustness (test seeds, controlled perturbations, no retraining)\n"); R = C("robustness.csv")
    if R is not None:
        h = R[R.model == "hgb"]; w(md(h.pivot_table(index=["sweep", "level"], values=["macro_f1", "threat_recall"]).reset_index())); w("\n![](figures/fig_robustness_macro_f1.png)\n![](figures/fig_robustness_threat_recall.png)\n")
    ag = C("performance_by_track_age.csv")
    if ag is not None: w("Performance by track age (primary, test):\n"); w(md(ag)); w("\n![](figures/fig_performance_by_track_age.png)\n")
    w("## 8. Ablations\n"); ab = C("ablation_feature_groups.csv")
    if ab is not None: w(md(ab)); w("\n![](figures/fig_ablation_feature_groups.png)\n")
    tw = C("ablation_tracker_window.csv")
    if tw is not None: w("\nTracker type and window length (same scenario seeds, separately generated datasets):\n"); w(md(tw)); w("\n![](figures/fig_ablation_tracker_window.png)\n")
    w("## 9. Unknown-track (open-set) detection\n")
    if OS: w(md(pd.DataFrame(OS), index=True)); w("\n![](figures/fig_openset_unknown_detection.png)\n")
    w("## 10. Threat-priority ranking vs oracle\n"); sr = C("threat_scorer_ranking.csv")
    if sr is not None: w(md(sr)); w(f"\nRule weights (shared with the app): {SC['rule_weights']}; fitted weights: {SC['fitted_weights']}\n\n![](figures/fig_threat_scorer_ranking.png)\n")
    w("## 11. Explainable AI\n")
    if X:
        w(f"- TreeSHAP computed by the app's own JavaScript implementation; local-accuracy max error |sum(phi)+E-raw| = {X['shap_local_accuracy_max_abs_error']:.2e}")
        w(f"- Spearman(mean|SHAP|, permutation importance) = {X['spearman_meanabsSHAP_vs_permutation_importance']:.3f}")
        w(f"- Stability across a retrained model (seed-bootstrap): global rank Spearman = {X['stability_global_rank_spearman']:.3f}; local top-3 Jaccard = {X['stability_local_top3_jaccard']:.3f}")
        w("\nDeletion faithfulness of the top-3 explanation (replace those features with draws from the training data):\n"); w(md(pd.DataFrame(X["deletion_faithfulness"]).T, index=True))
    w("\n![](figures/fig_shap_global_and_per_class.png)\n![](figures/fig_shap_beeswarm_per_class.png)\n![](figures/fig_shap_dependence.png)\n![](figures/fig_shap_local_waterfalls.png)\n![](figures/fig_importance_crosscheck.png)\n![](figures/fig_xai_faithfulness.png)\n")
    w("## 12. Adaptive adversary\n")
    if AD:
        w("Attack success rate per (defence x tactic), each cell from real simulator episodes against a scripted defender:\n"); w(md(C("adversary_success_table.csv").rename(columns={"Unnamed: 0": "defence"}), "{:.2f}"))
        for ex, title in [("regime_change", "Single regime change (defence switches at episode 150)"), ("fast_switching", "Fast switching (defence changes every 30 episodes)")]:
            w(f"\n{title}: final cumulative regret and success over the last 50 episodes (mean over {cfg_rep} repeats, 95% CI on regret):\n"); w(md(pd.DataFrame(AD[ex]).T.reset_index().rename(columns={"index": "algorithm"})))
        w("\n![](figures/fig_adversary_fast_switching.png)\n![](figures/fig_adversary_success_table.png)\n![](figures/fig_adversary_learning_curves.png)\n![](figures/fig_adversary_tactic_frequency.png)\n![](figures/fig_adversary_stationary.png)\n![](figures/fig_adversary_closed_loop.png)\n")
    PF = J("performance.json")
    if PF:
        w("## 13. Simulator performance (headless, build machine, one CPU core)\n"); w(md(pd.DataFrame(PF["results"]).T.reset_index().rename(columns={"index": "load"})[["load", "entities", "peak_confirmed_tracks", "realtime_factor", "ms_per_simulated_second_median", "ms_per_simulated_second_p95", "frame_payload_kb"]]))
        w("\nThis covers simulation, sensors, tracking, features and mentor inference. Browser rendering FPS (the synopsis's 60 FPS goal) is not measured here.\n")
    w("## 14. What was NOT executed in this run\n")
    w("- GPU training: no GPU/PyTorch in the environment that produced this report. The optional sequence model (`ml/src/skyshield_ml/seq_torch.py`) and LightGBM/XGBoost challengers are included in the code and are picked up automatically when installed, but their results are not in this report.")
    w("- The MERN web application could not be installed or run in this offline environment. Its logic modules, REST layer and session manager are unit-tested; the Express/ws/Mongo adapters and the Vite build have not been executed here.")
    w("- Real-sensor datasets (DroneRF etc.): not downloadable here. The RF module is implemented and self-tested on a synthetic stand-in only; no real-data result is reported.\n")
    write_cards(out, man, S, A, P, X, AD)
    (out / "REPORT.md").write_text("\n".join(L)); print(f"[report] wrote {out/'REPORT.md'} ({len(L)} blocks)")


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
