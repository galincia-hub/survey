import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const schema = JSON.parse(await readFile(new URL('../schema/survey.schema.json',import.meta.url)));
export function checkSchema(value, rule, path='$', errors=[]) {
  const error = message => errors.push(`${path}: ${message}`);
  if (rule.enum && !rule.enum.includes(value)) error('value outside enum');
  if (rule.type) {
    const valid = rule.type==='array'?Array.isArray(value):rule.type==='object'?value!==null && typeof value==='object' && !Array.isArray(value):rule.type==='integer'?Number.isInteger(value):typeof value===rule.type;
    if (!valid) {error(`expected ${rule.type}`); return errors;}
  }
  if (typeof value==='string') {
    if (rule.minLength && value.trim().length<rule.minLength) error('empty string');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) error('invalid pattern');
    if (rule.format) {
      const date = value.slice(0,10);
      const realDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;
      if (!realDate || (rule.format==='date' && value!==date) || (rule.format==='date-time' && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))))) error(`invalid ISO ${rule.format}`);
    }
  }
  if (typeof value==='number' && (!Number.isFinite(value) || (rule.minimum!==undefined && value<rule.minimum))) error('number out of bounds');
  if (Array.isArray(value)) {
    if (value.length<(rule.minItems||0)) error('too few items');
    value.forEach((v,i)=>checkSchema(v,rule.items,`${path}[${i}]`,errors));
  } else if (value && typeof value==='object') {
    for (const key of rule.required||[]) if (!(key in value)) error(`missing ${key}`);
    for (const [key,v] of Object.entries(value)) {
      if (rule.properties?.[key]) checkSchema(v,rule.properties[key],`${path}.${key}`,errors);
      else if (rule.additionalProperties===false) error(`unknown property ${key}`);
    }
  }
  return errors;
}
export function validate(content) {
  const errors=checkSchema(content,schema);
  if (JSON.stringify(content).includes(String.fromCodePoint(0xc775,0xba85))) errors.push('Forbidden content term');
  if (errors.length) return errors;
  const qs=content.sections.flatMap(s=>s.questions);
  const ids=new Set();
  for (const item of [...content.sections,...qs]) {
    if (ids.has(item.id)) errors.push(`Duplicate id: ${item.id}`);
    ids.add(item.id);
    if (['__proto__','constructor','prototype'].includes(item.id)) errors.push('Reserved id');
  }
  const scaleOK=s=>s.min<s.baseline && s.baseline<=s.max && s.min<s.max && [s.min,s.max,s.baseline].every(Number.isInteger);
  if (!scaleOK(content.scale)) errors.push('Scale must satisfy integer min < baseline <= max');
  if (new Set(content.respondent.options).size!==content.respondent.options.length) errors.push('Duplicate respondent option');
  if (content.payload.format==='legacy' && !content.payload.surveyType) errors.push('Legacy payload needs surveyType');
  if (content.intro.emphasisParagraph!==undefined && content.intro.emphasisParagraph>=content.intro.paragraphs.length) errors.push('Invalid emphasis paragraph');
  for (const id of content.privacy.identityQuestions||[]) if (!qs.some(q=>q.id===id)) errors.push('Unknown identity question: '+id);
  for (const q of qs) {
    if (q.type==='score' && (!content.scale.enabled || !scaleOK({...content.scale,...q}))) errors.push(`${q.id}: invalid score scale`);
    for (const id of q.linkedScores||[]) if (!qs.some(t=>t.id===id && t.type==='score')) errors.push(`${q.id}: linked score missing or not score`);
    if (q.linkedScores && q.type!=='text') errors.push(`${q.id}: links only allowed for text`);
    if (q.type.endsWith('Choice') && (!q.options?.length || new Set(q.options).size!==q.options.length)) errors.push(`${q.id}: unique options required`);
    const identityText=[q.id,q.prompt,q.help||''].join(' ');
    if ((!content.privacy.allowIdentity || !content.privacy.identityQuestions?.includes(q.id)) && (q.identity || /성함|성명|이름|회사|소속|\b(name|company|employer|organization)\b/i.test(identityText))) errors.push(`${q.id}: identity collection needs explicit permission`);
  }
  return errors;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node tools/validate.mjs surveys/<id>/survey.json');
    const errors=validate(JSON.parse(await readFile(process.argv[2])));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS content schema and semantics');
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
