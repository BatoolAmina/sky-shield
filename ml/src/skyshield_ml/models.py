"""Model zoo. All models share the scikit-learn API. LightGBM / XGBoost challengers are added automatically when installed."""
from __future__ import annotations
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from .common import CAT


def preproc(features):
    num = [f for f in features if f not in CAT]; cat = [f for f in features if f in CAT]
    tr = [("num", StandardScaler(), num)]
    if cat:
        tr.append(("cat", OneHotEncoder(handle_unknown="ignore"), cat))
    return ColumnTransformer(tr)


def make_lr(features, seed=0):
    return Pipeline([("pre", preproc(features)), ("clf", LogisticRegression(C=1.0, penalty="l2", class_weight="balanced", max_iter=500, random_state=seed))])


def make_rf(features, seed=0, n=150):
    return RandomForestClassifier(n_estimators=n, min_samples_leaf=3, class_weight="balanced_subsample", n_jobs=-1, random_state=seed)


def make_hgb(params=None, seed=0, max_iter=200):
    p = dict(learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0, max_features=0.8)
    p.update(params or {})
    return HistGradientBoostingClassifier(max_iter=max_iter, class_weight="balanced", early_stopping=False, random_state=seed, **p)


def make_mlp(features, seed=0):
    """3 hidden layers (256,128,64), ReLU, Adam lr 1e-3, weight decay 1e-4, batch 256. Epoch loop with validation-based early stopping is in train.py."""
    return Pipeline([("pre", preproc(features)), ("clf", MLPClassifier(hidden_layer_sizes=(256, 128, 64), activation="relu", solver="adam", alpha=1e-4, batch_size=256,
                                                                      learning_rate_init=1e-3, max_iter=1, random_state=seed, warm_start=False))])


def optional_challengers(seed=0):
    out = {}
    try:
        import lightgbm as lgb
        out["lightgbm"] = lgb.LGBMClassifier(learning_rate=0.05, n_estimators=400, num_leaves=31, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, min_child_weight=5,
                                             reg_lambda=1.0, class_weight="balanced", random_state=seed, n_jobs=-1, verbose=-1)
    except Exception:
        pass
    try:
        import xgboost as xgb
        out["xgboost"] = xgb.XGBClassifier(learning_rate=0.05, n_estimators=400, max_depth=6, subsample=0.8, colsample_bytree=0.8, min_child_weight=5, reg_lambda=1.0,
                                           tree_method="hist", random_state=seed, n_jobs=-1)
    except Exception:
        pass
    return out


def sample_weights(y):
    """Balanced sample weights (used for challengers that lack class_weight)."""
    cls, cnt = np.unique(y, return_counts=True); w = {c: len(y) / (len(cls) * n) for c, n in zip(cls, cnt)}
    return np.array([w[v] for v in y])
