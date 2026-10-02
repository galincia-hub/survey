# COLLECTOR_DECISION — 응답 저장소 선택

Status: Draft — Opus 5.5 final review pending
Consistent with `docs/DESIGN.md` §4 (Worker + D1 default; Adora keeps `google-form`).

## 결론

| 대상 | 저장소 | 이유 |
|---|---|---|
| 팩토리 기본값 (신규 설문) | **공용 Cloudflare Worker + D1** | 실패가 보이고, 서버에서 마감이 걸리고, 설문 추가 시 백엔드 코드 수정이 없다. |
| Adora (`adora-ship-visit-001`) | **`google-form` 어댑터 유지** | 이미 운영 중인 Form/Sheet와 데이터 연속성, 마감 10/6이라 이전할 시간이 없고 새 계정 승인이 필요 없다. 리포트는 Sheet CSV(`--source gform-csv`)로 읽는다. |
| Owner 가 Cloudflare 를 승인하지 않을 때 | 공용 Google Form 1개 (payload 장문 필드 1개, surveyId 는 payload 안) | 수동 마감, 실패 비가시를 감수. 아래 표의 Google Form 열과 같다. |

## 비교

| 기준 | Google Form `formResponse` (live 방식) | 공용 Cloudflare Worker + D1 |
|---|---|---|
| 단순성 | 코드 없음. Form 1개 + Sheet. 설문마다 Form 을 만들 필요는 없다 (공용 Form 1개 가능). | Worker 1개 + D1 1개를 한 번 배포. 이후 설문은 레지스트리 행(데이터)만 추가. |
| 무료 한도 (아래 "확인 필요" 참고) | 무료. Google 계정 한도 내. 공개된 응답 건수 상한 없음(Sheet 셀 한도 있음). | 무료 플랜 한도가 예상 트래픽(수십~수백 건)보다 훨씬 큼. |
| 원본 payload 보존 | 예. 장문 필드 1개에 JSON 그대로, Sheet 에 `타임스탬프 / payload`. | 예. `responses.raw TEXT` 에 요청 본문을 바이트 그대로 (테스트: 읽기 시 byte-equal). |
| 서버측 자동 마감 | **불가.** Form 전체 수동 토글(응답 받지 않음)만 가능. 리포트에서 `receivedAt > deadline` 표시만 가능. | **가능.** 레지스트리의 deadline(해당 일 23:59:59.999 KST 까지) 또는 `status=closed` → HTTP 410 `survey_closed`. 화면이 닫힘 안내를 표시. |
| 설문 추가 시 백엔드 변경 | 공용 Form 1개면 없음. | 없음 (`PUT /v1/admin/surveys/:id` 로 레지스트리 upsert, 배포 도구가 호출). |
| 결과 접근 보호 | Google 계정 권한(강함). 단 리포트를 쓰려면 CSV 를 수동으로 내보내야 한다. | `REPORT_SECRET` Bearer (상수시간 비교, 미설정이면 항상 401). 리포트 페이지가 API 를 직접 읽는다. 비밀번호는 입력값으로만, sessionStorage 에만 둔다. |
| 실패 명확성 | **불명확.** `no-cors` 불투명 응답이라 성공을 가정한다. 네트워크 오류 외에는 실패를 감지할 수 없다. | **명확.** 실제 201/400/404/410/413 JSON. 응답자에게 오류를 보여줄 수 있다 (SPEC 9 "실패 시 명확한 오류"). |
| 중복 제출 | 구분 없음. | 선택 `X-Submission-Id` 로 재시도 멱등 (본문은 그대로). |
| 로컬 테스트 | mock 으로만 (실제 Form 에는 절대 전송하지 않음). | `wrangler dev --local` + 로컬 D1, 그리고 동일 계약의 Node mock. 두 구현이 같은 계약 테스트를 통과한다. |
| Owner 승인 | 불필요 (이미 존재). | 필요: Cloudflare 계정(무료) 생성/연결. |

## 무료 한도 (Cloudflare) — **확인 필요**

이 환경에서는 외부 문서를 조회하지 않았다. 아래 수치는 2025년까지 Cloudflare 문서에 게시되던 값을 기억에 따라 적은 것이며 **2026년 현재 값은 배포 전에 확인(verify)해야 한다**: developers.cloudflare.com 의 Workers → Platform → Limits, D1 → Platform → Limits / Pricing.

| 항목 | 무료 플랜 값 (verify) | 팩토리 사용량 |
|---|---|---|
| Workers 요청 | 하루 100,000 건 | 설문당 수십~수백 건 |
| Workers CPU | 호출당 10 ms | 검증 + 1 쿼리, 충분 |
| D1 읽기 행 | 하루 5,000,000 | 리포트 1회 = 응답 수 행 |
| D1 쓰기 행 | 하루 100,000 | 응답 1건 = 1 행 |
| D1 저장 | 5 GB (계정 전체) | 응답 1건 ≈ 수 KB (본문 상한 64 KB) |
| Pages 정적 요청 | 무제한 (verify) | — |

한도 초과 시 동작(차단 vs 과금)도 계정 설정과 함께 확인한다. 유료 서비스는 필수가 아니며, 한도에 근접할 경우에만 Owner 에게 보고한다.

## 위험과 완화

- **Worker 장애/계정 정지:** 원본은 D1 에 있다. 리포트 페이지는 jsonl/CSV 로도 읽을 수 있고, 배포 전 `wrangler d1 export` 로 백업한다 (OPERATION 에 절차 기재 예정).
- **비밀 유출:** `REPORT_SECRET` / `ADMIN_SECRET` 은 `wrangler secret` 에만 두고 저장소·프런트 코드에는 두지 않는다 (테스트가 정적 파일 스캔).
- **Google Form 경로의 마감 누락:** OPERATION 체크리스트에 마감일 "응답 받지 않음" 전환을 넣는다 (Adora 마감 10/6).

## 이 결정이 바꾸지 않는 것

기존 Adora 데이터와 Form/Sheet 는 수정하지 않는다. 엔진은 `survey.json.collector.adapter` 로 어댑터(`local-mock` / `worker` / `google-form`)를 고르며, 설문별 코드 변경은 없다.
