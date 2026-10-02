# DEPLOY_APPROVAL — 공개 배포 승인 요청 (초안)

Status: **Draft — Opus 5.5 final review pending**

공개 URL 배포는 Owner 승인 사항이다. 에이전트는 이 문서의 승인 전까지 어떤 것도 공개하지 않는다 (`tools/deploy.mjs` 는 `--dry-run` 이 기본이고 실제 경로는 `--confirm` 이 필요하다).

## 1. 선택지 요약

| | Option 1 — GitHub Pages | Option 2 — Cloudflare (Pages + Worker + D1) |
|---|---|---|
| 호스팅 | 기존 `galincia-hub` 계정의 Pages | Cloudflare Pages 프로젝트 |
| 변형 | 1a. 기존 `galincia-hub/MD` 안의 `surveys/<id>/` 경로 · 1b. 새 전용 저장소 | 단일 |
| 추가 계정 | 없음 | Cloudflare 계정 (무료) |
| 비용 | 0원 (공개 저장소 기준) | 0원 (무료 플랜 한도 내, verify — COLLECTOR_DECISION 참고) |
| 정적 페이지 URL | `https://galincia-hub.github.io/<repo>/surveys/<id>/` | `https://<project>.pages.dev/surveys/<id>/` |
| 응답 수집기 (collector) | 호스팅과 무관. Worker+D1 은 Cloudflare 가 필요하고, Adora 는 기존 Google Form 사용 | 같은 계정에서 Worker+D1 을 함께 운영 |
| 서버측 자동 마감 | Pages 자체는 불가. collector 가 Worker 면 가능, Google Form 이면 불가(수동) | Worker 가 410 으로 집행 |
| 하위 경로 | `/<repo>/…` 하위 경로 (번들은 상대 URL 이라 문제 없음) | 도메인 루트 |

URL 규칙 (단일 함수 `lib/url.mjs`): `{baseUrl}/surveys/{surveyId}/` (+ 선택 `?ref=CODE`).
- 1a: baseUrl `https://galincia-hub.github.io/MD` → `https://galincia-hub.github.io/MD/surveys/<id>/`
- 1b: baseUrl `https://galincia-hub.github.io/<new-repo>` → `https://galincia-hub.github.io/<new-repo>/surveys/<id>/`
- 2: baseUrl `https://<project>.pages.dev` → `https://<project>.pages.dev/surveys/<id>/`

## 2. Option 1 — GitHub Pages

**1a. 기존 `galincia-hub/MD` 에 경로 추가**
- 장점: 이미 켜져 있고 Adora 현행 페이지(`/MD/adora-ship-visit-0929/survey/`)와 같은 도메인. 신규 계정 없음.
- 단점: 다른 프로젝트 콘텐츠와 한 저장소를 공유 → 커밋/권한 범위가 넓다. 팩토리는 `surveys/<id>/` 경로만 스테이징하고 기존 파일은 건드리지 않지만, 잘못된 add 가 기존 설문을 덮을 위험을 사람이 줄여야 한다.
- 설정: (1) 저장소에 `surveys/<id>/` 번들 복사 (2) 해당 경로만 커밋/푸시 (3) Pages 설정은 기존 그대로.

**1b. 새 전용 저장소**
- 장점: 팩토리 산출물만 격리. 기존 `MD` 저장소와 Adora 현행 페이지에 영향 없음. 권한/삭제/롤백이 단순.
- 단점: 새 저장소 생성 + Pages 활성화 필요(공개 저장소). URL 도메인 경로가 달라져 Adora 기존 링크와 별개.
- 설정: (1) 새 저장소 생성(공개) (2) Pages 소스 지정 (3) 번들 푸시.

**공통**
- 공개 저장소이므로 `survey.json`(질문·소개문·마감 등)은 누구나 읽을 수 있다. 설문 페이지 자체가 공개이므로 이는 같은 수준의 노출이지만, 아직 배포하지 않은 설문의 초안은 저장소에 올리지 않는다 (배포 시점에만 `published/<id>/` 를 푸시).
- **응답은 저장소에 절대 들어가지 않는다.** 응답은 collector(D1 또는 Google Sheet)에만 쌓이고, `.gitignore` 가 `*.jsonl`, `*.xlsx`, `.wrangler/`, `reports/out/` 를 막는다.
- 유지보수: 새 설문마다 푸시 1회. 마감은 collector 가 Google Form 이면 수동, Worker 면 자동.

## 3. Option 2 — Cloudflare (Pages + Worker + D1)

- 필요한 것: Cloudflare 계정(무료), `wrangler` 로그인(또는 API 토큰은 Owner 가 직접 설정; 에이전트에게 토큰을 주지 않는다).
- 설정 단계 (1회):
  1. `wrangler d1 create survey-factory` → `database_id` 를 `collector/wrangler.toml`(비공개, 저장소 제외)에 기입
  2. `wrangler d1 execute survey-factory --remote --file collector/schema.sql`
  3. `wrangler secret put REPORT_SECRET` / `ADMIN_SECRET`
  4. `ALLOWED_ORIGINS` 에 Pages URL 지정 후 `wrangler deploy`
  5. Pages 프로젝트 생성, `published/*` 업로드 (전체 사이트 스냅샷이므로 다른 설문의 바이트가 매니페스트와 같은지 먼저 검증)
  6. 설문마다 `PUT /v1/admin/surveys/:id` 로 레지스트리 등록 (배포 도구가 호출)
- 장점: 한 계정에서 정적 + 수집 + 서버측 마감 + 명확한 오류. 루트 도메인.
- 단점: 새 계정과 비밀 관리가 필요. Pages 는 사이트 전체 스냅샷을 올리므로 다른 설문의 보존 검증 절차가 필수(도구에 포함).
- 공개 노출: 정적 설문 콘텐츠는 `*.pages.dev` 에서 공개. 응답은 D1 에 있고 `REPORT_SECRET` 없이는 읽을 수 없다. 저장소에는 올라가지 않는다.
- 유지보수: 비밀 회전, D1 백업(`wrangler d1 export`), 한도 확인.

## 4. 조합 (권장 구성)

| 시나리오 | 호스팅 | collector |
|---|---|---|
| Adora (마감 10/6, 10/4 배포 가능 상태 필요) | Option 1 (기존 도메인 계열) | 기존 Google Form 유지 (마감은 수동으로 "응답 받지 않음") |
| 이후 신규 설문 | Option 1b 또는 Option 2 | Worker + D1 (자동 마감) |

## 5. 권고

1. **Adora:** 새 계정 없이 가능한 **Option 1** 로 10/4 까지 공개 준비. 기존 `MD` 저장소를 건드리지 않으려면 **1b(새 전용 저장소)** 를 권한다 (격리, 롤백 단순). 1a 를 택하면 `surveys/<id>/` 외 경로는 스테이징하지 않는 기존 규칙을 따른다.
2. **팩토리 기본:** 신규 설문부터 **Cloudflare Worker + D1** collector 를 사용 (COLLECTOR_DECISION). 정적 호스팅은 GitHub Pages 를 그대로 써도 되고, 계정을 만든 김에 Pages 로 합쳐도 된다 (Option 2).
3. Cloudflare 를 승인하지 않으면: Google Form 공유 1개 + 수동 마감으로 대체 (단점은 COLLECTOR_DECISION 표 참조).

## 6. Owner 가 한 번에 승인할 항목

체크박스로 표시해 회신하면 된다 (승인 전에는 아무것도 공개하지 않는다).

- [ ] **호스팅:** Option 1a (`galincia-hub/MD`) / Option 1b (새 저장소 이름: `________`) / Option 2 (프로젝트 이름: `________`)
- [ ] **공개 범위:** `https://…/surveys/<id>/` 정적 페이지를 인터넷에 공개 (설문 문구가 공개됨). 응답은 저장소에 올리지 않음.
- [ ] **collector:** 신규 설문은 Cloudflare Worker + D1 (Cloudflare 무료 계정 생성/연결 승인). Adora 는 기존 Google Form 유지.
- [ ] **배포 실행 주체:** Owner 가 직접 / 지정한 에이전트가 `--confirm` 으로 (대상 설문 id: `________`)
- [ ] **비용:** 무료 한도 내 사용에 동의 (한도 근접 시에만 Owner 에게 별도 보고)

승인 후 에이전트가 수행하는 일: `node tools/deploy.mjs <id> --target … --dry-run` 결과를 먼저 제출 → Owner 확인 → `--confirm`. 이후 URL 을 보고하고 카카오 배포문(`tools/distribute.mjs`)을 생성한다.

## 7. 아직 확정되지 않은 것

- Cloudflare 무료 한도 수치는 배포 전 공식 문서로 확인 (COLLECTOR_DECISION "확인 필요").
- `tools/deploy.mjs`, `docs/OPERATION.md` 는 별도 작업 (이 문서는 그 계획과 일치하도록 작성됨).
- Opus 5.5 최종 검토 후 수정될 수 있음.
