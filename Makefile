# Convenience targets (Linux/macOS/WSL). On Windows use: python scripts/run_pipeline.py
all:        ; python scripts/run_pipeline.py
quick:      ; python scripts/run_pipeline.py --quick
gpu:        ; python scripts/run_pipeline.py --skip-datagen --with-gpu
test:       ; npm run test:sim && npm run test:server && npm --workspace apps/web test
server:     ; npm run server
web:        ; npm run web
