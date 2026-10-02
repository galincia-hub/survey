# OPERATION — 운영 가이드

Status: Final (Opus 5.5 최종 검토 반영, 2026-10-02) — §5 R04는 Owner 결정 대기

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

- 응답 확인 (xlsx, 권장): `REPORT_SECRET=… node tools/report.mjs <id> --source worker https://<worker-host>` — 비밀은 환경변수로만 받고 출력하지 않는다.
- 응답 확인 (웹): `reports/index.html` (`?survey=<survey.json URL>&collector=<Worker endpoint>`로 미리 채움, `REPORT_SECRET`은 직접 입력; HTTPS Worker를 읽으려면 `COLLECTOR_ORIGIN=https://<worker-host> node tools/preview.mjs`로 띄우고 Worker `ALLOWED_ORIGINS`에 미리보기 origin을 추가 — `DEPLOYMENT.md`; 비밀번호는 sessionStorage에만 저장). Google Form 설문은 Sheet를 CSV로 내려받아 `--source gform-csv`.
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

## 5. Adora R04 (성함 기재) 문항 — Owner 결정 완료

- 현황: Adora 마지막 문항 R04 ("…회신을 원하시는 경우 성함을 함께 남겨주시면 별도로 연락드려…")는 현행(live) 화면에서 **필수 입력**이고, 응답자가 이름을 적도록 유도한다.
- **Owner 결정 (2026-10-02 12:03 KST): 개인정보 최소화.**
  - **Adora 옵션 A**: 현행(live)은 변경하지 않는다.
  - factory의 Adora 사본은 현행과의 동등성(parity)을 위해 R04를 **필수 그대로 유지**한다. 이를 위해 `privacy.requiredIdentityQuestions: ["R04"]`를 명시했다 (그 외 내용 변경 없음. parity·golden payload·시각 diff 테스트 통과).
  - **factory 기본값 = 식별(이름·회사) 질문은 선택(`required: false`)**. 검증기는 `privacy.identityQuestions`에 있는 문항이 `required: false`가 아니면, `privacy.requiredIdentityQuestions`에 그 id가 명시된 경우를 제외하고 오류로 처리한다. intake는 식별 질문을 메모가 명시 요청한 경우에만 `required: false`로 만들고, `requiredIdentityQuestions`는 절대 추가하지 않는다.
- 필수로 유지하려면(opt-in): 해당 id를 `identityQuestions`와 `requiredIdentityQuestions` 양쪽에 넣는다 (`requiredIdentityQuestions`는 `identityQuestions`의 부분집합이어야 한다). **이 opt-in은 Owner 승인이 필요하다.** 승인 없이 추가하지 않는다.
- 참고: 필수 이름 문항은 이름을 쓰고 싶지 않은 응답자에게도 무언가 적도록 강제하므로 개인정보 수집을 사실상 유도한다. 그래서 기본값을 선택으로 뒀다.

## 6. 호스팅 리포트(비공개)

웹 리포트(`reports/`)를 정적 번들로 만들어 비공개 호스트(Vercel)에 올릴 수 있다. 번들에는 코드와 설정(`report-config.json`)만 들어가며 응답·설문 콘텐츠·`.env`·`wrangler.toml`은 들어가지 않는다.

```
node tools/build-report-site.mjs --out dist/report-site \
  --collector https://<worker-host> \
  --survey-base https://<pages-host>/<path>/surveys/ \
  [--default-survey <id>] [--surveys <id>,<id>]
```

- 출력: `reports/{index.html,report.js,styles.css,report-config.json}`, `engine/themes.css`, `lib/*.mjs`(리포트가 쓰는 모듈만), `vercel.json`(`/` → `/reports/`, CSP·`no-store`·`frame-ancestors 'none'` 등 헤더). `--out`은 `dist/` 아래만 허용한다.
- 리포트 비밀번호(`REPORT_SECRET`)는 **화면에서 직접 입력**한다. 설정 파일·URL·빌드 인자에 넣지 않으며 이 탭의 sessionStorage에만 남는다. 빌더는 비밀처럼 보이는 내용이 출력에 있으면 빌드를 실패시킨다.
- **Vercel Deployment Protection(비밀번호/SSO 보호)을 반드시 켠다.** 번들 자체는 정적 파일이라 접근 제어는 호스트 보호에 의존한다. collector의 `ALLOWED_ORIGINS`에 리포트 배포 origin을 추가해야 응답을 읽을 수 있다.
- 화면: 요약 KPI · 영역/문항별 점수 막대(기준선) · 선택형 분포 · 참여 구분별 비교 · 주관식(관련 점수 포함) · `Excel 다운로드`(브라우저에서 `tools/report.mjs`와 같은 6개 시트 생성). 기존 표/복사/AI 프롬프트는 "데이터 / 복사"에 있다.

### 비공개 호스팅에서 비밀번호 입력 없이 열기 (`--embed-report-secret`)

비밀번호 입력 없이 바로 결과를 보려면 빌드할 때 리포트 비밀번호를 번들에 넣는다. **선택 사항이며 기본은 꺼져 있다.**

```
node tools/build-report-site.mjs --out dist/report-site-private \
  --collector https://<worker-host> --survey-base https://<pages-host>/<path>/surveys/ \
  --default-survey <id> --embed-report-secret [<env 파일>]
```

- `<env 파일>` 기본값은 `/home/box/.config/survey-factory/collector-secrets.env`. 이 파일에서 `REPORT_SECRET=` 한 줄만 읽는다. `ADMIN_SECRET`은 절대 넣지 않으며, 두 값이 겹치면 빌드를 거부한다.
- 값은 `reports/report-secret.json`(`{"reportSecret": "..."}`) 한 파일에만 들어간다. `report-config.json`에는 비밀이 없다. 값은 출력하지 않고 `embedded REPORT_SECRET (N chars)`만 표시한다. `.gitignore`가 `report-secret.json`을 제외한다.
- `--out`이 저장소 안이면 git이 무시하는 위치(`dist/`)일 때만, 저장소 밖이면 항상 허용한다. 확인할 수 없으면 거부한다. 비밀 스캐너는 이 파일 하나만 예외로 허용하고, 그 밖의 비밀처럼 보이는 내용이나 같은 값이 다른 파일에 있으면 빌드를 실패시킨다.
- **이 번들은 Vercel 업로드에만 쓴다.** GitHub Pages 등 공개 호스트·저장소·로그에 올리지 않는다.
- 보호는 **Vercel Authentication(ALL deployments)** 에 전적으로 의존한다. 로그인하지 않은 사람은 `report-secret.json`을 받을 수 없어야 한다. 보호가 꺼진 배포에 올리면 비밀번호가 그대로 공개된다.
- Worker(collector)는 여전히 `REPORT_SECRET`을 요구한다. 파일이 있으면 리포트 페이지가 비밀번호 칸을 숨기고 그 값으로 요청하며(sessionStorage에는 저장하지 않음) 기본 설문(`--default-survey` 또는 `?survey=`)을 열자마자 불러온다. 설문을 바꾸고 `불러오기`를 누르면 다시 불러온다. 파일이 없으면 기존처럼 비밀번호를 직접 입력한다.
- 비밀번호를 바꾸면(Worker 교체) 다시 빌드·업로드한다.
