# Review — final (Survey Factory @ 75d611b)

Reviewer: Opus 5.5 · 2026-10-02 · Scope: SPEC §18–20 (+§22), `sf-brief.md`, coordinator requirements, security rules, and the items from `docs/REVIEW_OPUS_DESIGN.md`.
Method: I read the code and ran `npm test` once (offline, ports 188xx). Result: **all suites PASS** (validate 25, browser 7, node:test 57/57 including the real `wrangler dev --local` + D1 path, flow 8, intake e2e 7). Visual diff against the stored live baseline is **0 %** on all four 390×844 captures (intro, survey, intro-full, survey-full). I edited no code.

## Verdict: **ready with conditions**

The engine, validator, collector, reports, distribution and dry-run deploy meet SPEC §18–20 and the coordinator requirements. Three conditions remain: M1 is a one-line fix. M2 matters only if Option 2 is used on `*.pages.dev`. M3 is an Owner decision that is due before 10/4.

## Findings

Legend: **MUST** = resolve before the first public deploy (or before the named option is used) · **SHOULD** = fix soon after · **NICE** = optional.

### MUST

1. **MUST — Worker test does not disable wrangler telemetry (hermeticity rule).** `tests/collector/worker.test.mjs:41` sets `XDG_CONFIG_WRANGLER_SEND_METRICS: 'false'`. This is a typo for `WRANGLER_SEND_METRICS`. The test also does not isolate `XDG_CONFIG_HOME`, so `wrangler dev --local` runs with the user's real wrangler config and its default metrics setting. On a networked machine this can send telemetry to Cloudflare during `npm test`, which breaks the rule "tests never hit external endpoints". `tests/flow-check.mjs:95` sets it correctly. Fix: copy the env from flow-check (`WRANGLER_SEND_METRICS:'false'`, temp `XDG_CONFIG_HOME`, `WRANGLER_LOG_PATH`). (I did not verify with a network capture. The typo itself is certain.)

2. **MUST (only if Option 2 uses `*.pages.dev`) — The engine refuses every collector submit from a `*.pages.dev` origin.** `engine/storage.js:13-14` treats `*.pages.dev` / `*.vercel.app` as preview hosts and allows only loopback endpoints there. I reproduced it: a `worker` adapter on `https://sf.pages.dev` throws `External submissions disabled on local/preview pages`, while the same content on `galincia-hub.github.io` or a custom domain submits. So the Option 2 URL in the old approval draft (`https://<project>.pages.dev/surveys/<id>/`) would show every respondent the error. Fix one of these ways:
   - (a) Keep blocking only preview deployments (`<hash>.<project>.pages.dev`) and allow the production `<project>.pages.dev`. Add a test.
   - (b) Make Option 2 require a custom domain.

   Option 1 (GitHub Pages) is unaffected.

3. **MUST (Owner decision, due 10/4) — The Adora deploy path is undecided, and the docs contradict each other.** `surveys/adora-ship-visit-001/survey.json:55` uses `local-mock`, which `--confirm` refuses (`tools/deploy.mjs:107`). So the factory Adora bundle can be built (dry-run) but cannot be published as it is. The docs disagree on what should happen:
   - `docs/COLLECTOR_DECISION.md:4,11` says "Adora keeps the `google-form` adapter".
   - `docs/OPERATION.md:41` says the content is reproduction-only, must never carry the real Form URL, and must never be published.
   - The old approval draft said "Option 1 by 10/4".

   Recommendation (now in `DEPLOY_APPROVAL.md`): Adora keeps running on the existing live page in `galincia-hub/MD` (already public and collecting to the Google Form). The factory copy stays as the parity proof. Use the factory bundle only if the Owner explicitly opts in. That would require adding the live Form action, `entry` and `allowedHosts: ["galincia-hub.github.io"]` to content, then validating and running a dry-run.

   The same decision covers **R04** (required free text that invites a name, `privacy.identityQuestions:["R04"]`, `OPERATION.md` §5). It matters only if the factory Adora bundle is published.

### SHOULD

4. **SHOULD — The web reports page cannot read a real HTTPS Worker.** The page is served only by `tools/preview.mjs`, whose CSP at `tools/preview.mjs:13` is `connect-src 'self' http://127.0.0.1:*`. A `fetch` to `https://…workers.dev` is blocked. The Worker's `ALLOWED_ORIGINS` would also need the preview origin. Tests pass only because the collector is on loopback. Today the working production route is "export to JSONL, then file upload or the CLI". Fix: let the preview CSP take the collector origin from an env/flag, and document the `ALLOWED_ORIGINS` entry.

5. **SHOULD — No Worker-to-xlsx path.** `tools/report.mjs:29` accepts only `jsonl|gform-csv`. `GET /v1/responses/:id` returns `{responses:[envelope…]}`, and `parseJsonl` already accepts envelopes. Add `--source worker <endpoint>` (secret taken from the env), or document `curl -H "Authorization: Bearer $REPORT_SECRET" …/v1/responses/<id> | jq -c '.responses[]' > r.jsonl` in OPERATION.

6. **SHOULD — The public submit endpoint accepts any JSON object.** `collector/core.mjs:126-127` stores any object of 64 KB or less while a survey is open. Keeping the raw payload is the design, but a stranger can fill a survey's report with junk. Add a minimal shape check that does not alter `raw`: either `answers` is an object, or the legacy/standard keys are present. Consider Cloudflare rate limiting later.

7. **SHOULD — `google-form` + `redirect:'error'`.** At `engine/storage.js:31`, if the Form endpoint answers with a redirect, the fetch rejects. The respondent then sees "저장 실패" even though Google may have recorded the answer, which invites duplicate submissions. Not verifiable offline (확인 필요). It matters only if the factory Adora bundle is ever published with `google-form`. Consider `redirect:'follow'` for the opaque no-cors request.

8. **SHOULD — Doc status lines and statements are stale.** `INTAKE.md:3`, `COLLECTOR_DECISION.md:3`, `DEPLOYMENT.md:3` and `OPERATION.md:3` still say "Draft / Opus 검토 전". COLLECTOR_DECISION also needs to match finding 3. DEPLOY_APPROVAL has been finalized in this review.

### NICE

9. **NICE — Builder (SPEC §14) not implemented.** Survey content is entered through intake plus the JSON editor and validator. SPEC allows "1차는 JSON 기반 우선". Acceptable.
10. **NICE — `_headers` is ignored by GitHub Pages.** The `<meta>` CSP covers it, but a meta CSP cannot set `frame-ancestors`. Low risk for a survey page.
11. **NICE — `tools/deploy.mjs:52` rewrites import specifiers with `String.replace`.** If the quoting in `survey.js` changes, the rewrite silently does nothing and the bundle breaks. Assert that each replacement happened.
12. **NICE — SPEC §22 final report.** README covers usage, but no single page lists URL, response location, result location, test results and limits. This review plus DEPLOY_APPROVAL fill most of that. Add it to README after deploy.
13. **NICE — Client close uses the device clock** (`engine/survey.js:28,37,245`). The server (Worker) is authoritative. With `google-form`, closing is manual (OPERATION checklist).

## Coordinator / security requirements

| Requirement | Status |
|---|---|
| Engine generic, zero survey-specific text | ✅ grep of `engine/ lib/ tools/ reports/ collector/ schema/` finds no names, prompts or dates (one comment in `lib/normalize.mjs:1` says "Adora payloads": a comment, acceptable) |
| Default skin = live Codex Adora; only theme tokens swappable | ✅ `themes.css` sets variables only; 0 % pixel diff |
| Adora reproduction: same questions / look / payload | ✅ parity test, golden legacy payload bytes, 18 answers |
| Intake + strict validator blocking deploy | ✅ `buildSurvey` validates before any write; negative fixtures |
| Collector decision | ✅ Worker + D1 (Adora: see M3) |
| Client + server auto-close | ✅ client Closed screen; Worker 410 (mock + real wrangler/D1) |
| Reports incl. xlsx | ✅ views A–E, copy modes, AI prompt, xlsx re-read (see S4/S5 for production access) |
| QR + Kakao | ✅ QR decodes to the exact subpath URL; all SPEC 13 slots; forbidden-word check on the notice |
| Deploy dry-run, GH Pages + Cloudflare adapters, isolation | ✅ frozen manifests, own-path staging, union verification, `--confirm` gate (never run) |
| Forbidden word U+C775 U+BA85 | ✅ `git grep` and working-tree grep: 0 hits; checks are built from code points |
| No name/company questions unless allowlisted per question | ✅ `validate.mjs` requires `allowIdentity` **and** `identityQuestions` to include the id |
| No code-to-company mapping tracked | ✅ `.gitignore` patterns; `git ls-files` clean |
| Secrets server-side only | ✅ bearer secrets checked in the Worker only; test scans served files; `.dev.vars.example` holds placeholders |
| Tests never hit external endpoints | ⚠️ browser blocks non-local requests; live baseline is opt-in; **M1** wrangler telemetry typo |
| google-form gated to allowedHosts | ✅ plus HTTPS-only, and local/preview hosts always refused |
| CSP | ✅ no `unsafe-inline`; `connect-src` = collector origin; `form-action 'none'` |

## SPEC §18 checklist

"Verified" = the named test ran and passed in my `npm test` run at 75d611b, and I read its assertion.

| SPEC 18 item | Test (file → name) | Verified |
|---|---|---|
| 모바일 렌더링 | `tests/preview-check.mjs` → "Local preview loads at 390x844; category required", "Offline mobile pixel diff against saved live baseline" (0 %) | Y |
| 참여 구분 선택 | `preview-check` → "Category selection; untouched slider; score selection; NA" | Y |
| 슬라이더 미조작 시 미응답 | same | Y |
| 점수 선택 | same | Y |
| 평가하기 어려움 | same | Y |
| NA 평균 제외 | `tests/unit/stats.test.mjs` → "NA exclusion: [12, NA, 8] -> avg 10, valid 2, NA 1"; `flow-check` → "…XLSX re-read with NA exclusion and linked scores" | Y |
| 필수 주관식 | `preview-check` → "Required text, 1000-char limit and live counter, navigation persistence" | Y |
| 글자수 제한 | same | Y |
| 제출 | `preview-check` → "Submit to local mock; exact legacy keys and raw stored payload"; `flow-check` → "Real Wrangler/D1 browser submit and server-close HTTP 410" | Y |
| 원본 저장 | `tests/collector/worker.test.mjs` → "[worker] submit ok -> raw byte-equal on read"; `flow-check` → "…byte-preserved raw record" | Y |
| 분석 화면 | `tests/reports/reports.test.mjs` → "reports page (mobile 390x844)… views A-E" and desktop variant | Y |
| 참여 구분별 통계 | `stats.test.mjs` → "category, area (pooled) and overall stats" | Y |
| 관련 점수 + 주관식 연결 | `copytext.test.mjs` → "linked line incl. 평가안함, unanswered \"-\", fallback to prompt without shortLabel" | Y |
| 보고서용 복사 | `copytext.test.mjs` → "copy mode: all (snapshot)", "copy mode: scores has no text; text has no score stats"; reports → "copy equals lib output" | Y |
| 새 survey.json 추가만으로 신규 설문 | `flow-check` → "New runtime survey content renders without engine changes; message overrides and mixed themes"; `preview-check` → "Content-only sample route…"; `intake-e2e` (7 checks) | Y |
| (brief) 자동 마감 client/server | `flow-check` → "Client past deadline -> Closed screen…", "Server deadline passes… HTTP 410 -> Closed" | Y |
| (brief) xlsx / QR / validator / deploy isolation | reports "xlsx re-read…"; "QR decode round-trip…"; `validate-check` (25); `tests/deploy` (4) | Y |

## Earlier review items (`REVIEW_OPUS_DESIGN.md`)

| # | Item | Status |
|---|---|---|
| 1 | Broken CSS token | ✅ fixed; test "no malformed color token suffix" |
| 2 | `npm test` hermetic (own servers, height-tolerant diff) | ✅ (see M1 for wrangler) |
| 3 | No live site in `npm test` | ✅ `test:live-baseline` opt-in; stored baseline |
| 4 | Subpath support | ✅ relative assets, `./survey.json`; subpath flow test |
| 5 | Per-question identity allowlist | ✅ `identityQuestions:["R04"]`; fixture; R04 listed in OPERATION §5 |
| 6 | Payload parity (legacy `ref:""`, trim, golden) | ✅ |
| 7 | Semantic theme tokens / nested section themes | ✅ mixed-theme flow test |
| 8 | worker + google-form adapters, Node mock, 410 | ✅ |
| 9 | `charter-*` names | ✅ `intro-emphasis` / `intro-highlight` |
| 10 | Messages overridable | ✅ `engine/messages.js` + `messages` block |
| 11 | Validator gaps a–e | ✅ all five |
| 12 | Inline handlers / `unsafe-inline` | ✅ delegation; CSP without `unsafe-inline` |
| 13 | `.gitignore` for response data | ✅ |
| 14 | Converter source under `source/` | ✅ excluded from bundle |
| 15 | `shortLabel` + Kakao slots | ✅ |
| 16 | CONTENT_SCHEMA, DESIGN untouched | ✅ (status lines elsewhere: S8) |
| 17 | Slider tap at baseline | — kept for parity (as advised) |
| 18 | AbortController fallback | ✅ test |
| 19 | Runtime content-only test | ✅ |
| 20 | Diff mask | ✅ `_preview/diff-*.png` |

## Re-check @ d8a3ddd

Method: I read `git show d8a3ddd` and ran `npm test` once. Result: **all PASS** (node:test 60/60, 54 PASS lines across the validate, browser and flow suites; visual diff 0 % on all four captures). I edited no code.

| # | Item | Status | Evidence |
|---|---|---|---|
| M1 | wrangler telemetry/config in worker test | **Resolved** | `tests/collector/worker.test.mjs:42` now sets `WRANGLER_SEND_METRICS:'false'`, a temp `XDG_CONFIG_HOME` and `WRANGLER_LOG_PATH` (same as flow-check) |
| M2 | `*.pages.dev` blocked | **Resolved** | `engine/storage.js` `isPreviewHost`: production `<project>.pages.dev` is allowed; `<x>.<project>.pages.dev`, `*.vercel.app` and http pages stay blocked. New unit test covers allowed and blocked hosts and counts sends |
| M3 | Adora path / R04 | **Owner decision, still open** (docs now consistent: COLLECTOR_DECISION and OPERATION match DEPLOY_APPROVAL §4) | — |
| S4 | Reports page cannot reach an HTTPS Worker | **Resolved** | `tools/preview.mjs` takes an optional validated `COLLECTOR_ORIGIN` (bare https or loopback origin, otherwise refuses to start); the `ALLOWED_ORIGINS` step is documented in DEPLOYMENT/OPERATION; test `preview CSP: collector origin only via COLLECTOR_ORIGIN…` |
| S5 | No Worker-to-xlsx path | **Resolved** | `tools/report.mjs --source worker <endpoint>`, secret from env only; test covers xlsx re-read, raw byte-equal, 401, missing secret, non-https refusal, and checks the secret never appears in output |
| S6 | Submit accepts any JSON object | **Resolved** | `collector/core.mjs:129` requires `answers` to be an object (400 otherwise); `raw` is untouched; the contract test checks that rejected bodies are not stored (mock + real wrangler) |
| S7 | google-form `redirect:'error'` | **Resolved in code; behaviour still 확인 필요** | now `redirect:'follow'`; whether the real Form redirects can't be verified offline. Matters only for Adora option B |
| S8 | Stale doc status lines | **Resolved** | INTAKE, COLLECTOR_DECISION, DEPLOYMENT and OPERATION are marked Final (open Owner decisions noted) |
| N11 | Unchecked import rewrite in deploy | **Resolved** | `tools/deploy.mjs` throws if an import specifier or an HTML rewrite target is missing |

Side effect, acceptable: the S6 shape gate runs after the 410 check, so closed surveys still answer 410 first. The engine's legacy and standard payloads both include `answers`.

`DEPLOY_APPROVAL.md` was updated to `d8a3ddd`. I removed the pages.dev warning, step 6's prerequisite and recommendation 4's pre-work.

### Updated verdict: **ready** for the code base. Public deploy is still gated on the Owner's one-time approval (DEPLOY_APPROVAL §5), which includes the Adora/R04 decision (M3).
