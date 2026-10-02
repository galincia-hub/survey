# Review — Codex Phase A draft vs DESIGN.md / SPEC 18–20 / security rules

Reviewer: Opus 5.5 · 2026-10-02 09:05 KST · Snapshot: uncommitted working tree (engine/, schema/, tools/, surveys/, tests/; docs/ empty before this review). Nothing was run by the reviewer; findings come from reading the code.
Legend: **MUST** = fix before Phase A commit / before any deploy · **SHOULD** = fix in Phase B · **NICE** = optional.

## What is already good (keep)
- Engine content-driven; grep of `engine/ tools/ schema/` finds no ship/company/event names, prompts or dates (only `charter-*` class names, see #9).
- Default skin ported from live `style.css`+`ui-patch.css` (no redesign). Slider untouched = `data-selected=""`, readout `-` / `{max}`; NA = `"NA"`; required-text message exact; 1000-char limit + counter.
- Safety: `storage.js` refuses non-loopback hosts/endpoints; preview CSP `form-action 'none'`; browser test intercepts and fails every non-local request and allows only GET to the live origin. Live Google Form URL is **not** in content. No forbidden word in any file; validator avoids the literal via code points.
- Legacy payload keys = live (`version, ref, affiliation, surveyType, answers, submittedAt`), 18 answers; mock stores the raw body string.
- Validator: schema + semantic checks + 18 negative fixtures + CLI non-zero exit.

## Findings

1. **MUST — Broken CSS declaration changes the default skin.** `engine/styles.css:123` `border:1px solid var(--skin-20)4d8` (token replacement corrupted live `#eee4d8`). Declaration is invalid → the slider-hint pill loses its border on every score question. Fix: add a token for `#eee4d8`. Add a test that scans `styles.css` for `var(--…)` followed directly by a hex fragment.

2. **MUST — `npm test` is not hermetic.** `tests/preview-check.mjs` expects preview (8790) and mock (8791) to be already running, and `tests/png.mjs:24` `assert.equal(x.height,y.height)` crashes on any full-page height difference instead of reporting a number. Fix: the test starts `tools/preview.mjs` + `tools/mock-submit.mjs` itself (skip if the port is taken by our own server, never kill other processes) and stops them afterwards. `diffPNG` compares the overlapping area, counts the extra rows as changed, and reports `heightDelta`.

3. **MUST — Default test run hits an external site.** `tests/preview-check.mjs:10,64` navigates to the live GitHub Pages URL inside `npm test`. Rule: tests never hit external endpoints. Fix: move the live capture to an opt-in `npm run test:live-baseline` (read-only GET, same interception) that writes `tests/baseline/adora/{intro,survey,intro-full,survey-full}.png`. `npm test` diffs against the stored baseline offline and prints the diff %.

4. **MUST — Engine cannot run under a subpath (blocks the GitHub Pages target `/MD/…`).** `engine/survey.js:18` requires `^/surveys/<id>/$` exactly. `engine/index.html:9,19` uses absolute `/engine/...`. Fix: use relative asset URLs, and derive the id from the fetched `survey.json` (or `<meta name="survey-id">` injected at build), not from the pathname. Accept `…/surveys/<id>/` and `…/index.html` under any prefix. This matches DESIGN §8 (frozen self-contained bundle).

5. **MUST — Blanket identity bypass on Adora.** `surveys/adora-ship-visit-001/survey.json:7` `privacy.allowIdentity: true` was set only so that R04 ("성함을 함께 남겨주시면…") passes `tools/validate.mjs:55`. The flag then disables the check for the whole survey, so a future name or company question would pass silently. Fix: replace it with `privacy.identityQuestions: ["R04"]` (per-question allowlist). The validator errors for any other question that matches. Add a fixture for this. Also flag to Owner: R04 is required (live ui-patch parity) and invites a name. Keep it for parity, but list it in `OPERATION.md`.

6. **SHOULD — Payload values diverge from live (data compatibility).**
   - (a) `engine/storage.js:3` sends `ref:"미지정"`; live sends `""`. For `format:"legacy"`, send `""` as live does. Apply the `미지정` default in `standard` payloads and in report normalization.
   - (b) `engine/survey.js:204` no longer trims text answers, and `preview-check` asserts the untrimmed `'  테스트 원문  '`. Live sends `.trim()`. Restore trimming and update the test.
   - (c) Add a golden test that compares against a payload built from live `form-submit.js` logic (static fixture; never submit to the live form).

7. **SHOULD — Theme tokens are not semantic, and page/section themes conflict.** `styles.css:1` defines `--skin-0…64` (mechanical names; `--skin-33` is shared by soft-blue and `charter-key`). Swapping a theme means editing opaque indices. `survey.js:26` puts `data-theme` on `<html>`, and `[data-theme=X] .section-head` rules (`styles.css:57-72`) then match every section. With a named page theme plus different section themes, source order wins over the nearest ancestor. This is latent today because the sample has one section. Fix per DESIGN §1.1: semantic variables, `themes.css` sets only variables, and rules consume `var(--section-*)` (already started at `styles.css:129`). Remove the old `[data-theme] .section-head` rules. Test: page theme `lavender` + 4 section themes → each head has its own computed background.

8. **SHOULD — Collector/adapters for Phase B.** The schema enum allows only `local-mock`, and `storage.js:10` hard-codes `http://127.0.0.1:8791/submit`. Implement the `worker` adapter and `google-form` adapter per DESIGN §4: `google-form` sends only when `location.hostname ∈ collector.allowedHosts`, and loopback is always refused. Add `tools/mock-collector.mjs` with the `/v1/submit/:id` contract (201/400/404/410/413), and handle HTTP 410 → Closed screen. Keep `mock-submit.mjs` only if tests still need it.

9. **SHOULD — Survey-flavoured names in the engine.** `survey.js:48` and `styles.css:125-126` use `charter-emphasis` / `charter-key` ("charter" is Adora vocabulary). Rename them to `intro-emphasis` / `intro-highlight`.

10. **SHOULD — Hard-coded engine messages that mismatch content.** `survey.js:66` shows "참여 구분을 선택해주세요." even when `respondent.label` differs. The closed screen and the "설문 시작하기", "제출하기", "자유롭게 적어주세요." strings are also fixed. Move these to engine defaults overridable by an optional `messages` block in content.

11. **SHOULD — Validator gaps.**
    - (a) No `deadline > eventDate` check.
    - (b) No scan of generated Kakao/notice text for the forbidden word. Add this when `distribute.mjs` lands.
    - (c) `checkSchema` crashes if an array rule has no `items` (`validate.mjs:23`), and it ignores `maximum`/`maxLength`. Make it tolerant and support both.
    - (d) The validator does not check that `surveyId` equals the folder name. The CLI should enforce this, not only `preview.mjs`.
    - (e) Identity regex matches `회사` in legitimate prompts (e.g. "선사(회사) 대응"). The allowlist from #5 makes this acceptable, but print the matched word.

12. **SHOULD — Inline handlers force `script-src 'unsafe-inline'`.** `survey.js` renders `onclick=`/`oninput=` strings, and `preview.mjs:7` CSP allows `'unsafe-inline'`. Use event delegation on `#app` (`data-action` attributes) and drop `'unsafe-inline'` from the CSP. The same CSP should ship with deploy targets.

13. **SHOULD — `.gitignore` must cover response data before Phase B.** Add `.wrangler/`, `*.sqlite*`, `*.jsonl`, `*.xlsx`, `reports/out/`, `published/**/responses*`. Wrangler local D1 and report exports contain respondent text. Check `*ref*name*`/`*name*ref*` against real filenames: they must not hide `reference-*` sources, and do not today.

14. **SHOULD — Converter input lives next to published content.** `surveys/adora-ship-visit-001/reference-presentation.json` duplicates most of `survey.json`. Move it to `surveys/<id>/source/` and exclude `source/` from builds. Two content files per survey violate "one content file".

15. **SHOULD — Adora content gaps for reports/Kakao.** Add `shortLabel` to score questions so linked lines read `공연 12 · 바/라운지 10 · 수영장 평가안함` (e.g. F01 "공연", F02 "바/라운지", F03 "수영장", F05 "식당"). Add the `distribution.{greeting,thanks,purpose,whyYou,usage,ask,ripple}` slots (SPEC 13).

16. **SHOULD — Docs/process.** `docs/CONTENT_SCHEMA.md` is missing (Phase A deliverable). Write it from the DESIGN §2 table. Do **not** overwrite `docs/DESIGN.md`; append a "Codex implementation notes" section if needed and keep the status line. Phase A is uncommitted; commit after #1–#5.

17. **NICE — Slider tap at baseline.** Same as live: tapping the thumb without moving does not select. That is acceptable for parity. If parity is later relaxed, accept `pointerup` on the thumb as a selection.

18. **NICE — In-app browser compatibility.** `AbortSignal.timeout` (`storage.js:11`) and CSS `:has()` (inherited from live) need recent WebViews. Add an `AbortController`+`setTimeout` fallback. `:has()` only affects the unselected readout color and is the same as live.

19. **NICE — Content-only creation test.** `preview-check` uses the committed `sample-survey`. Add a test that writes `surveys/tmp-<rand>/survey.json` at runtime, loads its route, submits, and deletes it. This proves the SPEC 18 "새 survey.json 추가만으로 신규 설문 생성" claim literally.

20. **NICE — Visual diff threshold.** The 1 % threshold with zero per-channel tolerance is strict, which is good. Also save a diff-mask PNG to `_preview/` so regressions can be located.

## Phase B checklist (from DESIGN, not yet started — expected)
Worker + D1 collector (and the Node mock with the same contract) with server-side 410 · registry upsert from survey.json · `lib/` stats/copy/prompt/kakao/url · `reports/` page with server-checked secret · `tools/report.mjs` xlsx (re-read in test) · `tools/distribute.mjs` (QR round-trip, Kakao) · `tools/deploy.mjs` dry-run with frozen bundles and an isolation test · `tools/intake.mjs` + `docs/INTAKE.md` · CI template · COLLECTOR_DECISION / DEPLOYMENT / OPERATION / DEPLOY_APPROVAL / README.
