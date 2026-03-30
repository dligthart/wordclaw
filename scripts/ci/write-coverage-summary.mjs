import fs from 'node:fs';
import path from 'node:path';

const coverageInputs = [
  { label: 'Backend', file: 'coverage/coverage-summary.json' },
  { label: 'UI', file: 'ui/coverage/coverage-summary.json' },
];

function loadCoverageSummary(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.total ?? null;
}

function percent(metric) {
  return typeof metric?.pct === 'number' ? `${metric.pct.toFixed(2)}%` : 'n/a';
}

function totals(metric) {
  if (!metric || typeof metric.covered !== 'number' || typeof metric.total !== 'number') {
    return 'n/a';
  }

  return `${metric.covered}/${metric.total}`;
}

function combineMetric(metricName, summaries) {
  const totals = summaries
    .map((entry) => entry.summary?.[metricName])
    .filter((metric) => metric && typeof metric.total === 'number' && typeof metric.covered === 'number');

  if (totals.length === 0) {
    return null;
  }

  const total = totals.reduce((sum, metric) => sum + metric.total, 0);
  const covered = totals.reduce((sum, metric) => sum + metric.covered, 0);
  const skipped = totals.reduce((sum, metric) => sum + (metric.skipped ?? 0), 0);

  return {
    total,
    covered,
    skipped,
    pct: total === 0 ? 100 : (covered / total) * 100,
  };
}

function renderRow(label, summary) {
  return `| ${label} | ${percent(summary?.statements)} (${totals(summary?.statements)}) | ${percent(summary?.branches)} (${totals(summary?.branches)}) | ${percent(summary?.functions)} (${totals(summary?.functions)}) | ${percent(summary?.lines)} (${totals(summary?.lines)}) |`;
}

const loadedSummaries = coverageInputs.map((entry) => ({
  ...entry,
  summary: loadCoverageSummary(entry.file),
}));

const availableSummaries = loadedSummaries.filter((entry) => entry.summary);

let markdown = '## Coverage Summary\n\n';

if (availableSummaries.length === 0) {
  markdown += 'No coverage summaries were generated.\n';
} else {
  const combined = {
    statements: combineMetric('statements', availableSummaries),
    branches: combineMetric('branches', availableSummaries),
    functions: combineMetric('functions', availableSummaries),
    lines: combineMetric('lines', availableSummaries),
  };

  markdown += '| Surface | Statements | Branches | Functions | Lines |\n';
  markdown += '| --- | --- | --- | --- | --- |\n';
  markdown += `${renderRow('Combined', combined)}\n`;

  for (const entry of availableSummaries) {
    markdown += `${renderRow(entry.label, entry.summary)}\n`;
  }

  markdown += '\n';

  for (const entry of availableSummaries) {
    markdown += `- ${entry.label} summary: \`${path.normalize(entry.file)}\`\n`;
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
} else {
  process.stdout.write(markdown);
}
