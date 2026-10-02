# Phase A implementation notes for design review

`docs/DESIGN.md` is owned by Claude Opus 5.5. Codex does not create or edit it.

The implemented boundary is content → schema/semantic validation → shared static renderer → local test mock. Production collection, report authorization, statistics, export, distribution and deployment remain Phase B.

- `surveys/<id>/survey.json` is the sole runtime content input. Preview automatically serves `/surveys/<id>/` without a per-survey HTML file, registry or code change.
- `tools/convert-reference.mjs` takes a reference question bank and a presentation supplement. The supplement exists because the source keeps intro, category options, page titles, completion text, payload version and patch behavior outside questions.json. No survey names, company names or reference dates are embedded in engine/tools code.
- Questions retain source IDs, ordering, prompts, help and bounds. `score20` becomes `score`. Source areas become sections. `meta.scoreGuide` becomes scale. Text links default to score questions in the same section.
- Actual live patch semantics override the source's optional final text question: all five text questions are required. No baseline shortcut button. Sliders begin unanswered until an input event, while their visual thumb starts at baseline.
- Content explicitly allows identity only for allowlisted R04 in the real reference because its final question invites a name for a reply. No new identity field is introduced. The dummy sample prohibits identity.
- Legacy transport preserves exactly version/ref/affiliation/surveyType/answers/submittedAt. Survey ID travels in a header so raw legacy JSON is unchanged. Legacy missing ref remains an empty string; standard missing ref defaults to `미지정`. Legacy text is trimmed exactly as on the live page; whitespace-only required answers are rejected.
- All skin colors are CSS custom properties. Source layout, typography and spacing are retained. Four content-selectable section palettes and the source default skin are supported.
- The schema checker implements only the keywords used in the checked-in schema: type, enum, properties, required, additionalProperties, items, minItems, minLength, minimum, pattern and date/date-time format. It is not advertised as a complete JSON Schema implementation.
- No live Google Form action or entry ID is stored. The only implemented adapter refuses non-loopback pages and non-HTTP/non-loopback endpoints; the mock port is configurable. Redirects are refused. Preview CSP disables form submission/frames and limits connection destinations. Browser tests intercept requests and allow only local traffic plus GETs to the live reference origin.
- Mock raw records are append-only JSONL under ignored `_preview/`; they are synthetic test data, not a production response store. No results endpoint is exposed.
- Client deadline check exists at load and immediately before submit. Server deadline enforcement is intentionally Phase B.
- Tests use Node built-ins and installed Chrome. No package installation or runtime dependency is required. Browser CLI was unavailable; brief-authorized CDP transport was reused read-only from the optional test reference.

Environment resolution: original requested ports 8790/8791 belong to sand-egress-tun. Coordinator authorized 18790/18791 instead, configurable through PREVIEW_PORT/COLLECTOR_PORT. No existing process was stopped. User instruction supersedes the older port values in DESIGN.md.

## Opus Phase A review application

Applied #1 corrupted CSS color fix and regression scan; #2 owned-server test lifecycle and height-aware diff; #3 separate approved GET-only baseline refresh, offline default suite; #4 relative assets and prefixed/index.html routes; #5 per-question identity allowlist; #6(a–c) legacy ref/text parity and golden fixture; #9 generic intro class names; #13 response/export ignores; #14 converter input under source/; #16 CONTENT_SCHEMA documentation; #20 diff-mask PNG output.

Owner-facing identity note for future OPERATION.md: the existing final text question is required by the live UI patch and invites an optional name for a reply. It remains unchanged for parity. Only R04 is allowlisted; new identity prompts fail validation.

Phase B TODO (explicitly deferred by coordinator):

- #7 semantic theme tokens, inherited per-section palette isolation, mixed-theme regression test.
- #8 worker/form adapters and shared collector contract, server-enforced deadlines and response authentication.
- #10 content-overridable generic messages.
- #11 deadline/event ordering, distribution output scan, checker max keywords/tolerance, CLI folder identity and clearer identity-match errors.
- #12 event delegation and stricter script CSP.
- #15 short score labels and full distribution slots in content.
- #17 preserve baseline-tap parity unless separately approved; #18 older-WebView timeout fallback; #19 temporary content-only creation test.
- Remaining Phase B scope: normalization/statistics (NA excluded), reports, linked-score copy, AI prompt, XLSX, QR/Kakao, frozen deploy dry-run and isolation, intake, CI template and operations/deployment/approval docs. No Phase B work has started.

Final Phase A evidence: all 35 automated checks passed; all four mobile comparisons are exactly 0.00%, no height differences. See PHASE_A_SUMMARY.md. The approved baseline was captured once; the default full test run used only local servers and saved PNGs.
