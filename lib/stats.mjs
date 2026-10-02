// Pure statistics. "NA" and "" are excluded from numerator and denominator.
export function classify(v) {
  if (v === 'NA') return { kind: 'na' };
  if (typeof v === 'number' && Number.isFinite(v)) return { kind: 'valid', n: v };
  if (typeof v === 'string' && v.trim() !== '' && v !== 'NA' && Number.isFinite(Number(v))) return { kind: 'valid', n: Number(v) };
  return { kind: 'none' };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function scoreQuestions(survey) {
  const out = [];
  for (const s of survey.sections) for (const q of s.questions) if (q.type === 'score') out.push({ section: s, q });
  return out;
}

export function categoriesOf(survey, records) {
  const cats = [...(survey.respondent?.options ?? [])];
  for (const r of records) if (r.category && !cats.includes(r.category)) cats.push(r.category);
  return cats;
}

export function computeStats(survey, records) {
  const categories = categoriesOf(survey, records);
  const nByCategory = Object.fromEntries(categories.map((c) => [c, records.filter((r) => r.category === c).length]));
  const poolAll = [], poolArea = {}, poolCatArea = {}, poolCat = {};
  const questions = {};

  for (const { section, q } of scoreQuestions(survey)) {
    const baseline = q.baseline ?? survey.scale?.baseline ?? null;
    const valid = [], byCat = {};
    let na = 0, unanswered = 0;
    for (const r of records) {
      const c = classify(r.answers[q.id]);
      if (c.kind === 'na') na++;
      else if (c.kind === 'none') unanswered++;
      else {
        valid.push(c.n);
        (byCat[r.category] ??= []).push(c.n);
      }
    }
    const avg = mean(valid);
    questions[q.id] = {
      id: q.id, sectionId: section.id, avg, baseline,
      delta: avg === null || baseline === null ? null : avg - baseline,
      valid: valid.length, na, unanswered,
      min: valid.length ? Math.min(...valid) : null,
      max: valid.length ? Math.max(...valid) : null,
      byCategory: Object.fromEntries(categories.map((c) => [c, { avg: mean(byCat[c] ?? []), n: (byCat[c] ?? []).length }])),
    };
    (poolArea[section.id] ??= []).push(...valid);
    poolAll.push(...valid);
    for (const c of categories) {
      const v = byCat[c] ?? [];
      ((poolCatArea[c] ??= {})[section.id] ??= []).push(...v);
      (poolCat[c] ??= []).push(...v);
    }
  }

  const areas = {};
  for (const s of survey.sections) {
    if (!(s.id in poolArea)) continue;
    areas[s.id] = {
      id: s.id, title: s.title, avg: mean(poolArea[s.id]), valid: poolArea[s.id].length,
      byCategory: Object.fromEntries(categories.map((c) => [c, mean(poolCatArea[c]?.[s.id] ?? [])])),
    };
  }
  return {
    n: records.length,
    nByCategory,
    categories,
    questions,
    areas,
    overall: { avg: mean(poolAll), valid: poolAll.length },
    overallByCategory: Object.fromEntries(categories.map((c) => [c, mean(poolCat[c] ?? [])])),
  };
}
