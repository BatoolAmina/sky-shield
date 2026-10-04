Datasets are generated, not downloaded. Regenerate (deterministic, ~2 min):
  node apps/datagen/src/cli.js --out data/v1 --seeds 1200 --shifted 150 --sequences --robustness
or run `python scripts/run_pipeline.py`. `sample/` holds the manifests (with determinism hashes to compare against) and the first 2000 training rows.
