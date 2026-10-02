// Single URL rule: {baseUrl}/surveys/{surveyId}/ (+ optional ?ref=CODE)
export function surveyUrl(baseUrl, surveyId, ref) {
  if (!baseUrl) throw new Error('baseUrl required');
  if (!surveyId) throw new Error('surveyId required');
  const base = String(baseUrl).replace(/\/+$/, '');
  const url = `${base}/surveys/${surveyId}/`;
  return ref ? `${url}?ref=${encodeURIComponent(ref)}` : url;
}
