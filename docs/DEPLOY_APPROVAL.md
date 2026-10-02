# DEPLOY_APPROVAL — 공개 배포 승인 요청

기준: `d8a3ddd` · Opus 5.5 최종 검토 + 재확인 반영 (2026-10-02) · 근거: `docs/REVIEW_OPUS_FINAL.md`

공개 URL 배포, 새 외부 계정 연결, 공개 범위 확대는 Owner 승인 사항이다. 승인 전에는 `tools/deploy.mjs`를 `--dry-run`으로만 실행한다. 실제 게시는 `--confirm`이 있어야 하며, 지금까지 한 번도 실행하지 않았다.
"확인 필요" 표시는 오프라인 환경에서 검증하지 못한 사실이다. 배포 전에 공식 문서로 확인한다.

## 1. 비교

| 항목 | Option 1 — GitHub Pages | Option 2 — Cloudflare (Pages + Worker + D1) |
|---|---|---|
| 변형 | 1a 기존 `galincia-hub/MD` 하위 경로 · 1b 새 전용 저장소 | 단일 계정에서 정적 페이지 + 수집 + DB |
| 비용 | 0원 (공개 저장소). 비공개 저장소의 Pages는 유료 플랜 필요 (확인 필요) | 0원 (무료 플랜 한도 내). 한도 수치와 초과 시 동작(차단/과금)은 확인 필요 (`COLLECTOR_DECISION.md`) |
| 필요한 계정 | 기존 `galincia-hub` GitHub | Cloudflare 계정 (무료, 신규) |
| 정적 URL 예시 | 1a `https://galincia-hub.github.io/MD/surveys/<id>/` · 1b `https://galincia-hub.github.io/survey/surveys/<id>/` (저장소 이름 `survey`일 때) | `https://<project>.pages.dev/surveys/<id>/` 또는 사용자 도메인 |
| collector 적합성 | Pages 자체는 저장 불가. 수집은 ① Google Form(공용 1개) 또는 ② Cloudflare Worker+D1 (계정 필요) | Worker+D1을 같은 계정에서 운영. 가장 자연스러움 |
| 자동 마감 | 화면: 마감 후 Closed 화면 (공통). 서버: Worker면 410으로 거부, Google Form이면 수동 "응답 받지 않음" | 화면 + Worker 410 (레지스트리 deadline/status) |
| 다른 설문 격리 | 해당 `surveys/<id>/` 경로만 `git add` (커밋·푸시는 사람이 검토 후) | 사이트 전체를 업로드하므로, 업로드 전 모든 번들의 manifest를 재검증 (도구에 포함) |
| 유지보수 | 설문마다 저장소에 1회 푸시 | 비밀 회전, `wrangler d1 export` 백업, 한도 확인 |

참고: 운영 주소 `<project>.pages.dev`에서는 Worker로 제출할 수 있다. 미리보기 배포(`<hash/branch>.<project>.pages.dev`)와 `*.vercel.app`에서는 외부 제출이 계속 차단된다 (`engine/storage.js` `isPreviewHost`, REVIEW M2 해결 @ `d8a3ddd`).

URL 규칙(단일 함수 `lib/url.mjs`): `{baseUrl}/surveys/{surveyId}/` (선택 `?ref=CODE`). Worker 주소 예: `https://survey-factory-collector.<계정 서브도메인>.workers.dev`

## 2. 공개 범위와 개인정보

- **응답은 어떤 저장소에도 들어가지 않는다.** 응답은 D1(또는 Google Sheet)에만 쌓인다. `.gitignore`가 `*.jsonl`, `*.xlsx`, `.wrangler/`, `reports/out/`, 비밀 파일, 회사·코드 매핑 파일을 막는다.
- 공개 저장소(Option 1)에는 배포한 설문의 번들(`index.html`, `survey.json`, `assets/`)만 올라간다. 질문, 소개문, 참여 구분(예: 회사 카테고리), 마감일이 공개된다. 페이지에서 이미 보이는 내용과 같은 수준이다. 배포하지 않은 초안과 팩토리 저장소 자체는 올리지 않는다.
- 결과 열람: Worker는 `REPORT_SECRET`(서버측 상수시간 비교, 미설정 시 항상 거부)이 있어야 응답을 내준다. 비밀은 `wrangler secret`에만 두고 프런트와 저장소에는 두지 않는다. Google Form은 Google 계정 권한으로 보호된다.
- 1a는 다른 프로젝트와 저장소를 공유하므로 권한과 실수 범위가 넓다. 1b는 팩토리 산출물만 격리되어 롤백과 삭제가 단순하다.

## 3. 설정 단계 (1회)

**Option 1b (권장 호스팅)**
1. `galincia-hub/survey` 공개 저장소 생성 → Settings › Pages에서 소스를 `main` / root로 지정
2. 로컬 clone 경로를 `--repo`로 지정 → `node tools/deploy.mjs <id> --target github-pages --base-url https://galincia-hub.github.io/survey --dry-run` → 검토 → `--confirm --repo <clone>` (해당 경로만 stage) → 사람이 커밋·푸시

**Cloudflare Worker + D1 (collector)**: Owner가 본인 계정으로 실행하고, 토큰은 에이전트에 주지 않는다.
1. `wrangler login` → `wrangler d1 create survey-factory` → `collector/wrangler.toml`(저장소 제외)에 `database_id` 기입
2. `wrangler d1 execute survey-factory --remote --file collector/schema.sql`
3. `wrangler secret put REPORT_SECRET` · `wrangler secret put ADMIN_SECRET`
4. `ALLOWED_ORIGINS = "https://galincia-hub.github.io"` → `wrangler deploy`
5. 설문마다 `--confirm` 시 도구가 `PUT /v1/admin/surveys/<id>`로 deadline을 등록 (`ADMIN_SECRET` 환경변수)
6. (Option 2 전체를 쓸 때만) Pages 프로젝트 생성 → `--target cloudflare --project <name>`. Worker `ALLOWED_ORIGINS`에 `https://<project>.pages.dev`를 추가한다.

## 4. Adora 처리 (10/4 기한)

- 실제 Adora 설문은 `galincia-hub/MD/adora-ship-visit-0929/survey/`에서 이미 공개되어 Google Form으로 수집 중이다.
- 팩토리의 `adora-ship-visit-001`은 동일성 검증용(질문·화면 0% 차이·payload 동일)이며 collector가 `local-mock`이라 게시가 거부된다.
- **권장 A: 현행 페이지를 그대로 유지한다.** 변경도 위험도 없다. 마감(10/6 23:59:59 KST)에는 OPERATION 체크리스트대로 Form을 "응답 받지 않음"으로 전환하고, CSV를 `tools/report.mjs --source gform-csv`로 리포트한다.
- B (선택): 팩토리 번들로 교체한다. content에 현행 Form action, `entry`, `allowedHosts: ["galincia-hub.github.io"]`를 넣고 검증과 dry-run을 거친 뒤 게시한다. 이 경우 R04(성함 유도 필수 문항, OPERATION §5) 처리도 함께 정해야 한다.

## 5. Owner가 한 번에 승인할 항목

- [ ] **호스팅:** 1b 새 공개 저장소 `galincia-hub/survey` (권장) / 1a `galincia-hub/MD` / Option 2 (사용자 도메인: `______`)
- [ ] **공개 범위:** 배포 설문의 정적 페이지와 `survey.json`을 인터넷에 공개 (응답은 저장소가 아닌 D1에만 저장)
- [ ] **collector:** Cloudflare 무료 계정 생성 + Worker 1개 + D1 1개 (신규 설문 기본, 서버측 자동 마감)
- [ ] **Adora:** A 현행 유지 (권장) / B 팩토리 번들로 교체 (+ R04: 필수 유지 / 선택으로 변경)
- [ ] **게시 실행:** Owner 직접 / 지정 에이전트가 dry-run 결과 제출 후 `--confirm` (대상 id: `______`)
- [ ] **비용:** 무료 한도 내 사용. 한도 근접 시에만 별도 보고

## 6. 권고

1. **호스팅은 Option 1b**(새 전용 GitHub Pages 저장소)로 한다. 추가 비용과 계정이 없고, 기존 `MD` 저장소와 격리되며, 현재 코드 그대로 동작한다.
2. **수집은 Cloudflare Worker + D1**로 한다. 이것이 Option 2에서 가져오는 부분이다. 실패가 보이고, 서버측 자동 마감이 되며, 설문을 추가해도 백엔드를 수정할 필요가 없다. Cloudflare를 승인하지 않으면 공용 Google Form 1개와 수동 마감으로 대체한다.
3. **Adora는 A(현행 유지).**
4. 코드 선행 작업은 남아 있지 않다 (REVIEW M1·M2·S4–S8·N11 해결 @ `d8a3ddd`). 결과 열람은 `REPORT_SECRET=… node tools/report.mjs <id> --source worker https://<worker-host>`(xlsx)로 한다. 웹 페이지를 쓰려면 `COLLECTOR_ORIGIN`을 지정한다 (`DEPLOYMENT.md`). Google Form 리다이렉트 동작은 여전히 확인 필요하며, Adora B안을 고를 때만 해당한다.
