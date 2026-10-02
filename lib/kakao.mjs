import { surveyUrl } from './url.mjs';

// The forbidden word is built from code points so the literal never appears in source.
export const FORBIDDEN_WORD = String.fromCodePoint(0xc775, 0xba85);
export const containsForbidden = (text) => String(text).includes(FORBIDDEN_WORD);

function deadlineLabel(survey) {
  if (survey.distribution?.deadlineText) return survey.distribution.deadlineText;
  const d = new Date(survey.deadline);
  if (Number.isNaN(d.getTime())) return '';
  const kst = new Date(d.getTime() + 9 * 3600e3);
  return `응답 마감: ${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

/** SPEC 13: greeting, thanks, purpose, whyYou, usage, ask, ripple, URL, deadline, sender. */
export function buildKakao(survey, { url, baseUrl, ref } = {}) {
  const link = url ?? surveyUrl(baseUrl, survey.surveyId, ref);
  const d = survey.distribution ?? {};
  const name = survey.eventName || survey.title;
  const parts = [
    d.greeting || '안녕하세요.',
    d.thanks || `${name}에 함께해 주셔서 감사합니다.`,
    d.purpose || `${survey.title}을(를) 진행합니다.`,
    d.whyYou,
    d.usage,
    d.ask || '잠시 시간을 내어 적극적으로 참여해 주시면 큰 도움이 됩니다.',
    d.ripple || '함께하신 주변 분들께도 참여를 권해 주세요.',
    `▶ 설문 참여: ${link}`,
    deadlineLabel(survey),
    d.sender,
  ].filter((x) => x);
  const text = parts.join('\n\n') + '\n';
  if (containsForbidden(text)) throw new Error('kakao text contains forbidden word');
  return text;
}
