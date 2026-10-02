# Survey Factory

메모 한 장에서 설문 페이지를 만들어 배포하고, 응답을 모아 리포트까지 내는 정적 설문 공장. 설문 하나 = `surveys/<id>/survey.json` 하나이며 엔진 코드는 바뀌지 않는다. 런타임 의존성은 없다 (개발 도구: exceljs, qrcode, jsqr, pngjs, wrangler). Node 20+, 브라우저 테스트에는 Chrome 필요.

## 빠른 시작

```sh
node tools/intake.mjs memo.txt --id my-event-001        # 1. memo -> survey.json 초안
node tools/validate.mjs surveys/my-event-001/survey.json # 2. validate
node tools/preview.mjs                                   # 3. preview  (http://127.0.0.1:18790/surveys/my-event-001/)
node tools/deploy.mjs my-event-001 --base-url https://example.org/MD --dry-run  # 4. deploy dry-run (게시는 승인 후 --confirm)
node tools/distribute.mjs my-event-001 --base-url https://example.org/MD        # 5. QR / 카카오문
node tools/report.mjs my-event-001 --source jsonl responses.jsonl               # 6. report (xlsx)
```

## 구성

`engine/` 공용 렌더러 · `schema/` 콘텐츠 스키마 · `tools/` CLI · `lib/` 통계·문구·QR·카카오 · `collector/` Worker+D1 · `reports/` 리포트 페이지 · `surveys/` 콘텐츠 · `tests/` 오프라인 테스트.

## 테스트

`npm test` — 검증, 브라우저(로컬 서버/mock만, 외부 네트워크 없음), 단위·collector·reports·deploy, 흐름(intake→배포 번들→제출→리포트→QR). 라이브 기준 화면 재촬영은 `npm run test:live-baseline`(읽기 전용 GET, 수동).

## 문서

- [docs/INTAKE.md](docs/INTAKE.md) 메모 → survey.json
- [docs/CONTENT_SCHEMA.md](docs/CONTENT_SCHEMA.md) 콘텐츠 필드
- [docs/OPERATION.md](docs/OPERATION.md) 운영·마감·리포트·Owner 결정 사항
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 배포 어댑터·dry-run·CI
- [docs/DEPLOY_APPROVAL.md](docs/DEPLOY_APPROVAL.md) 공개 배포 승인
- [docs/COLLECTOR_DECISION.md](docs/COLLECTOR_DECISION.md) 응답 저장소 선택
- [docs/DESIGN.md](docs/DESIGN.md) 설계
