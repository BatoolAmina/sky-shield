# Coverage of the synopsis (SIH26247): what is built, what is partial, what is not

Status: **Done** = implemented and exercised by tests or by the pipeline run; **Partial** = implemented with a stated deviation; **Not built** = outside this build (most are marked long-term in the synopsis itself).

## Part I / II: features and design

| Synopsis item | Status | Notes |
|---|---|---|
| Seed-reproducible simulator, truth vs perceived separation (§7, §11, §25) | Done | 20 Hz fixed step, independent PRNG streams; replay from (seed, action log) tested; a test asserts no truth leaks into the trainee payload |
| 7 object classes with overlapping ranges, hard negatives (§22) | Done | helicopters, drones with RF off, flocks vs swarms, bird-vs-slow-drone overlap |
| Feature set over 10-20 s window, group score (§22) | Done | 26 features, 15 s window; window-length ablation 8/15/25 s |
| Generation procedure, seed-wise 70/15/15 split, shifted set, versioning, manifest (§22) | Done | valA/valB split of validation (tuning vs calibration) |
| Class-balanced set (§22) | Partial | classes are roughly but not exactly balanced; balanced class weights are used instead of resampling |
| Dataset size (§22/§28) | Done | 253,900 windows generated across all splits, 188,686 kept for the 7-class task (25.7% dropped as mixed or clutter, see DATA_CARD) |
| Unknown label (§22) | Partial | clutter tracks are almost never confirmed, so the `unknown` class has almost no samples; unknown handling = Isolation Forest / entropy evaluation by leaving classes out, plus an "unknown-like" flag and an Unknown button for trainees |
| Radar / RF / EO sensor models (§25) | Partial | have range limits, noise, update rates, clutter, shadowing, false alarms, outages. Missing: explicit detection delay, EO field-of-view, RF jamming effect, terrain masking (full version) |
| Kalman and alpha-beta tracker, NN association (§23) | Done | tracker ablation included; IMM and Hungarian are full-version items |
| Logistic regression, tree classifier, MLP (§23) | Partial | LR and MLP as specified in spirit, but the MLP is scikit-learn (no dropout / batch-norm / cosine schedule). Primary tree model is scikit-learn HistGradientBoosting, not LightGBM/XGBoost (those join the comparison automatically if installed). Tuning used 24 random-search trials, not 50-100 Optuna trials |
| Calibration (isotonic, temperature) (§23) | Done | both compared; temperature used |
| Sequence model 1D-CNN/GRU (full version) | Not run | code in `seq_torch.py`, never executed (no GPU/PyTorch available when built) |
| Hybrid threat scorer, rule-based then fitted (§23) | Done | rule weights shared by JS and Python (tested equal); fitted version evaluated |
| Isolation Forest, 200 trees, contamination 0.05 (§23) | Partial | evaluated offline (leave-one-class-out); not exported into the live app (the app uses a confidence-based unknown flag instead) |
| SHAP top-3 template sentences (§23) | Done | own TreeSHAP in JS, verified against brute-force Shapley values |
| Mentor: class, threat score, **recommended action**, reason (§9, §10) | Done | action comes from a deterministic rule layer above the ML output |
| Elo rating K = 32 (§23) | Done | |
| Rating adjusts spawn count, noise, false alarms, time pressure (§23) | Partial | rating scales noise, clutter and number of distractor arrivals; "time pressure" is only via extra arrivals; scenario recommendation by rating added |
| Template after-action narrative (§23) | Done | LLM polish not built (optional) |
| Adversary: FSM, boids 1.5/1.0/1.0, Thompson bandit gamma 0.95 (§24) | Done | sliding-window variant not built |
| PPO / MAPPO adversary (§24 layer D, month 7) | Not built | synopsis marks it long-term and says cut it first if time is short |
| Scenario engine with branches and injectable events (§11, §25) | Done | 6 scenarios incl. a conditional second wave and an adaptive-adversary scenario |
| Effects model: probability by drone type, range, timing; ROE; collateral (§25) | Done | abstract only |
| Scoring: detection time, accuracy, false alarms, missed threats, response appropriateness, asset outcome (§9) | Partial | "response appropriateness" is captured through ROE denials, collateral and outcome, not as a separate score |
| Track management: classify threat / non-threat / unknown, set priority (§9) | Done | prioritisation is scored by rank correlation with an oracle urgency |
| Trainee view: tactical display, track list, sensor panels, mentor, controls, live score (§12) | Done | sensor status plus per-track RF / transponder / camera chips |
| Instructor view: scenario selection, live monitoring, injection, difficulty, sensor failures (§9, §12) | Done | |
| Scenario configuration panel: site, threat type, visibility, seed (§9) | Partial | seed, visibility and noise via instructor options; single site; threat composition fixed per scenario (scenario editor is month 8) |
| Briefing screen with mission, assets, ROE (§13) | Done | |
| Roles trainee / instructor / admin, authentication (§12) | Done | admin needs `ADMIN_CODE` |
| Session records, replay with speed-up and pause (§12) | Done | decision-by-decision timeline in the review |
| Browser-only prototype with local storage (§21 "prototype cut") | Not built | this build is server-authoritative so the trainee cannot see ground truth in dev tools |
| FastAPI model service / ONNX (§21) | Not built | model is exported as JSON trees and run in JavaScript (parity-tested against scikit-learn) |
| MongoDB (§21) | Partial | Mongoose store written; never run against a live MongoDB; in-memory/JSON fallback is what was tested |
| Classification about once per second per track (§21) | Done | |
| Evaluation protocol (§26): macro F1, per-class, confusion, calibration/ECE, latency, robustness, ablations, adversary curves, model card | Done | model card and data card are generated from the metric files |
| Experiment tracking (§26) | Partial | CSV/JSON logs instead of MLflow / W&B |
| Optional RF module on public data (§22, month 8) | Partial | DroneRF loader and models written; only self-tested on synthetic stand-in files |
| Vision module (YOLO fine-tuning) (§23, month 8) | Not built | |
| Pilot study, SUS survey (§26, month 9) | Not built | cannot be simulated and I did not fabricate one |
| 30 simultaneous tracks at 60 FPS (§27) | Partial | simulation + fusion + mentor cost measured for 30 / 50 / 80 objects (REPORT section 13); browser rendering FPS not measured |
| Same seed gives identical replay (§27) | Done | |

## Not executed in the build environment
GPU training and PyTorch code, LightGBM/XGBoost, the Vite build, Express/`ws`/MongoDB adapters, browser play-through, DroneRF on real files.
