# DEPLOYMENT — 배포 어댑터와 dry-run

Status: Draft (Sonnet 5.5, Opus 최종 검토 전) · 승인 범위는 `DEPLOY_APPROVAL.md`, 응답 저장소 선택은 `COLLECTOR_DECISION.md`.

## 1. 원칙

- 설문 하나 = 얼려진(frozen) 번들 하나: `dist/<id>/` (`surveys/<id>/index.html`, `survey.json`, 해시 이름의 `assets/*`, `_headers`, `manifest.json`).
- 번들은 상대 URL만 쓰므로 어떤 하위 경로(`/MD/…`)에서도 동작한다. CSP(`script-src 'self'`, `'unsafe-inline'` 없음, `form-action 'none'`, `connect-src`는 collector origin만)가 HTML `<meta>`와 `_headers` 양쪽에 들어간다.
- 빌드는 `survey.json` 검증(`validateFile`)을 먼저 통과해야 한다. 실패하면 아무것도 쓰지 않는다.
- 다른 설문의 바이트는 건드리지 않는다. 빌드는 `dist/<id>/` 한 폴더만 교체한다.
- 이미 `published/<id>/`가 있고 내용이 달라지면 `--allow-update` 없이는 거부한다. `published/*`의 매니페스트가 하나라도 어긋나면(변조) 어떤 빌드도 중단한다.

## 2. dry-run (기본)

```sh
node tools/deploy.mjs <surveyId> --target github-pages|cloudflare --base-url https://<host>/<prefix> --dry-run
```

- `--confirm`이 없으면 항상 dry-run이다. 계획(JSON: 대상, URL, 파일 목록, 레지스트리 요청, 게시 명령)만 출력하고 `dist/`에만 쓴다. `published/`, 저장소, 네트워크는 건드리지 않는다.
- `--dry-run`과 `--confirm`을 같이 주면 오류.
- 옵션: `--root <dir>`(테스트용 작업 루트), `--allow-update`, `--repo`, `--prefix`, `--project`.
- 배포 전 확인 순서: `node tools/validate.mjs …` → dry-run 출력 검토 → `node tools/distribute.mjs <id> --base-url …`(QR, 카카오문, 링크).

## 3. 어댑터

### A. github-pages (1a 기존 `galincia-hub/MD` · 1b 새 저장소)
- 하는 일: `published/<id>/surveys/<id>`를 `<repo>/<prefix>/surveys/<id>`로 복사하고 **그 한 경로만** `git add`. 커밋·푸시는 하지 않는다 (Owner/지정 에이전트가 검토 후 직접).
- 대상 경로가 이미 있으면 `--allow-update` 필요. `prefix`에 절대경로/`..`는 거부.
- 1회 설정: 저장소 준비(1b면 새 공개 저장소 + Pages 소스 지정), 로컬 clone 경로를 `--repo`로 지정.

### B. cloudflare (Pages + Worker + D1)
- 하는 일: Pages는 사이트 전체 스냅샷이므로 `published/*` 전체를 합쳐 업로드한다. 합치기 전에 **모든** 번들의 `manifest.json`을 다시 검증한다 (다른 설문 변조 시 중단). 이후 `wrangler pages deploy`.
- 1회 설정 (Owner 계정, 토큰은 에이전트에 주지 않음):
  1. `wrangler d1 create survey-factory` → `collector/wrangler.toml.example`을 `wrangler.toml`로 복사(저장소 제외)해 `database_id` 기입
  2. `wrangler d1 execute survey-factory --remote --file collector/schema.sql`
  3. `wrangler secret put REPORT_SECRET` · `wrangler secret put ADMIN_SECRET`
  4. `ALLOWED_ORIGINS`에 Pages URL 지정 후 `wrangler deploy` (Worker)
  5. Pages 프로젝트 생성 → `--project <name>`
- Worker collector 설문은 게시 후 `PUT <endpoint>/v1/admin/surveys/<id>`로 레지스트리(version, deadline, status)를 등록한다 (`ADMIN_SECRET` 환경변수 필요).

### collector 어댑터 (content `collector.adapter`)
| adapter | 용도 | 비고 |
|---|---|---|
| `local-mock` | 로컬 미리보기/테스트 | **배포 거부** (`--confirm`에서 차단) |
| `worker` | 신규 설문 기본 | HTTPS 필수, 서버측 마감 410, `X-Submission-Id` 멱등 |
| `google-form` | Adora | `endpoint`는 `https://docs.google.com/forms/d/e/<id>/formResponse`, `entry`(`entry.<digits>`), `allowedHosts` 필수. 현재 페이지 호스트가 `allowedHosts`에 있고 HTTPS일 때만 전송 (localhost/loopback/`*.pages.dev`/`*.vercel.app`는 항상 거부) |

## 4. `--confirm`이 하는 일 (실제 게시)

`--confirm`은 위 dry-run 빌드 + 실제 게시를 수행하는 유일한 경로다. 에이전트는 Owner 승인 전에는 실행하지 않는다.
1. `local-mock` 콘텐츠면 거부. github-pages는 `--repo`, cloudflare는 `--project` 필수. `worker`면 `ADMIN_SECRET` 필수.
2. `published/<id>/`를 갱신 (기존과 다르면 `--allow-update` 필요).
3. 어댑터 실행 (A: 해당 경로 스테이징만 / B: 전체 검증 후 업로드).
4. `worker`면 레지스트리 PUT.

## 5. CI 템플릿

`.github/workflows/survey-ci.yml`: 모든 `surveys/*/survey.json` 검증 → `npm test`(오프라인) → 모든 설문 `deploy --dry-run`. **배포 job과 비밀값은 없다.** 게시는 항상 수동·승인 후.

## 6. 테스트가 보장하는 것 (`tests/deploy`, `tests/flow-check.mjs`, `tests/intake-e2e.mjs`)
검증 실패 시 중단 · A 빌드 후 B 빌드해도 A의 바이트/매니페스트 불변 · `published/<id>` 덮어쓰기 거부 · github-pages는 자기 경로만 스테이징(다른 설문·무관 파일 불변, 커밋 없음) · cloudflare는 다른 번들 변조 시 중단 · `--confirm` 없이/`local-mock`은 거부.
