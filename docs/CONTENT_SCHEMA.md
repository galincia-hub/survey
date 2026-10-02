# Content schema and reference mapping

Runtime source: `surveys/<surveyId>/survey.json`. Validate with `node tools/validate.mjs <file>`. Unknown properties and malformed values are rejected. Dates use ISO calendar dates; deadline is an explicit ISO timestamp with timezone. Closing time for a whole Korean calendar day is encoded as `23:59:59+09:00`.

| Reference | Unified content |
|---|---|
| meta.title/eventDate | title/eventDate |
| meta.areas | ordered sections with id/title/subtitle/en/theme |
| meta.scoreGuide | scale; baselineLabel retained, baselineName added for axis |
| C list | sections[].questions, original order within each area |
| score20 | score, preserving min/max/baseline |
| text | text, default maxLength 1000; linkedScores references same-section scores |
| script.js intro/category/page copy | intro/respondent/page/distribution |
| ui-patch.js | content emphasis/highlight; allTextRequired conversion option |
| config/form-submit payload constants | version and payload.format/surveyType |

`tools/convert-reference.mjs <questions.json> <presentation.json> <output.json>` performs the conversion. The checked-in reference-presentation file is a conversion input, never loaded by the engine. Runtime needs only survey.json. Conversion inputs live in source/ and are never served or published.

Scale values are integers satisfying min < baseline <= max. Individual score questions may override bounds. An untouched slider has no numeric answer. `NA` means not evaluated, never numeric zero; future reporting must exclude it from both sums and valid counts.

Questions support score, text, singleChoice and multiChoice. Every question declares required. Text defaults to 1000 characters and is trimmed at collection, matching live; required text must include a non-whitespace character. Choice options must be unique. linkedScores targets must exist and be score questions. IDs are unique across sections/questions and restricted to safe identifiers.

All displayed survey-specific text belongs in content. `intro.highlightText` is plain text highlighted only within the selected `emphasisParagraph`; arbitrary HTML is escaped. `theme`/section themes choose default, sage, soft-blue, warm-beige or lavender palettes. UI control labels are shared Korean interface strings.

Identity prompts require both `privacy.allowIdentity: true` and the question ID in `privacy.identityQuestions`; the boolean alone never bypasses the check. **Privacy minimization (Owner decision 2026-10-02 12:03 KST): identity questions are optional by default.** A question listed in `identityQuestions` must have `required: false`, unless its ID is also listed in the opt-in field `privacy.requiredIdentityQuestions` (an array of IDs that must be a subset of `identityQuestions`); otherwise the validator fails with a clear message. Using `requiredIdentityQuestions` needs Owner approval. The converted real reference (Adora) lists `identityQuestions: ["R04"]` and `requiredIdentityQuestions: ["R04"]` solely to preserve its existing final question, which asks for a name and stays required for parity with the live UI patch. The sample uses false and an empty allowlist. No independent name/company fields are added. Intake never adds `requiredIdentityQuestions`.

| SPEC response | Legacy response |
|---|---|
| surveyId | X-Survey-Id transport header / stored envelope |
| version | version |
| ref | ref, legacy default empty string; standard default 미지정; supplied value trimmed/uppercased |
| respondentCategory | affiliation |
| answers | answers, original question IDs and number / NA / string values |
| submittedAt | submittedAt |
| — | surveyType from content |

Standard mode includes surveyId and respondentCategory directly. Legacy mode has exactly the six original keys. Both preserve raw payload JSON in the local mock. No production endpoint is retained or enabled in Phase A.
