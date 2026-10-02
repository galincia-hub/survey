# OPERATION — 운영 가이드

Status: Draft (Sonnet 5.5, Opus 최종 검토 전)

## 1. 새 설문 최단 경로

1. 메모 작성 (`docs/INTAKE.md` 형식: 행사 / 행사일 / 대상 / 목적 / 비교기준 / 마감일 / 질문).
2. `node tools/intake.mjs memo.txt --id <name>-NNN` → `surveys/<id>/survey.json` 초안 + `.prompt.md`. 기존 id는 덮어쓰지 않는다. `TODO(...)`는 사실을 지어내지 않고 남긴 항목이다.
3. 에이전트가 초안을 다듬고, 콘텐츠의 `collector`를 `worker`(운영 endpoint)로 바꾼다.
4. `node tools/validate.mjs surveys/<id>/survey.json` → 통과할 때까지 수정.
5. `node tools/preview.mjs` → `http://127.0.0.1:18790/surveys/<id>/` 확인.
6. `node tools/deploy.mjs <id> --target … --base-url … --dry-run` → 계획 검토 (승인 후에만 `--confirm`, `DEPLOYMENT.md` §4).
7. `node tools/distribute.mjs <id> --base-url …` → `qr.png`, `kakao.txt`, `link.txt`.
8. 마감 후 `node tools/report.mjs <id> --source jsonl|gform-csv <file>` → xlsx + 복사용 텍스트.

엔진·HTML·JS는 설문마다 바꾸지 않는다. 새 설문 = 새 `survey.json` 하나.

## 2. 일상 운영

- 응답 확인: `reports/index.html` (`?survey=<survey.json URL>&collector=<Worker endpoint>`로 미리 채움, `REPORT_SECRET`은 직접 입력; 비밀번호는 sessionStorage에만 저장). Google Form 설문은 Sheet를 CSV로 내려받아 `--source gform-csv`.
- 마감 후 응답: 리포트(웹/xlsx)가 `late`로 표시하고 요약에 `late`(전체)·`late_counted`(집계 대상 중) 건수를 보여 준다. 판정은 `receivedAt`(없거나 해석 불가면 `submittedAt`) > `deadline`. 제외는 하지 않는다.
- 응답 수·평균: "평가안함"(NA)은 평균과 분모에서 제외된다. 같은 참조 코드(`ref`)로 여러 번 제출하면 최신 1건만 센다 (참조 코드가 없는 응답은 모두 센다). 원본은 `raw` 시트에 전부 남는다.
- 문의 대응: 링크·QR은 `dist/<id>/`의 파일을 다시 쓰면 된다. 제출 실패 신고는 collector 종류(`worker`는 오류 코드가 보임, `google-form`은 실패가 보이지 않음)를 먼저 확인.
- 응답 데이터(`*.jsonl`, `*.xlsx`, `.wrangler/`, `reports/out/`)는 `.gitignore` 대상이다. 저장소에 올리지 않는다.

## 3. 마감

- 클라이언트: 마감 시각이 지나면 "응답이 마감되었습니다" 화면만 보이고 제출 버튼이 없다.
- 서버(Worker): 콘텐츠의 `deadline`(오프셋 포함 ISO, 정확한 시각)이 지나거나 레지스트리 `status=closed`이면 HTTP 410 → 같은 마감 화면.
- 조기 마감: `PUT /v1/admin/surveys/<id>` 로 `status: "closed"` (`ADMIN_SECRET`).
- 마감 연장: 콘텐츠 `deadline` 수정 → 검증 → 재배포(`--allow-update`) → 레지스트리 PUT.

### Adora (`google-form`) 마감 체크리스트
Google Form은 서버측 자동 마감이 없다. 마감 시각(2026-10-06 23:59:59 KST) 직후 Owner/담당자가:
- [ ] Google Form 편집 → 응답 탭 → **"응답 받지 않음"** 으로 전환
- [ ] 안내 메시지가 화면과 맞는지 확인 (필요 시 "응답이 마감되었습니다")
- [ ] 응답 Sheet를 CSV로 내려받아 `node tools/report.mjs adora-ship-visit-001 --source gform-csv <csv>`
- [ ] 리포트의 `late`(마감후) 표시와 요약의 `late` 건수 확인 — `receivedAt`(없거나 해석 불가면 `submittedAt`)이 마감 시각보다 늦은 응답. 표시만 하고 통계에서 제외하지 않는다 (Sheet 타임스탬프는 로케일 형식이라 `submittedAt`으로 판정될 수 있음)
- [ ] 내려받은 CSV/xlsx는 저장소에 올리지 않는다

> **`adora-ship-visit-001`은 재현·테스트용 콘텐츠다.** 실제 Adora 설문은 Owner가 `galincia-hub/MD`에서 이미 배포해 운영 중이며, 이 저장소의 `surveys/adora-ship-visit-001/survey.json`(collector `local-mock`)에는 **실제 Google Form 주소·entry ID를 절대 넣지 않는다.** 이 콘텐츠를 공개 배포하지 않는다 (`local-mock`은 `--confirm`에서 거부됨). 마감 시 위 체크리스트는 Owner의 실제 Form/Sheet에 적용하고, 내려받은 CSV만 이 도구로 리포트한다.

## 4. 데이터 내보내기·리포트
- `tools/report.mjs`: 시트 `raw / responses / summary / questions / text_linked / report_text` + `report.txt`.
- 주관식은 같은 영역 점수와 한 줄로 묶여 나온다 (`공연 12 · 바/라운지 10 · 수영장 평가안함`, `shortLabel` 사용).

## 5. Owner 결정 필요: Adora R04 (성함 기재) 문항

- 현황: Adora 마지막 문항 R04 ("…회신을 원하시는 경우 성함을 함께 남겨주시면 별도로 연락드려…")는 현행(live) 화면에서 **필수 입력**이고, 응답자가 이름을 적도록 유도한다.
- 처리: 현행과의 동등성(parity)을 위해 그대로 유지했다. 검증기는 이름·회사 질문을 막지만, R04만 `privacy.identityQuestions: ["R04"]`로 명시 허용했다. 다른 문항에서 식별 정보를 묻는 순간 검증이 실패한다.
- 문제: 필수라서 이름을 쓰고 싶지 않은 응답자도 무언가 적어야 제출할 수 있다. 개인정보 수집이 사실상 유도된다.
- 선택지:
  1. **필수 유지** — 현행과 동일. Adora는 마감이 10/6이므로 변경 위험 없음.
  2. **선택(optional)로 변경** — `required: false`. 현행 대비 제출 조건이 달라지므로 payload/통계 영향 확인 필요.
  3. **미래 설문에서는 삭제** — Adora는 유지하고 신규 설문 템플릿에는 성함 문항을 넣지 않는다 (intake는 기본적으로 식별 질문을 제외한다).
- 회신 요청: 1 / 2 / 3 중 선택.
