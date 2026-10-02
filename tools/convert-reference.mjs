import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function convert(bank, presentation) {
  const {conversion = {}, scale = {}, ...rest} = presentation;
  const list = bank[presentation.payload?.surveyType || 'C'];
  if (!Array.isArray(list)) throw new Error('Reference question list missing');
  return {
    ...rest, title: bank.meta.title, eventDate: bank.meta.eventDate,
    scale: {enabled:true, ...bank.meta.scoreGuide, baselineName:'', allowNotEvaluated:true, ...scale},
    sections: Object.entries(bank.meta.areas).map(([id, area], i) => ({
      id, ...area, theme:['sage','soft-blue','warm-beige','lavender'][i % 4],
      questions:list.filter(q=>q.area===id).map(({area, ...q}) => ({
        ...q, type:q.type==='score20'?'score':q.type,
        ...(q.type==='text'?{required:conversion.allTextRequired || !!q.required,maxLength:1000,
          linkedScores:list.filter(s=>s.area===id && s.type==='score20').map(s=>s.id)}:{})
      }))
    }))
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [source, presentation, out] = process.argv.slice(2);
  if (!out) throw new Error('Usage: node tools/convert-reference.mjs questions.json presentation.json output.json');
  const result = convert(JSON.parse(await readFile(source)),JSON.parse(await readFile(presentation)));
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
}
