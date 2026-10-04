# Model card: SkyShield track classifier (mentor)

Generated from the saved metric files of this run. All data are synthetic.

## Intended use
Decision support inside a training simulator: suggests a class, a threat probability and (through a deterministic rule layer) an action, with a template explanation. **Not** for real-world engagement or surveillance decisions.

## Model
- scikit-learn HistGradientBoostingClassifier, 1582 trees (226 iterations x 7 classes), params `{'learning_rate': 0.0630637181214231, 'max_leaf_nodes': 15, 'min_samples_leaf': 181, 'l2_regularization': 1.1357879676668987, 'max_features': 0.8115935723430212}`, balanced class weights.
- Calibration: temperature scaling, T = 1.053, fitted on a seed-disjoint validation split (valB). Threat threshold 0.15 (miss:false-alarm cost 5:1, chosen on valB). Unknown-likeness threshold: max class probability below 0.829 (5th percentile on valB).
- Inputs: 26 features from the perceived track over a 15 s window (no ground truth). Outputs: 7-class probabilities, threat probability, SHAP-based explanation.

## Training and evaluation data
Synthetic, simulator version `skyshield-sim-core@1.0.0`, dataset `v1`. Windows: {'train': 118009, 'valA': 11347, 'valB': 12462, 'test': 24954, 'shifted': 21914}. Splits are by scenario seed. Evaluation uses held-out test seeds and a separately generated shifted-distribution set.

## Performance (measured on synthetic data)
- Test: macro-F1 0.9683 (95% CI 0.9620 to 0.9743), accuracy 0.9698, ECE 0.0055.
- Threat detection at the chosen threshold: recall 0.9958, precision 0.9655, false-alarm rate 0.0465.
- Shifted distribution: macro-F1 0.9102; threat recall 0.9896; false-alarm rate 0.1047.
- See REPORT.md for per-class results, robustness sweeps (notably RF loss), ablations, calibration and explanation faithfulness.

## Known limitations
- Synthetic distribution only; class ranges overlap by design but real sensors will differ.
- Strong reliance on RF emission and transponder features: losing RF sharply reduces threat recall (see robustness table).
- Unknown-class detection is weak (see open-set table); the unknown flag is a coarse confidence heuristic.
- Young tracks (< 10 s) are classified less reliably.
- Illustrative zones and response effectiveness; needs expert validation before any claim about real operations.

## Explanations
TreeSHAP computed by the app's own JavaScript implementation (local accuracy error 3.2e-14). Removing the top-3 explanation features flips 69.8% of predictions vs 10.7% for random features.