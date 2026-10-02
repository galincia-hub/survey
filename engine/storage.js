// Phase A only exposes a loopback adapter. No remote transport or form fallback.
export function makePayload(content, respondentCategory, answers, ref, now=new Date()) {
  const common={version:content.version,ref:ref?.trim().toUpperCase() || '미지정',answers:{...answers},submittedAt:now.toISOString()};
  return content.payload.format==='legacy'
    ? {version:common.version,ref:ref?.trim().toUpperCase() || '',affiliation:respondentCategory,surveyType:content.payload.surveyType,answers:common.answers,submittedAt:common.submittedAt}
    : {surveyId:content.surveyId,...common,respondentCategory};
}
export async function submitResponse(content, category, answers, ref) {
  const endpoint=new URL(content.collector.endpoint);
  if (!['127.0.0.1','localhost','[::1]'].includes(location.hostname) || content.collector.adapter!=='local-mock' || (endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1' || !endpoint.port || endpoint.pathname!=='/submit' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)) throw new Error('Only loopback mock submission is enabled');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Survey-Id':content.surveyId},body:JSON.stringify(makePayload(content,category,answers,ref)),signal:AbortSignal.timeout(10000)});
  if (!response.ok || !(await response.json()).ok) throw new Error('Submission not acknowledged');
}
