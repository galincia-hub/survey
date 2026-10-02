# INTAKE — 메모에서 survey.json 만들기

Status: Final (Opus 5.5 최종 검토 반영, 2026-10-02)

SPEC 15: 사용자는 "행사 / 대상 / 목적 / 비교기준 / 질문·콘텐츠 / 마감일" 정도만 준다. 에이전트는 이를 `surveys/<id>/survey.json` 하나로 바꾼다. 엔진·HTML·JS·저장 코드는 건드리지 않는다.
스키마: `schema/survey.schema.json`, 필드 설명: `docs/CONTENT_SCHEMA.md`.

## 1. 메모 형식

```
행사: <행사명>
행사일: 2026-11-03
대상: <응답 대상>
목적: <설문 목적 한두 문장>
비교기준: <예: 지난 행사 = 10점>      (없으면 생략)
마감일: 2026-11-10                     (YYYY-MM-DD, YYYY.MM.DD, YYYY년 M월 D일, 또는 오프셋 있는 ISO)
참여구분: 구분A, 구분B, 기타            (없으면 대상 값을 임시 사용)
발신자: <배포문 발신자>
질문:
## 영역 이름
- 점수형 질문
- 주관식 질문 (주관식)
- 단일 선택 (선택: 현장|온라인)
- 복수 선택 (복수: 교육|체험)
```

문항 표기: 기본은 점수형, 끝에 `(주관식)`, `(선택: a|b)`, `(복수: a|b)`. 이름·회사 질문은 메모가 명시적으로 요청했을 때만 `(식별허용)` 를 붙인다 (없으면 초안에서 제외하고 경고).

## 2. 절차

1. 메모 파일 작성 (예: `/tmp/memo.txt`).
2. surveyId 결정: kebab-case + `-NNN` (예: `ship-visit-002`). 기존 `surveys/` 의 id 는 재사용 금지.
3. 스캐폴드 생성 (결정적, LLM 없음):
   ```
   node tools/intake.mjs <memo.txt> --id <surveyId> [--out surveys/<id>/survey.json]
   ```
   - `surveys/<id>/survey.json` (초안)과 `survey.json.prompt.md` (에이전트용 프롬프트)를 쓴다.
   - 이미 있는 survey 폴더는 덮어쓰지 않고 실패한다. 금지어가 메모에 있으면 실패한다.
   - `TODO:` / `WARN:` 목록을 출력한다. 값이 없는 필수 항목은 `TODO(...)` 문자열로 남고, 검증을 통과하지 못한다 (의도된 동작: 사실을 지어내지 않는다).
4. 에이전트가 아래 프롬프트(또는 생성된 `.prompt.md`)로 초안을 다듬는다.
5. 검증: `node tools/validate.mjs surveys/<id>/survey.json` 통과까지 반복.
6. 미리보기 / 배포는 별도 절차 (DEPLOY_APPROVAL, OPERATION). `.prompt.md` 는 배포 번들에 포함되지 않는다 (번들은 survey.json 만 복사). 필요 없으면 지워도 된다.

## 3. 에이전트 프롬프트 (복사해서 사용)

```text
당신은 전문가 설문 콘텐츠 작성자입니다. 첨부한 메모와 tools/intake.mjs 가 만든 초안을 바탕으로 surveys/<id>/survey.json 을 완성하세요.
엔진·HTML·JS 는 수정하지 않습니다. survey.json 만 만듭니다.

규칙
- 질문의 질이 우선입니다. 전문가 대상 설문에 일반 소비자 만족도 문항을 쓰지 않습니다.
- 개선 요청이 목적이면 질문의 70~80% 이상을 현 상태 / 강점 / 약점 / 개선사항에 둡니다.
- 메모에 없는 사실(이름, 날짜, 수치, 회사, 장소)은 만들지 않습니다. 모르면 TODO로 남기고 보고합니다.
- 이름·회사명 질문은 메모가 명시적으로 요청한 경우에만 만들고, 그때는 해당 질문 id만 privacy.identityQuestions에 넣고 required: false 로 둡니다 (allowIdentity: true). 식별 질문을 필수로 만드는 privacy.requiredIdentityQuestions 는 절대 추가하지 않습니다 (Owner 승인 사항).
- 참여 구분은 필요 최소 범주로만 받습니다.
- 직접 경험하지 못한 항목을 위해 scale.allowNotEvaluated: true 를 유지합니다. 평가안함은 평균에서 제외됩니다.
- 각 영역의 점수형 질문에는 같은 영역의 주관식을 linkedScores 로 연결합니다.
- 금지어(U+C775 U+BA85 두 코드포인트로 이루어진 한국어 단어)는 survey.json 어디에도, 배포문에도 쓰지 않습니다. 글자를 직접 쓰지 말고 코드포인트로 검사합니다.
- surveyId 는 kebab-case + -NNN (예: ship-visit-002). 기존 surveys/ 의 id 를 재사용하지 않습니다.
- deadline 은 오프셋이 있는 ISO 형식 (예: 2026-10-06T23:59:59+09:00) 입니다.
- 기존 surveys/<id>/ 폴더를 수정하거나 덮어쓰지 않습니다. 새 폴더만 만듭니다.
- 최종 산출물은 schema/survey.schema.json 과 tools/validate.mjs 를 통과해야 합니다.

작업 순서
1. 메모에서 목적, 대상, 비교기준, 마감일을 확인하고 TODO 항목을 정리합니다 (메모에 답이 없으면 임의로 채우지 말고 최종 보고에 남깁니다).
2. 질문안을 영역별로 다듬습니다 (질문 문구, help, shortLabel). 점수형 질문에는 linked 줄에 쓰일 짧은 shortLabel 을 붙입니다.
3. 초안 JSON 을 수정해 surveys/<id>/survey.json 에 저장합니다.
4. node tools/validate.mjs surveys/<id>/survey.json 을 실행해 통과할 때까지 고칩니다.
5. 최종 보고: 변경 요약, 남은 TODO, 메모에 없어서 비워 둔 항목.
```

위 "규칙" 목록의 출처는 `lib/intake.mjs` 의 `INTAKE_RULES` 이며 (테스트가 이 문서와의 일치를 확인한다), 질문 설계 원칙은 expert-survey SKILL 을 따른다: 질문의 질 우선, 대상 전문성에 맞춤, 비교기준 명확화, 평가안함 허용·평균 제외, 점수와 주관식 연계, 주관식 원문 보존, 불필요한 개인정보 수집 금지.

## 4. 스캐폴드 기본값

| 항목 | 값 |
|---|---|
| 척도 | 비교기준 있음: 0~20, 기준 10 / 없음: 0~10, 기준 5 (중립, TODO 로 확인 요청) |
| 영역 | `## 영역` 행마다 1개, 테마 sage → soft-blue → warm-beige → lavender 순환 |
| 문항 id | Q01, Q02 … (전체 연번) |
| 점수형 | required: true, allowNotEvaluated: true |
| 주관식 | maxLength 1000, 같은 영역 점수형 전부 linkedScores. 영역에 주관식이 없으면 선택(required: false) 주관식 1개 자동 추가 |
| 응답 형식 | payload.format: standard |
| collector | 현재 스키마가 허용하는 local-mock 임시값. 배포 시 DESIGN §4 의 collector 설정으로 교체 |
| version | `<오늘>-v1` |
