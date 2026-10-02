# Phase A summary

Completed Phase A only. Applied the coordinator-selected Opus findings before commit. `docs/DESIGN.md` and `docs/REVIEW_OPUS_DESIGN.md` are reviewer-authored and were not edited by Codex.

Files: `engine/` shared renderer/storage/ported skin; `schema/survey.schema.json`; `tools/{validate,convert-reference,preview,mock-submit}.mjs`; two `surveys/*/survey.json` files and reference conversion inputs under `source/`; `tests/` with golden payload, CDP browser suite, saved live baseline and PNG comparison; README, content schema, Codex design notes and this summary.

Commands executed: reference converter; validator for both contents; `npm run test:live-baseline` equivalent (`node tests/preview-check.mjs --live-baseline`, once, approved GET-only); `npm test`; content/safety scan; `git diff --check`. No dependency installation required.

Detached local preview commands (coordinator-approved alternate ports):

```sh
PREVIEW_PORT=18790 COLLECTOR_PORT=18791 nohup node tools/preview.mjs > _preview/static.log 2>&1 &
PREVIEW_PORT=18790 COLLECTOR_PORT=18791 nohup node tools/mock-submit.mjs > _preview/mock.log 2>&1 &
```

URLs:

- http://127.0.0.1:18790/surveys/adora-ship-visit-001/
- http://127.0.0.1:18790/surveys/sample-survey/
- Local mock: http://127.0.0.1:18791/submit

Tests: **PASS**, 28 validation/storage/content checks and 7 browser checks, no failures in the final full run.

| Check | Result |
|---|---|
| Strict schema, negative fixtures, identity allowlist, invalid CLI exit | PASS |
| Real reference content parity, reproducible conversion, golden payload | PASS |
| Remote submission refusal, malformed CSS token regression | PASS |
| Mobile 390×844, category required/selected, no horizontal overflow | PASS |
| Untouched/moved slider, NA | PASS |
| Required text, character cap/counter, Back/Next persistence | PASS |
| Local submit, exact raw request storage, legacy keys/defaults | PASS |
| Sample alternate scale, single/multiple choice, standard payload | PASS |
| Nested prefix/index.html route | PASS |
| Offline comparison, no uncaught exceptions/console errors/external requests | PASS |
| Safety scan and whitespace checks | PASS |

Visual diff against saved live baseline, DPR 1, exact RGB comparison (zero channel tolerance):

| Capture | Dimensions | Difference | Height delta |
|---|---|---|---|
| Intro viewport | 390×844 | 0.00% | 0 |
| Survey viewport | 390×844 | 0.00% | 0 |
| Full intro | 390×1327 | 0.00% | 0 |
| Full survey | 390×6472 | 0.00% | 0 |

Evidence: `_preview/local-*.png`, `_preview/live-*.png`, `_preview/diff-*.png`, `_preview/visual-diff.json`, `_preview/test-results.json`. Baselines and their source metadata are checked in at `tests/baseline/adora/`. Raw synthetic submissions are at `_preview/mock-responses.jsonl`; no report UI exists yet.

Shortest new-content path: copy sample survey.json to a new matching surveyId folder, edit content, validate, visit `/surveys/<id>/`. Example: `{"id":"Q05","type":"text","prompt":"개선 의견","required":true,"linkedScores":["Q01"]}`.

Open issues are explicitly deferred to Phase B in DESIGN_CODEX_NOTES: semantic/mixed theme isolation; richer message overrides and validation; production adapters, collector/server close, report authorization/statistics, XLSX, QR/Kakao, intake and deploy dry-run. The required final reference text question invites an optional name; its ID alone is allowlisted. The mock is test-only. Baseline is Chrome/Kakao-UA emulation, not a physical in-app browser. Browser CLI unavailable; approved built-in CDP fallback used.

No remotes added, push, public deployment, account creation, payment or real Google Form submission. Original 8790/8791 tunnel processes were not modified. Phase B not started.

GPT: no
