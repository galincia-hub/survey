export class SurveyClosedError extends Error { constructor(){super('survey_closed');this.name='SurveyClosedError';} }
export function makePayload(content, respondentCategory, answers, ref, now=new Date()) {
  const common={version:content.version,ref:ref?.trim().toUpperCase() || '미지정',answers:{...answers},submittedAt:now.toISOString()};
  return content.payload.format==='legacy'
    ? {version:common.version,ref:ref?.trim().toUpperCase() || '',affiliation:respondentCategory,surveyType:content.payload.surveyType,answers:common.answers,submittedAt:common.submittedAt}
    : {surveyId:content.surveyId,...common,respondentCategory};
}
export function isLoopback(host){return host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||/^127\./.test(host);}
function safeEndpoint(value) {
  const url=new URL(value);
  if(url.username||url.password||url.hash||url.search || !(url.protocol==='https:' || (url.protocol==='http:'&&isLoopback(url.hostname))))throw new Error('Unsafe collector endpoint');
  // A local/preview origin can only send to loopback, regardless of content configuration.
  if(location.protocol!=='https:' || isLoopback(location.hostname) || /\.(pages\.dev|vercel\.app)$/.test(location.hostname)) {
    if(!isLoopback(url.hostname))throw new Error('External submissions disabled on local/preview pages');
  }
  return url;
}
export async function fetchWithTimeout(url,options,timeout=10000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
}
export async function submitResponse(content, category, answers, ref, options={}) {
  const config=content.collector;
  const payload=options.payload ?? makePayload(content,category,answers,ref);
  if(config.adapter==='google-form') {
    if(location.protocol!=='https:' || isLoopback(location.hostname) || /\.(pages\.dev|vercel\.app)$/.test(location.hostname) || !config.allowedHosts?.includes(location.hostname))throw new Error('Google Form disabled on this host');
    const action=safeEndpoint(config.endpoint);
    if(action.origin!=='https://docs.google.com' || !/^\/forms\/d\/e\/[^/]+\/formResponse$/.test(action.pathname) || !/^entry\.\d+$/.test(config.entry||''))throw new Error('Invalid form configuration');
    const body=new URLSearchParams({[config.entry]:JSON.stringify(payload)});
    await fetchWithTimeout(action,{method:'POST',mode:'no-cors',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString()});
    return {ok:true,confirmation:'opaque'};
  }
  const endpoint=safeEndpoint(config.endpoint);
  let target=endpoint.href,headers={'Content-Type':'application/json'};
  if(config.adapter==='local-mock') {
    if(!isLoopback(location.hostname) || endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1' || !endpoint.port || endpoint.pathname!=='/submit')throw new Error('Only loopback mock submission is enabled');
    headers['X-Survey-Id']=content.surveyId;
  }else if(config.adapter==='worker') {
    target=endpoint.href.replace(/\/$/,'')+'/v1/submit/'+encodeURIComponent(content.surveyId);
    headers['X-Submission-Id']=options.submissionId ?? crypto.randomUUID();
  }else throw new Error('Unsupported collector adapter');
  const response=await fetchWithTimeout(target,{method:'POST',redirect:'error',headers,body:JSON.stringify(payload)});
  if(response.status===410)throw new SurveyClosedError();
  if(!response.ok)throw new Error('Submission not acknowledged');
  const result=await response.json();
  if(!result.ok)throw new Error('Submission not acknowledged');
  return result;
}
