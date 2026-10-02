export const defaults = Object.freeze({
  start:'설문 시작하기', back:'이전', submit:'제출하기', submitting:'제출 중…', retry:'다시 제출하기',
  placeholder:'자유롭게 적어주세요.', selectedScore:'선택 점수',
  moveHint:'점수 배정을 위해서는 슬라이드를 움직여주세요.', unable:'평가하기 어려움', unableHelp:'(경험하지 못함)',
  requiredText:'답변을 해주셔야만 설문을 완성할 수 있습니다.', requiredAnswer:'이 문항에 답해주세요.',
  requiredSummary:'필수 문항을 확인해주세요.', counter:'최대 {max}자 · 현재 {current}/{max}',
  thanks:'감사합니다.', closed:'응답이 마감되었습니다.',
  submitError:'응답 저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 눌러주세요.',
  loadError:'설문을 불러오지 못했습니다. 잠시 후 다시 접속해주세요.'
});
export function message(content,key,values={}) {
  const text=content?.messages?.[key] ?? (key==='categoryRequired'?content?.respondent?.label:key==='done'?content?.page?.done:defaults[key]) ?? '';
  return text.replace(/\{(\w+)\}/g,(match,name)=>values[name] ?? match);
}
