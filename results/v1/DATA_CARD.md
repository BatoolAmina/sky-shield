# Data card: SkyShield synthetic track dataset

Dataset `v1`, generator `skyshield-sim-core@1.0.0`, tracker `kf`, window 15 s, stride 3 s, master seed 20260101. Fully regenerable: determinism hashes for seeds 1-3 are `['7472666f', '997eeecd', 'b421bed6']`.

## Procedure
1. Per scenario seed, a random composition of 2-4 threat groups, bird flocks, and friendly/civil traffic is spawned (class parameter ranges overlap on purpose: slow drones vs birds, low drones vs helicopters).
2. The same flight code as the live game moves every object; radar (clutter, shadowing, outages), RF, EO and IFF models produce noisy detections; a Kalman tracker with nearest-neighbour association and M-of-N confirmation builds tracks.
3. Every 3 s, each confirmed track yields one window of 26 features computed from the perceived track only. Labels come from the dominant ground-truth object in the window.
4. Splits are by scenario seed (train 70 / val 15 split into valA for tuning and valB for calibration / test 15); a separate shifted set uses a different parameter distribution.

## Splits
Seeds: {'train': 840, 'valA': 90, 'valB': 90, 'test': 180, 'shifted': 150}; windows kept: {'train': 118009, 'valA': 11347, 'valB': 12462, 'test': 24954, 'shifted': 21914}.
Windows excluded from the 7-class task (mixed ground truth or clutter): {'train': {'mixed': 34305, 'clutter': 2}, 'val': {'mixed': 8720, 'clutter': 2}, 'test': {'mixed': 7904}, 'shifted': {'mixed': 14269, 'clutter': 12}}. That is 25.7% of all generated windows; most are `mixed` (track swaps inside tight flocks), which is realistic but reduces usable data.

## Features
- `speed_mean`: mean 3-D speed over the window (m/s)
- `speed_std`: speed variability
- `alt_mean`: mean altitude (m)
- `alt_std`: altitude variability
- `vert_rate_abs`: mean absolute vertical rate
- `heading_rate_abs`: mean absolute heading change (deg/s)
- `curvature`: heading change per metre travelled
- `radial_rate`: slope of range to the asset (m/s, negative = closing)
- `range_to_asset`: current range (m)
- `cpa_dist`: closest point of approach (m)
- `time_to_cpa`: time to closest approach (s, 300 = receding)
- `heading_to_asset_cos`: cosine of angle between velocity and direction to asset
- `rcs_mean`: noisy radar cross-section estimate (dB)
- `rcs_std`: RCS variability
- `rf_frac`: fraction of window with RF emission associated
- `rf_sig`: RF signature id (-1 = none)
- `iff_frac`: fraction of window with transponder replies
- `eo_drone_frac`: fraction with camera hint = drone
- `eo_bird_frac`: fraction with camera hint = bird
- `eo_air_frac`: fraction with camera hint = aircraft
- `n_sensor_types`: number of sensor types that saw the track
- `track_age`: seconds since track birth
- `fusion_conf`: fused track confidence 0-1
- `hit_rate`: radar hit rate in the window
- `group_count`: nearby tracks moving alike
- `group_score`: group-motion similarity 0-1

## Audit results (see REPORT.md section 2)
- Seed overlap between splits: 0. Range-only macro-F1 0.116 (chance 0.143). Shuffled-label macro-F1 0.065. Adversarial-validation AUC train-vs-test 0.483, train-vs-shifted 0.880.

## Known issues
- Classes are not exactly balanced; balanced class weights are used in training instead of resampling.
- Clutter tracks are rarely confirmed, so the `unknown` class is not represented in the data; unknown-track detection is evaluated by leaving classes out.
- All parameters (ranges, noise, zones) are illustrative.