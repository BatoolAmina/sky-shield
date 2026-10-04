# Architecture

```
                 +--------------- packages/sim-core (plain JS, deterministic) ---------------+
 scenario seed ->| world: flight dynamics, zones, events   adversary: FSM, boids, bandits     |
                 | sensors: radar, RF, EO, IFF  ->  tracker (KF / alpha-beta) -> fusion       |
                 | features (perceived data only) -> mentor model (trees) + TreeSHAP + threat |
                 | effects/ROE engine, scoring, Elo, after-action review, Session (replay)    |
                 +-----------+---------------------------------------+------------------------+
                             | headless                              | live
                  apps/datagen (CLI)                       apps/server (Express + ws)
                  CSV + manifest, seed-wise splits         auth, roles, session workers, REST
                             |                                       |            |
                  ml/ (Python): audit, tune, train,          MongoDB / JSON store   apps/web (React + Vite)
                  calibrate, evaluate, robustness, XAI,                              tactical display, mentor,
                  adversary plots, report                                            review, instructor console
                             |                                       ^
                             +------ results/v1/model/model.json ----+
```

**Server-authoritative sessions.** `Session` runs on the server. `perceived()` returns tracks, confidence and mentor output only. `frame()` (with truth) is used for the
instructor view and for the recorded replay, which is only served after a session finishes.

**Mentor model path.** Python trains a HistGradientBoosting model, calibrates it with temperature scaling, picks a cost-based threat threshold, and exports trees
(`feature, threshold, children, value, count`) to JSON. `TreeModel` (JS) evaluates it; `shapValues` computes path-dependent TreeSHAP; `explain` turns the top-3 SHAP features into a
template sentence. Parity with scikit-learn and SHAP local accuracy are checked in the pipeline.

**Adaptive adversary.** A discounted Thompson-sampling bandit chooses among five tactics (direct, flank, low altitude, decoy-and-split, saturation) per session for the adaptive
scenario; per-user bandit state is persisted. The evaluation compares it with uniform random, a fixed tactic, epsilon-greedy, UCB1 and stationary Thompson sampling under a regime change.

**API** (all JSON; Bearer JWT): `POST /api/auth/register|login`, `GET /api/me|scenarios|model|leaderboard|analytics (instructor)|sessions|sessions/live (instructor)`,
`POST /api/sessions {scenarioId}`, `GET /api/sessions/:id/report|replay`. WebSocket `/ws?token&session&mode=play|observe`: client sends
`{type:'action', action}`, `{type:'explain', trackId}`, `{type:'cmd', cmd:'pause|resume|speed|inject|defence|end'}`; server sends `frame`, `ack`, `explanation`, `ended`, `error`.

**Security.** scrypt password hashing, HS256 JWT with expiry, role checks, whitelist validation of every client action, request size limits, rate limiting on auth and WebSocket
messages, security headers, no ground truth in trainee payloads. Set `JWT_SECRET` and `INSTRUCTOR_CODE` before any shared deployment and put the app behind HTTPS.
