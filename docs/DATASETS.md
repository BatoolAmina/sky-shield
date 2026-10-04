# Datasets

## What the core project needs: nothing to download
The simulator **generates** all training, validation and test data (`apps/datagen`). The generator is deterministic: the same master seed reproduces the same dataset
byte for byte on any machine (the manifest stores determinism hashes you can compare). This is the dataset every shipped result is computed on.

## Optional real-sensor dataset for the RF module: DroneRF (verified)
* **DroneRF**, Mendeley Data, DOI **10.17632/f4c2b4n755.1** (authors: Allahham, Al-Sa'd, Al-Ali, Mohamed, Khattab, Erbad).
* RF activities of 3 commercial drones (Bebop, AR, Phantom) plus background RF; 227 segments; files are named like `10000L_0.csv` / `10000H_0.csv`
  (the `L` and `H` halves of the captured band); the full dataset is **larger than 40 GB**.
* Check the licence on the Mendeley page before use and cite the dataset and its paper.
* Use: `python -m skyshield_ml.rf_module --root /path/to/DroneRF --out results/rf_real`. It extracts spectral features per window, splits **by segment** (never by window)
  and trains detection (drone vs background) and identification (background/Bebop/AR/Phantom) models.
* **Verify the file naming against your download.** The parser follows the naming rule described by the dataset authors but was only exercised on a synthetic
  stand-in (`python -m skyshield_ml.rf_module --selftest`). No real-data result is shipped.

## Other public datasets (not used by this build, listed for future work; I could not verify them offline, so check availability and licences yourself)
* Video bird-vs-drone detection (e.g. the Drone-vs-Bird challenge data) and RGB/IR anti-UAV tracking datasets (e.g. Anti-UAV) would be the natural source for an
  EO/vision classifier that replaces the simulator's simulated EO "hint". They need a GPU object-detection model and are outside the scope of this build.
* Other RF datasets (e.g. DroneDetect) could be adapted through `rf_module.py`'s feature extraction if you write a parser for their file format.

## Why synthetic data is the right base here
Real labelled radar tracks of hostile drones are not public. The simulator makes the *training environment* (adversary behaviour, scenario events, sensor failures)
controllable and reproducible, which is what a decision-training system needs. What it cannot do is prove real-world accuracy.
