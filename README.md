# Survey Factory — Phase A

Generic static survey renderer, strict content validation, original reference skin, four section themes, converted real content and dummy content. Runtime has no package dependencies. Production collection, reports, exports, distribution and deployment are deferred to Phase B.

Node 20+ and `/usr/bin/google-chrome` are needed for the full test suite.

```sh
node tools/validate.mjs surveys/adora-ship-visit-001/survey.json
node tools/validate.mjs surveys/sample-survey/survey.json
mkdir -p _preview
PREVIEW_PORT=18790 COLLECTOR_PORT=18791 nohup node tools/preview.mjs > _preview/static.log 2>&1 &
PREVIEW_PORT=18790 COLLECTOR_PORT=18791 nohup node tools/mock-submit.mjs > _preview/mock.log 2>&1 &
npm test
```

Preview paths: http://127.0.0.1:18790/surveys/adora-ship-visit-001/ and http://127.0.0.1:18790/surveys/sample-survey/ . Servers bind loopback only; an occupied port produces an error without stopping its owner. In managed environments, local socket/browser permissions may be required.

Shortest new-survey workflow: copy the sample survey.json to `surveys/<new-id>/survey.json`, change surveyId to match the folder and edit content, validate, then open `/surveys/<new-id>/`. No HTML or renderer changes are needed. Example question: `{"id":"Q05","type":"text","prompt":"개선 의견","required":true,"linkedScores":["Q01"]}`.

Synthetic submitted records: `_preview/mock-responses.jsonl` (each envelope contains surveyId and exact raw payload string). Browser screenshots, visual diff metrics and test results are also under `_preview/`. There is no results UI in Phase A.

The local mock is the sole submission adapter. It refuses external destinations and public page origins. No real Google Form URL is stored. Default tests block all external traffic; only the opt-in baseline capture permits GETs to the reference site. Never add remotes, push, publish, deploy, sign up or pay as part of this phase.

See `docs/CONTENT_SCHEMA.md` for content/payload mapping and `docs/DESIGN_CODEX_NOTES.md` for implementation handoff. `docs/DESIGN.md` is maintained separately by the design reviewer.

`npm test` starts/stops its own detached test servers, or reuses a server that identifies itself as Survey Factory. It never stops an existing server. Default tests are offline and compare against the checked-in live baseline. `npm run test:live-baseline` is an explicit GET-only refresh; baseline source metadata is in `tests/baseline/adora/source.json`. Full-page size differences count as changed pixels, and diff masks are saved under `_preview/`.
