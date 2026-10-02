#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { surveyUrl } from '../lib/url.mjs';
import { buildKakao } from '../lib/kakao.mjs';

export async function distribute(survey, baseUrl, outDir) {
  const url = surveyUrl(baseUrl, survey.surveyId);
  const notice=buildKakao(survey,{url}); // Validate notice before producing any files.
  fs.mkdirSync(outDir, {recursive:true});
  await QRCode.toFile(path.join(outDir, 'qr.png'), url, { width: 480, margin: 4, errorCorrectionLevel: 'M' });
  fs.writeFileSync(path.join(outDir, 'kakao.txt'), notice);
  fs.writeFileSync(path.join(outDir, 'link.txt'), url + '\n');
  return url;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
  if (!args[0] || !opt('--base-url') ) {
    console.error('usage: distribute.mjs <surveyId|surveyJsonPath> --base-url <url> [--out <dir>]');
    process.exit(2);
  }
  const survey = JSON.parse(fs.readFileSync(args[0].endsWith('.json')?args[0]:path.join('surveys',args[0],'survey.json'), 'utf8'));
  console.log(await distribute(survey, opt('--base-url'), opt('--out')||path.join('dist',survey.surveyId)));
}
