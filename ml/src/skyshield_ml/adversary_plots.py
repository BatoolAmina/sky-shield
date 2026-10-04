"""Stage 7: plots for the adaptive-adversary experiments (data from scripts/adversary_eval.js)."""
from __future__ import annotations
import numpy as np, pandas as pd
from .common import *
from .train import load_cfg


def smooth(x, w=15):
    x = np.asarray(x, float); k = np.ones(w) / w; return np.convolve(np.pad(x, (w // 2, w - 1 - w // 2), mode="edge"), k, mode="valid")


def run(cfg_path="ml/configs/default.yaml"):
    cfg = load_cfg(cfg_path); style(); out = ROOT / cfg["out_dir"]; J = json.loads((out / "metrics" / "adversary_eval.json").read_text()); T = J["tactics"]; res = J["results"]
    tab = pd.DataFrame(J["success_table"]).T[T]; tab.to_csv(out / "tables" / "adversary_success_table.csv")
    fig, ax = plt.subplots(figsize=(6, 3.6)); im = ax.imshow(tab.values, cmap="viridis", vmin=0, vmax=max(0.6, tab.values.max())); ax.grid(False); ax.set_xticks(range(len(T))); ax.set_xticklabels(T, rotation=25); ax.set_yticks(range(len(tab))); ax.set_yticklabels(tab.index)
    for i in range(tab.shape[0]):
        for j in range(tab.shape[1]): ax.text(j, i, f"{tab.values[i, j]:.2f}", ha="center", va="center", color="w" if tab.values[i, j] < 0.35 else "k")
    ax.set_title(f"Attack success rate by tactic x defence ({J['episodes_per_cell']} real sim episodes per cell)"); fig.colorbar(im); savefig(fig, out / "figures" / "fig_adversary_success_table.png")
    e = res["regime_change"]; fig, ax = plt.subplots(1, 3, figsize=(17, 4))
    for name, a in e["algos"].items(): ax[0].plot(smooth(a["mean_reward"]), label=name); ax[1].plot(a["cumulative_regret"], label=name)
    for a_ in ax[:2]: a_.axvline(150, c="k", ls="--", lw=.8); a_.set_xlabel("episode")
    ax[0].set_title("Adversary success rate (smoothed, mean of repeats)\nregime change at episode 150: low_blind -> north_heavy"); ax[0].set_ylabel("success"); ax[0].legend(fontsize=7); ax[1].set_title("Cumulative regret vs best tactic per regime")
    names = list(e["algos"]); fr = [e["algos"][n]["final_regret_mean"] for n in names]; ci = [e["algos"][n]["final_regret_ci95"] for n in names]; ax[2].barh(names, fr, xerr=ci, capsize=3); ax[2].set_title("Final cumulative regret (mean, 95% CI over repeats)"); savefig(fig, out / "figures" / "fig_adversary_learning_curves.png")
    fig, axs = plt.subplots(1, 3, figsize=(17, 3.8))
    for ax, n in zip(axs, ["uniform random", "Thompson (stationary)", "Discounted Thompson (gamma 0.95)"]):
        fq = np.array(e["algos"][n]["arm_freq"]); ax.stackplot(range(len(fq)), [smooth(fq[:, k], 9) for k in range(len(T))], labels=T); ax.axvline(150, c="k", ls="--", lw=.8); ax.set_title(f"Tactic selection frequency: {n}", fontsize=9); ax.set_xlabel("episode"); ax.set_ylim(0, 1)
    axs[0].legend(fontsize=7, loc="upper left"); savefig(fig, out / "figures" / "fig_adversary_tactic_frequency.png")
    fig, axs = plt.subplots(1, 3, figsize=(15, 3.6))
    for ax, key in zip(axs, ["stationary_low_blind", "stationary_capacity_limited", "stationary_balanced"]):
        r = res[key]["algos"]; ax.barh(list(r), [r[n]["last50_success"] for n in r]); ax.set_title(f"Success over last 50 episodes\n{key.replace('stationary_', 'vs ')}", fontsize=9)
    savefig(fig, out / "figures" / "fig_adversary_stationary.png")
    c = J["closed_loop"]; fig, ax = plt.subplots(1, 2, figsize=(12, 3.6))
    for n, v in c.items(): ax[0].plot(smooth(v["reward"], 21), label=n)
    ax[0].axvline(120, c="k", ls="--", lw=.8); ax[0].set_title("Closed loop against the REAL simulator (1 run)\nsuccess rate, window 21; regime change at 120"); ax[0].legend(fontsize=7); ax[0].set_xlabel("episode")
    arms = np.array(c["Discounted Thompson (gamma 0.95)"]["arms"]); ax[1].scatter(range(len(arms)), arms, s=8); ax[1].set_yticks(range(len(T))); ax[1].set_yticklabels(T); ax[1].axvline(120, c="k", ls="--", lw=.8); ax[1].set_title("Tactics chosen by discounted Thompson (closed loop)"); savefig(fig, out / "figures" / "fig_adversary_closed_loop.png")
    f = res["fast_switching"]; fig, ax = plt.subplots(1, 2, figsize=(14, 4))
    for name, a in f["algos"].items(): ax[0].plot(a["cumulative_regret"], label=name)
    for k in range(30, f["T"], 30): ax[0].axvline(k, c="k", ls=":", lw=.4)
    ax[0].set_title("Fast switching: defence changes every 30 episodes (dotted lines)\ncumulative regret vs best tactic per regime"); ax[0].set_xlabel("episode"); ax[0].legend(fontsize=6)
    nm = list(f["algos"]); ax[1].barh(nm, [f["algos"][n]["final_regret_mean"] for n in nm], xerr=[f["algos"][n]["final_regret_ci95"] for n in nm], capsize=3); ax[1].set_title("Fast switching: final cumulative regret (mean, 95% CI)"); savefig(fig, out / "figures" / "fig_adversary_fast_switching.png")
    sm = {ex: {n: {"final_regret": a["final_regret_mean"], "ci95": a["final_regret_ci95"], "last50_success": a["last50_success"]} for n, a in res[ex]["algos"].items()} for ex in ["regime_change", "fast_switching"]}
    save_json(sm, out / "metrics" / "adversary_summary.json"); print("[adversary]", {ex: {k: round(v["final_regret"], 1) for k, v in d.items()} for ex, d in sm.items()})


if __name__ == "__main__":
    import sys; run(sys.argv[1] if len(sys.argv) > 1 else "ml/configs/default.yaml")
