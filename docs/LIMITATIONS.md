# Limitations (read before citing any result)

1. **Synthetic data.** Every metric is on data from this simulator. Class parameter ranges overlap on purpose and a distribution-shifted test set and robustness sweeps are provided,
   but high accuracy on synthetic data does not imply real-world accuracy.
2. **Illustrative parameters.** Sensor models, zone radii, response effectiveness and rules of engagement are plausible but not calibrated to any real system.
3. **Windows are correlated.** Rows from one scenario are not independent. All splits are by scenario seed and all confidence intervals resample seeds, but the number of independent
   scenarios (not windows) is the real sample size.
4. **Dropped windows.** Windows whose dominant ground-truth id is mixed (track swaps inside flocks) or clutter are excluded from the 7-class task; counts are in the report.
5. **Adversary evaluation is trace-driven.** Bandit comparisons resample outcomes recorded from real simulator episodes against a scripted defender (plus one closed-loop run against the real simulator). A human defender will behave differently.
6. **Not executed in the build environment:** GPU training and PyTorch sequence model, LightGBM/XGBoost challengers, the Vite build, Express/ws/MongoDB adapters, and the real-data RF module on real files.
   They are written to be run on your machine; the report states exactly which results are missing.
7. **Not a weapons system.** The response layer is abstract (probabilities and delays). Do not use this software for real engagement decisions.
