# Survey Factory — Design

Status: Opus 5.5 design (reviewed against Codex draft implementation, 2026-10-02)

Inputs: `SPEC.md` (Owner, 2026-10-02), `sf-brief.md`, live Adora survey (`reference-codex/adora-ship-visit-0929/survey/*`), expert-survey skill.
Companion: `docs/REVIEW_OPUS_DESIGN.md` (findings against the current Codex draft).

## 1. Architecture

```
surveys/<id>/survey.json ──validate──▶ build (frozen per-survey bundle) ──adapter──▶ static host
                                              │                                         │
                                              ▼                                         ▼
                                      dist/<id>/{qr.png,kakao.txt}         browser: engine renders survey.json
                                                                                        │ payload (raw JSON)
                                                                                        ▼
                                  reports/ (generic)  ◀── secret-gated API ── collector (one, shared)
                                  copy text · AI prompt · .xlsx
```

- **Engine (fixed)**: `engine/` static, dependency-free ES modules. Knows question *types*, not questions. Zero survey-specific text: no ship/company/event names, no dates, no prompts. Generic UI strings mandated by SPEC (e.g. "선택 점수", "평가하기 어려움 (경험하지 못함)", "답변을 해주셔야만 설문을 완성할 수 있습니다.") are engine defaults, overridable via `messages` in content.
- **Content (variable)**: exactly one file per survey, `surveys/<id>/survey.json`. Anything optional/auxiliary (converter input, notes) lives in `surveys/<id>/source/` and is never published.
- **Shared libs**: `lib/*.mjs` pure functions (normalize, stats, copy text, AI prompt, Kakao text, xlsx rows) imported by both the browser report page and Node tools/tests — one implementation, one set of tests.
- **Collector**: one shared HTTP collector for all surveys (§5). Storage is an adapter chosen by `survey.json.collector`; engine code never changes per survey.

### 1.1 Default skin + theme tokens
- Default skin = the live Codex design **as-is** (`style.css` + `ui-patch.css` merged into `engine/styles.css`). No redesign; visual parity is tested (§9).
- Colors only via **semantic** CSS custom properties, not mechanically numbered ones:
  `--bg --card --ink --muted --line --soft --accent --accent-ink --guide-bg --guide-line --guide-ink --score-selected --score-unselected --score-na --hint-bg --hint-line --hint-ink --error --required-note` and per-section `--section-bg --section-border --section-title --section-copy`.
- `engine/themes.css` defines token sets: `[data-theme=sage|soft-blue|warm-beige|lavender]` each set **only variables**. Rules consume variables (`.section-head{background:var(--section-bg)}`), so the nearest ancestor wins by inheritance — a page-level theme and per-section themes cannot fight via selector order.
- Live mapping (default): overall→sage, facilities→soft-blue, fnb→warm-beige, summary→lavender; page level `default` = live monochrome (#111 accent, #b94b4b selected score).
- `survey.theme` sets page tokens; `sections[].theme` sets section tokens; if omitted, sections cycle sage→soft-blue→warm-beige→lavender.

### 1.2 Page flow
`pages.mode` (default `"two-page"`, SPEC 4): Page 1 intro + purpose + respondent category → Page 2 all sections (sticky common score guide shown once at top) → Done. `"per-section"` (optional, later) = one section per page with the same validation. State persists across Back/Next. Before render and before submit: deadline check → Closed screen. Progress bar 50%/100%.

Score widget: slider starts at baseline position but `data-selected=""` and readout `-` / `{max}` until a real `input` event; `NA` button stores `"NA"`; hint "점수 배정을 위해서는 슬라이드를 움직여주세요." replaces the live (removed) baseline button. Known parity gap kept on purpose: tapping the thumb without moving does not select (same as live).

## 2. Content schema (one schema)

SPEC 3 is the base; reference `questions.json` + live hardcoded strings (`script.js`, `ui-patch.js`, `config.js`, `form-submit.js`) are folded in. Unknown properties are rejected (`additionalProperties:false`). JSON Schema in `schema/survey.schema.json`; semantic checks in `tools/validate.mjs`.

| Unified field | SPEC 3 | Reference questions.json | Live hardcoded source |
|---|---|---|---|
| `surveyId` (kebab, = folder name) | surveyId | — | folder path |
| `version` | version | — | `form-submit.js` `'2026-10-01-v1'` |
| `title` | title | `meta.title` | — |
| `eventName` | eventName | — | — |
| `eventDate` (YYYY-MM-DD) | eventDate | `meta.eventDate` | `config.EVENT_DATE` |
| `deadline` (ISO date-time **with offset**) | deadline | `meta.deadline` (date only) | `config.DEADLINE` → converter: `T23:59:59+09:00` |
| `intro.brand` / `intro.eyebrow` | — | — | `index.html` brand / `"2026.09.29 · BUSAN"` |
| `intro.headline` (default `title`) | intro.headline | — | h1 = meta.title |
| `intro.paragraphs[]` | intro.paragraphs | — | `script.js` intro copy |
| `intro.highlightText` + `intro.emphasisParagraph` | intro.highlightText | — | `ui-patch.js` charter emphasis |
| `respondent.{label,help,options[]}` | respondent | — | `affiliationOptions`, ui-patch label |
| `page.{eyebrow,title,lead}` (survey page head) | — | — | `renderSurvey` head |
| `messages.{done,closed,...}` (optional overrides) | — | — | `showDone` text |
| `scale.{enabled,min,max,baseline}` | scale.* | `meta.scoreGuide.*` + per-question min/max/baseline | — |
| `scale.baselineName` (axis tag) | baselineName | — | axis `"COSTA"` |
| `scale.{baselineLabel,lowLabel,sameLabel,highLabel}` | low/same/highLabel | `scoreGuide.*Label` | — |
| `scale.allowNotEvaluated` (+ per-question override) | allowNotEvaluated | implicit | NA button |
| `sections[].{id,title,subtitle,titleEn,theme}` | sections[] | `meta.areas{key:{title,subtitle,en}}` (key order) | CSS `#area_<key>` colors |
| `sections[].questions[]` | questions | `C[]` filtered by `area` | `bank[SURVEY_TYPE]` |
| `type: score` | score | `score20` | — |
| `type: text` | text | `text` | — |
| `type: singleChoice / multiChoice` + `options[]` | (types) | — | — |
| `required` | required | `required` | ui-patch forces all text required → converter `allTextRequired` |
| `maxLength` (default 1000) | maxLength | — | `TEXT_MAX=1000` |
| `rows` | — | `rows` | — |
| `linkedScores[]` (text only, targets score) | linkedScores | — (sheet logic) | converter default: score questions of the same area |
| `shortLabel` (score, for linked-score lines) | — | — | sheet labels "공연", "바/라운지" |
| `identity: true` (question may collect name/company) | — | — | R04 "성함을 함께 남겨주시면" |
| `privacy.allowIdentity` + `privacy.identityQuestions[]` (+ opt-in `privacy.requiredIdentityQuestions[]`) | — | — | — |
| `distribution.{deadlineText,sender,greeting,thanks,purpose,whyYou,usage,ask,ripple}` | distribution | — | `"응답 마감: …"` note |
| `collector.{adapter,endpoint,…}` | — | — | `GOOGLE_FORM_ACTION/ENTRY` |
| `payload.{format: legacy|standard, surveyType}` | — | — | `SURVEY_TYPE:"C"` |

Semantic checks (validator, non-zero exit, deploy gate): unique section+question ids; reserved ids; `min < baseline <= max`, integers; question overrides valid; linkedScores exist and are `score`; links only on `text`; choice options non-empty/unique; ISO `eventDate`/`deadline` (offset required); `deadline > eventDate`; forbidden word (U+C775 U+BA85, the Korean word for "anonymous") anywhere in content **and** in generated Kakao/notice text; identity heuristic (성함/성명/이름/회사/소속/name/company) on prompts/help → error unless the question id is listed in `privacy.identityQuestions` (no blanket bypass); listed identity questions must be `required:false` unless also in `privacy.requiredIdentityQuestions` (Owner opt-in); collector adapter allowed values and endpoint rules; `surveyId` equals folder name.

## 3. Response payload

Two formats from one engine (`payload.format`). Raw payload is stored byte-for-byte; normalization happens only in reports.

| SPEC 8 (`standard`) | Live Adora (`legacy`, key order kept) | Notes |
|---|---|---|
| `surveyId` | — (absent) | collector envelope carries surveyId (URL path / header) |
| `version` | `version` | content `version` |
| `ref` | `ref` | live sends `""` when no `?ref=`; standard default `"미지정"`. Legacy keeps live `""`; reports normalize `""`→`미지정` |
| `respondentCategory` | `affiliation` | option label text |
| — | `surveyType` (`"C"`) | from `payload.surveyType`, ignored by reports |
| `answers` | `answers` | `{id: number | "NA" | string | string[] | ""}`; every question present; text trimmed (live parity) |
| `submittedAt` | `submittedAt` | client ISO; server adds `receivedAt` |

Collector envelope (not part of payload): `{id, surveyId, receivedAt, raw}`. `ref` is upper-cased like live. No IP, no user agent stored by default.

## 4. Collector decision

| Criterion | Google Form `formResponse` (live style) | Shared Cloudflare Worker + D1 |
|---|---|---|
| Simplicity | No code, but one Google Form/Sheet setup (one shared form can serve all surveys) | One Worker + one D1 DB, deployed once |
| Free | Yes | Yes (Workers/D1 free tier ≫ expected volume) |
| Raw payload preserved | Yes (single long-text field) | Yes (`raw TEXT` verbatim) |
| Submit failure visible | **No** — `no-cors` opaque response; "success" is assumed | Yes — real 2xx/4xx JSON; clear errors to respondent |
| Server-side auto-close per survey | **No** (form-wide manual toggle only) | Yes — registry deadline, HTTP 410 |
| No per-survey backend change | Yes if one shared form | Yes — registry row upserted by deploy from survey.json (data, not code) |
| Results access protected | Google account (strong) but reports need manual CSV export | `REPORT_SECRET` checked in Worker; report page reads API directly |
| Local testability | Only via a mock (never the real form) | `wrangler dev --local` + local D1, or Node mock with same contract |
| Needs Owner approval | No (already exists for Adora) | Yes — Cloudflare account (free) |

**Recommendation: shared Cloudflare Worker + D1 is the factory default.** It is the only option that satisfies SPEC 9 "실패 시 명확한 오류" and server-side auto-close without per-survey work. **Exception: Adora keeps the `google-form` adapter** (same live form → same Sheet → data continuity; deadline 10/6 leaves no room to migrate; no new account needed for the 10/4 readiness). Adora reports ingest the Sheet CSV export through the same report pipeline (`--source gform-csv`). If Owner declines Cloudflare, the fallback default is "one shared Google Form, payload field, surveyId inside payload" with manual close — documented in `COLLECTOR_DECISION.md`.

Worker contract (Node mock `tools/mock-collector.mjs` implements the identical contract for tests):
- `POST /v1/submit/:surveyId` body = payload JSON (≤64 KB) → `201 {ok,id}` | `400 invalid_payload` | `404 unknown_survey` | `410 survey_closed` | `413 too_large`. CORS allowlist from env `ALLOWED_ORIGINS`.
- `GET /v1/status/:surveyId` → `{open, deadline}` (public).
- `GET /v1/responses/:surveyId` with `Authorization: Bearer <REPORT_SECRET>` → envelopes. Secret only in `wrangler secret` / `.dev.vars` (gitignored); never in frontend code or content.
- `PUT /v1/admin/surveys/:surveyId` with `ADMIN_SECRET` → upsert `{surveyId, version, deadline, status}`; called by deploy (dry-run prints the request only).
- D1: `surveys(survey_id PK, version, deadline, status)`, `responses(id PK, survey_id, received_at, raw)`, index on `survey_id`.
- Optional `X-Submission-Id` header (client UUID) for idempotent retry — kept out of the payload so the legacy shape is unchanged.

Engine adapters (`engine/storage.js`): `local-mock` (loopback only), `worker` (endpoint from content, real ack), `google-form` (live behaviour). **Safety gate for `google-form`**: sends only when `location.hostname` ∈ `collector.allowedHosts` (e.g. `galincia-hub.github.io`); loopback/`file:`/preview hosts always refused; preview server CSP `form-action 'none'` and `connect-src` loopback; browser tests intercept and fail every non-loopback request. Tests never reach any external endpoint except the opt-in read-only live screenshot (§9).

## 5. Auto-close
- Client: `now > deadline` at boot → Closed screen (no form rendered); re-checked on submit.
- Server (worker): registry deadline vs server clock → 410; engine shows Closed screen on 410. No per-survey code: deadline comes from survey.json via deploy upsert.
- google-form adapter: not enforceable server-side; `OPERATION.md` checklist "set form to 응답 받지 않음 at deadline". Reports flag submissions with `receivedAt > deadline`.

## 6. Reports (`reports/index.html?survey=<id>`, `lib/`, `tools/report.mjs`)
- Sources: collector API (secret entered at runtime, kept in `sessionStorage` only), `jsonl` (local mock), `gform-csv` (Sheet export; parsed locally).
- Normalize legacy → standard. Dedupe: raw always kept; views count the latest per non-default `ref` (`미지정` never deduped); duplicates shown.
- Views (SPEC 10): A responses (1 row/respondent) · B summary (n, n by category, area avg, overall avg) · C per-question (avg, Δ vs baseline, valid n, NA n, unanswered n, min, max, avg by category) · D text with linked scores · E copy.
- Rules: `"NA"` and `""` excluded from numerator and denominator; area/overall average = pooled mean of valid scores; 1 decimal for display, full precision in xlsx.
- Linked line: `[{category} | {shortLabel} {score} · {shortLabel} 평가안함 · …] {원문}` (unanswered → `-`).
- Copy (SPEC 11) in survey order: 전체 / 점수형만 / 주관식만. AI prompt (SPEC 12) built from title/purpose/sections + stated rules.
- `.xlsx` via `node tools/report.mjs <id> --source … --out dist/<id>/reports/` (exceljs devDep): sheets `raw`, `responses`, `summary`, `questions`, `text_linked`, `report_text`.

## 7. Distribution (`tools/distribute.mjs <id> --base-url <url>`)
- URL rule: `{baseUrl}/surveys/{surveyId}/` (optional `?ref=CODE`). Single function in `lib/url.mjs`, used by deploy, QR, Kakao.
- QR: `dist/<id>/qr.png` (`qrcode` devDep); test decodes it (`jsqr`) and compares to the URL.
- Kakao: `dist/<id>/kakao.txt` from generic template slots filled by `distribution.*` (인사, 감사, 목적, 의견이 중요한 이유, 활용처, 참여 요청, 주변 참석자 독려, URL, 마감, 발신자). Output passes the forbidden-word check.

## 8. Deploy (`tools/deploy.mjs <id> --target github-pages|cloudflare --dry-run`)
1. Validate (abort on failure).
2. Build **frozen, self-contained** bundle `dist/<id>/surveys/<id>/{index.html, survey.json, assets/engine.<hash>.js, assets/styles.<hash>.css}` with **relative** URLs (works at `/`, `/MD/`, any subpath) + `manifest.json` (sha256 per file, engine version). The engine is copied per survey so later engine changes never alter a live survey unless it is redeployed explicitly (SPEC 16).
3. Promote to `published/<id>/` (git-tracked) only with `--confirm`; refuse if `published/<id>/` exists with a different manifest unless `--allow-update`.
4. Adapter: **github-pages** copies only `published/<id>/` to `<repo>/<prefix>/surveys/<id>/`, stages only that path; **cloudflare** uploads the union of `published/*` (Pages deploys whole-site snapshots) after verifying every other survey's bytes equal its manifest; then registry upsert to the collector.
5. `--dry-run` (default for agents): prints file plan, target URL, diff vs published, registry request, exact commands. Real path requires `--confirm`; agents never run it (Owner approval: public URL).
- Tests: build A, hash; build B; A unchanged. CI template `.github/workflows/survey-ci.yml`: validate all surveys + offline tests + dry-run on PR; no deploy job.

## 9. File layout

```
engine/      index.html survey.js storage.js styles.css themes.css
lib/         normalize.mjs stats.mjs copytext.mjs prompt.mjs kakao.mjs url.mjs xlsx-rows.mjs
reports/     index.html report.js
collector/   worker.js schema.sql wrangler.toml.example
schema/      survey.schema.json
surveys/<id>/survey.json   (+ source/ never published)
tools/       validate intake convert-reference preview mock-collector report distribute deploy (.mjs)
tests/       unit/*.mjs browser/*.mjs fixtures/invalid/*.json baseline/adora/*.png
published/<id>/  frozen deployed bundles      dist/ _preview/  (gitignored)
docs/        DESIGN CONTENT_SCHEMA INTAKE COLLECTOR_DECISION DEPLOYMENT OPERATION DEPLOY_APPROVAL
```
Ports: preview 8790, collector 8791. Tests start/stop their own servers.

## 10. Test plan

`npm test` = offline, hermetic (starts preview + mock collector itself, blocks all non-loopback requests). `npm run test:live-baseline` = opt-in read-only GET of the live page to refresh `tests/baseline/adora/*.png`.

| SPEC 18 item | Test |
|---|---|
| 모바일 렌더링 | browser 390×844, KakaoTalk UA, no console errors, no horizontal scroll |
| 참여 구분 선택 | start blocked without category; selection persists Back/Next |
| 슬라이더 미조작 = 미응답 | untouched → `data-selected=""`, readout `-`, required error, not in payload as number |
| 점수 선택 | keyboard/pointer move → value, readout `/ {max}` from content |
| 평가하기 어려움 | NA → `"NA"` stored |
| NA 평균 제외 | stats fixture: [12, NA, 8] → avg 10, valid 2, NA 1 |
| 필수 주관식 | exact message "답변을 해주셔야만 설문을 완성할 수 있습니다." |
| 글자수 제한 | 1005 chars → 1000, counter `1,000/1,000` |
| 제출 | submit to local mock collector → 201 → Done |
| 원본 저장 | stored `raw` byte-equals sent body; legacy key set/order; golden payload fixture derived from live `form-submit.js` |
| 분석 화면 | report page renders views A–E from fixture |
| 참여 구분별 통계 | per-category avg/n fixture |
| 관련 점수+주관식 | linked line string equality incl. 평가안함 |
| 보고서용 복사 | 3 copy outputs, survey order, snapshot |
| 신규 survey.json만으로 생성 | temp `surveys/tmp-x/survey.json` → route works, payload `surveyId` |
| (brief) auto-close | client: past deadline → Closed; server: 410 |
| (brief) validator | every `tests/fixtures/invalid/*.json` rejected, CLI exit ≠ 0 |
| (brief) xlsx / QR / Kakao / deploy isolation | re-read xlsx sheets; QR decodes to URL; Kakao has all slots, no forbidden word; build B leaves A's hashes unchanged |
| (brief) safety | google-form adapter refuses on loopback; zero blocked-request log entries except expected |

**Adora reproduction**: (1) content parity — every `C[]` question id/prompt/help/required(after ui-patch)/order equals reference; (2) payload parity — legacy golden; (3) visual diff vs live baseline at 390×844, DPR 1: intro viewport, survey viewport, intro full, survey full; pixel diff reported, target < 1 % each; height mismatch reported (not a crash); diff PNGs saved in `_preview/`.
