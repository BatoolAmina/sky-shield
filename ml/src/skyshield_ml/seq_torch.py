"""OPTIONAL GPU stage: 1D-CNN + GRU sequence classifier on the RAW per-second track windows (datagen --sequences), compared against the tree model.
Requires PyTorch (install the CUDA build from https://pytorch.org). Writes preds/seqnet_s<seed>.npz and registers the model in train_summary.json,
so evaluate.py includes it in every comparison automatically.   Run:  python -m skyshield_ml.seq_torch [config.yaml]
NOTE: this file was written and syntax-checked but NOT executed in the environment that produced the shipped results (no PyTorch / GPU there)."""
from __future__ import annotations
import sys, time
import numpy as np, pandas as pd
from .common import *
from .train import load_cfg

STATIC = ["group_count", "group_score", "track_age", "fusion_conf", "iff_frac", "rf_frac"]


def run(cfg_path="ml/configs/default.yaml", epochs=40, seeds=(0, 1, 2)):
    import torch, torch.nn as nn
    cfg = load_cfg(cfg_path); out = ROOT / cfg["out_dir"]; ddir = ROOT / cfg["data_dir"]; D = load_data(ddir); man = D["manifest"]
    if not man.get("seq_shape"): raise SystemExit("dataset was generated without --sequences")
    L, CH = man["seq_shape"]; dev = "cuda" if torch.cuda.is_available() else "cpu"; print(f"[seq] device={dev}")
    def seqs(name, df): raw = np.fromfile(ddir / f"{name}.seq.f32", dtype=np.float32).reshape(-1, L, CH); return raw[df.row_id.values]
    S = {k: seqs(k if k != "valA" and k != "valB" else "val", D[k]) for k in ["train", "valA", "valB", "test", "shifted"]}
    mu, sd = S["train"].reshape(-1, CH).mean(0), S["train"].reshape(-1, CH).std(0) + 1e-6; smu, ssd = D["train"][STATIC].mean().values, D["train"][STATIC].std().values + 1e-6
    prep = lambda k: (torch.tensor((S[k] - mu) / sd, dtype=torch.float32).transpose(1, 2), torch.tensor(((D[k][STATIC].values - smu) / ssd), dtype=torch.float32))

    class Net(nn.Module):
        def __init__(s):
            super().__init__(); s.cnn = nn.Sequential(nn.Conv1d(CH, 64, 3, padding=1), nn.GELU(), nn.Conv1d(64, 64, 3, padding=1), nn.GELU()); s.gru = nn.GRU(64, 64, batch_first=True)
            s.head = nn.Sequential(nn.Linear(64 + len(STATIC), 128), nn.GELU(), nn.Dropout(0.2), nn.Linear(128, 7))
        def forward(s, x, st):
            h, _ = s.gru(s.cnn(x).transpose(1, 2)); return s.head(torch.cat([h[:, -1], st], 1))
    ytr = torch.tensor(D["train"].y.values); w = torch.tensor(len(ytr) / (7 * np.bincount(ytr.numpy(), minlength=7)), dtype=torch.float32).to(dev)
    data = {k: prep(k) for k in S}; summ = json.loads((out / "metrics" / "train_summary.json").read_text())
    for seed in seeds:
        torch.manual_seed(seed); net = Net().to(dev); opt = torch.optim.AdamW(net.parameters(), 1e-3, weight_decay=1e-4); sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
        lossf = nn.CrossEntropyLoss(weight=w); Xs, Xt = [t.to(dev) for t in data["train"]]; best, bad, state = 1e9, 0, None; t0 = time.time(); curve = []
        for ep in range(epochs):
            net.train(); perm = torch.randperm(len(ytr), device=dev)
            for i in range(0, len(perm), 512):
                idx = perm[i:i + 512]; opt.zero_grad(); loss = lossf(net(Xs[idx], Xt[idx]), ytr.to(dev)[idx]); loss.backward(); opt.step()
            sched.step(); net.eval()
            with torch.no_grad(): va = net(*[t.to(dev) for t in data["valA"]]); vl = nn.functional.cross_entropy(va, torch.tensor(D["valA"].y.values).to(dev)).item()
            curve.append({"epoch": ep + 1, "val_loss": vl, "val_macro_f1": macro_f1(D["valA"].y.values, va.argmax(1).cpu().numpy())})
            if vl < best - 1e-4: best, bad, state = vl, 0, {k: v.clone() for k, v in net.state_dict().items()}
            else:
                bad += 1
                if bad >= 6: break
        net.load_state_dict(state); net.eval(); preds = {}
        with torch.no_grad():
            for k in ["valA", "valB", "test", "shifted"]: preds[k] = torch.softmax(net(*[t.to(dev) for t in data[k]]), 1).cpu().numpy()
        np.savez_compressed(out / "preds" / f"seqnet_s{seed}.npz", **preds); pd.DataFrame(curve).to_csv(out / "tables" / f"seqnet_curve_s{seed}.csv", index=False)
        summ["models"][f"seqnet_s{seed}"] = {"family": "seqnet", "seed": seed, "train_seconds": time.time() - t0, "ms_per_row_batch": 0.0, "ms_single_row": 0.0, "device": dev}
        print(f"[seq] seed {seed}: valA macro-F1 {curve[-1]['val_macro_f1']:.4f} ({time.time()-t0:.0f}s)")
    save_json(summ, out / "metrics" / "train_summary.json")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
