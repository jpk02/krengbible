// Builds the two fictional example input workbooks (Bluefield and Ridgeline).
const fs = require('fs');
const path = require('path');
const { workbook, S } = require('./xlsxwriter.js');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const h = (v) => ({ v, s: S.header });
const note = (v) => ({ v, s: S.note });
const inp = (v) => ({ v, s: S.input });

const LISTS = {
  'Current month': MONTHS,
  'Data labels': ['Both years', 'This year', 'None'],
  'Chart columns': ['Auto', '1', '2', '3'],
  'Negative numbers': ['Parentheses', 'Minus sign'],
  'Side panel type': ['Commentary', 'Table', 'Table + Commentary', 'None'],
  'Page size': ['Letter', 'A4'],
  'Include DSCR page': ['Auto', 'Yes', 'No'],
};

function instructionsSheet() {
  const lines = [
    [{ v: 'Monthly Dashboard Inputs', s: S.title }],
    [],
    [{ v: 'How to use', s: S.bold }],
    ['1.  Fill in the Settings, Charts, Footnotes, Table, Commentary and Side Table tabs.  Blue text on yellow = inputs.'],
    ['2.  Save this workbook.'],
    ['3.  Open the Dashboard Builder page in Edge or Chrome and drag this workbook onto it.'],
    ['4.  Click "Save as PDF" (or press Ctrl+P), choose "Save as PDF", and save.'],
    [],
    [{ v: 'Tabs', s: S.bold }],
    ['Settings  -  titles, labels, footer, and layout options.  The Notes column explains each one.'],
    ['               "Current month" drives the month and YTD columns of the table.  Current-year chart values after it are not shown.'],
    ['Charts  -  one row per chart / component / year with Jan-Dec values.  Leave months blank where there is no data yet.'],
    ['               Each distinct "Chart" name becomes its own chart.  Rows with a "Component" (e.g. Contracted, Merchant) are stacked.'],
    ['               Every chart shows the Prior year and Current year from Settings side by side, month by month.'],
    ['               Enter full precision here (e.g. 3.92); the Decimals column only controls how the chart labels are rounded.'],
    ['Footnotes  -  explain a month on a chart.  Pick the chart from the dropdown, or leave "Chart" blank to mark that month on every chart.'],
    ['               The month label gets a small number and the note prints under the charts.'],
    ['Table  -  any number of rows.  The variance is calculated for you; "Better When" sets whether it shows green or red.'],
    ['               Month Actual and YTD Actual (black cells) are formulas: rows with a "From Chart" sum that chart on the Charts tab for the'],
    ['               Current year, for the Current month and Jan through it (add a "From Component" to use one component, e.g. Contracted).'],
    ['               O&M expense defaults to Revenue - Operating income.  Type a number over any formula to override it; the PDF uses the cell value.'],
    ['               Rows with no "From Chart" and no formula: type the actuals yourself.'],
    ['               "EV Basis": if the EV Case values were pro-rated from quarterly, semi-annual or annual figures, pick that here.  The EV Case'],
    ['               values get a small letter (a, b, ...) and a footnote under the table explains it.  Monthly (the default) adds nothing.'],
    ['               "YTD Method": Sum (default) adds the months up; Average averages them (use for percentages like capacity factor).'],
    ['               Month EV Case and YTD EV Case are always typed in.'],
    ['Commentary  -  Heading + Text pairs for the bottom-right box.'],
    ['Side Table  -  a free-form grid for the bottom-right box.  Row 1 = column headers.  Values print exactly as they appear in Excel.'],
    ['Debt Service  -  quarterly cash flow for page 2.  One column per quarter, oldest on the left.  Role: Revenue, Expense or Debt service.'],
    ['               Enter expenses and debt service as positive numbers.  CFADS = Revenue - Expenses.  DSCR = CFADS / Debt service.'],
    ['               LTM DSCR = last 4 quarters of CFADS / last 4 quarters of debt service.  Add any expense or debt service rows you need.'],
    ['Reserves  -  one row per reserve account (DSR, O&M reserve, ...): Required balance and Balance available.  Shown on page 2 below the DSCR chart'],
    ['               with the % funded; anything under 100% is flagged.'],
    ['DSCR Notes  -  optional Heading + Text pairs shown on page 2 below the reserves.'],
    [],
    [{ v: 'Tips', s: S.bold }],
    ['-  Do not rename the tabs or the column headers in row 1.  You can add, delete or reorder rows freely.'],
    ['-  Copy this workbook for each asset (one workbook = one dashboard).'],
    ['-  The Chart dropdowns list the names on the Charts tab automatically (from a hidden "Lists" tab).  Add a chart there and it appears in the dropdowns.'],
    ['-  Your data never leaves your computer: the builder page reads the file locally in the browser.'],
  ];
  return { name: 'Instructions', rows: lines, widths: [140] };
}

function settingsSheet(settings) {
  const notes = {
    'Title': 'Large text in the top banner.',
    'Subtitle': 'Smaller line under the title.',
    'Period label': 'Shown at the top right of the banner.',
    'Header color': 'Hex color for the banner and section headers, e.g. #1F3B6E.',
    'Current year': 'Year whose values are the solid bars.',
    'Prior year': 'Year whose values are the lighter bars next to them.',
    'Current month': 'The month being reported.  Drives Month Actual and YTD (Jan through this month) in the table.',
    'Chart section title': 'Header above the charts.',
    'Data labels': 'Which bars get value labels: Both years / This year / None.',
    'Chart columns': 'Auto = 1 column for up to 3 charts, 2 columns for more.',
    'Table title': 'Header above the comparison table.',
    'Month heading': 'Heading over the monthly columns.  Leave blank to use the Current month (e.g. August).',
    'YTD heading': 'Heading over the year-to-date columns.  Leave blank for "YTD Through August".',
    'Actual label': 'Column label for actual values.',
    'Comparison label': 'Column label for the comparison case (EV Case, Budget, Forecast...).',
    'Variance label': 'Column label for the variance.',
    'Negative numbers': 'Parentheses: (1.8)   Minus sign: -1.8',
    'Side panel type': 'Commentary / Table / Table + Commentary / None.',
    'Side panel title': 'Header of the bottom-right box.',
    'Side panel width %': 'Width of the bottom-right box as a share of the page (15-50).',
    'Footer': 'Sources line at the bottom of the page.',
    'Page size': 'Letter or A4 (always landscape).',
    'Include DSCR page': 'Auto = add page 2 (Debt Service Coverage) when the Debt Service tab has data.  Yes / No to force it.',
    'DSCR page title': 'Header above the DSCR charts on page 2.',
    'Quarters shown': 'How many of the most recent quarters page 2 shows (1-8).  Enter 3 extra older quarters to show an LTM DSCR for every quarter shown.',
    'Distribution lock-up DSCR': 'Distribution lock-up covenant, e.g. 1.20.  Drawn as a reference line.  Leave blank and it does not appear anywhere.',
    'Default DSCR': 'Default covenant, e.g. 1.10.  Drawn as a reference line.  Leave blank and it does not appear anywhere.',
    'Pro-rated note': 'Optional wording for the EV Basis footnote under the table.  Blank = "EV Case pro-rated from quarterly figures on a straight-line monthly basis; it does not reflect seasonality within the quarter."  You can use {basis} (quarterly / semi-annual / annual), {period} (quarter / half-year / year) and {comparison} (the Comparison label).',
    'Reserves title': 'Header of the reserves box on page 2 (below the DSCR chart).',
    'Cash flow units': 'Units label for page 2, e.g. $MM or $000s.',
    'Cash flow decimals': 'Decimals in the page 2 cash flow table.',
  };
  const rows = [[h('Setting'), h('Value'), h('Notes')]];
  const validations = [];
  for (const [k, v] of settings) {
    rows.push([{ v: k, s: S.bold }, inp(v), note(notes[k] || '')]);
    if (LISTS[k]) validations.push({ range: `B${rows.length}`, list: LISTS[k] });
  }
  return { name: 'Settings', rows, widths: [24, 70, 90], freezeRows: 1, validations };
}

const decimalsIn = (vals) => Math.max(0, ...vals.filter((v) => v !== null).map((v) => (String(v).split('.')[1] || '').length));

function chartsSheet(series) {
  const rows = [[h('Chart'), h('Component'), h('Year'), h('Decimals'), ...MONTHS.map(h)]];
  for (const s of series) {
    const style = decimalsIn(s.values) >= 2 ? S.input2 : S.input1;
    rows.push([
      inp(s.chart), inp(s.component || ''), inp(s.year), inp(s.decimals),
      ...MONTHS.map((_, i) => (s.values[i] === undefined || s.values[i] === null ? { v: '', s: style } : { v: s.values[i], s: style })),
    ]);
  }
  return { name: 'Charts', rows, widths: [26, 16, 8, 10, ...MONTHS.map(() => 8)], freezeRows: 1 };
}

function footnotesSheet(items) {
  const rows = [[h('Chart'), h('Month'), h('Note')]];
  for (const [c, m, t] of items) rows.push([inp(c), inp(m), inp(t)]);
  for (let i = 0; i < 3; i++) rows.push([inp(''), inp(''), inp('')]);
  return {
    name: 'Footnotes', rows, widths: [28, 10, 100], freezeRows: 1,
    validations: [{ range: 'A2:A200', formula: 'ChartNames' }, { range: 'B2:B200', list: MONTHS }],
  };
}

// Defined names the Table formulas use, pointing at the Settings rows.
const MONTH_ARRAY = `{${MONTHS.map((m) => `"${m}"`).join(',')}}`;
function calcNames(settings) {
  const ref = (key) => `Settings!$B$${settings.findIndex(([k]) => k === key) + 2}`;
  const cm = ref('Current month');
  return [
    { name: 'CurYear', ref: ref('Current year') },
    { name: 'CurMonthNum', ref: `IF(ISNUMBER(${cm}),${cm},MATCH(LEFT(${cm},3),${MONTH_ARRAY},0))` },
  ];
}

// Charts tab layout: A Chart, B Component, C Year, D Decimals, E..P = Jan..Dec.
const monthFormula = (r) => {
  const base = `INDEX(Charts!$E$2:$P$500,0,CurMonthNum),Charts!$A$2:$A$500,$B${r},Charts!$C$2:$C$500,CurYear`;
  return `IF($C${r}="",SUMIFS(${base}),SUMIFS(${base},Charts!$B$2:$B$500,$C${r}))`;
};
const ytdFormula = (r) => `SUMPRODUCT((Charts!$A$2:$A$500=$B${r})*(Charts!$C$2:$C$500=CurYear)*((($C${r}="")+(Charts!$B$2:$B$500=$C${r}))>0)*(COLUMN(Charts!$E$1:$P$1)-COLUMN(Charts!$E$1)<CurMonthNum),Charts!$E$2:$P$500)/IF($D${r}="Average",CurMonthNum,1)`;

// Same math in JS, for the cached values written alongside the formulas.
function chartActuals(spec, t) {
  const get = (k) => (spec.settings.find(([key]) => key === k) || [])[1];
  const cy = get('Current year');
  const cur = MONTHS.indexOf(String(get('Current month')).slice(0, 3));
  const rows = spec.series.filter((r) => r.chart === t.from && r.year === cy && (!t.fromComp || r.component === t.fromComp));
  const monthSum = (m) => rows.reduce((a, r) => a + (r.values[m] ?? 0), 0);
  let ytd = 0;
  for (let m = 0; m <= cur; m++) ytd += monthSum(m);
  if (t.ytd === 'Average') ytd /= cur + 1;
  const round = (v) => Math.round(v * 1e6) / 1e6;
  return [round(monthSum(cur)), round(ytd)];
}

function tableSheet(spec) {
  const items = spec.table;
  const rows = [[
    h('Metric'), h('From Chart'), h('From Component'), h('YTD Method'),
    h('Prefix'), h('Suffix'), h('Decimals'), h('Better When'), h('Variance As'), h('Bold'),
    h('Month Actual'), h('Month EV Case'), h('YTD Actual'), h('YTD EV Case'), h('EV Basis'),
  ]];
  const rowOf = (metric) => items.findIndex((x) => x.metric === metric) + 2;
  const values = new Map();
  // Chart-linked rows first, so derived rows (e.g. O&M = Revenue - Operating income) can use their values.
  items.forEach((t) => { if (t.from) values.set(t.metric, chartActuals(spec, t)); });
  items.forEach((t) => {
    if (t.derive) {
      const [a, b] = t.derive.map((m) => values.get(m));
      values.set(t.metric, [Math.round((a[0] - b[0]) * 1e6) / 1e6, Math.round((a[1] - b[1]) * 1e6) / 1e6]);
    }
  });
  items.forEach((t, i) => {
    const r = i + 2;
    const st = t.dec >= 2 ? S.input2 : S.input1;
    const calc = t.dec >= 2 ? S.calc2 : t.dec === 0 ? S.calc0 : S.calc1;
    let mCell, yCell;
    if (t.from) {
      const [mv, yv] = values.get(t.metric);
      mCell = { f: monthFormula(r), v: mv, s: calc };
      yCell = { f: ytdFormula(r), v: yv, s: calc };
    } else if (t.derive) {
      const [mv, yv] = values.get(t.metric);
      const [ra, rb] = t.derive.map(rowOf);
      mCell = { f: `K${ra}-K${rb}`, v: mv, s: calc };
      yCell = { f: `M${ra}-M${rb}`, v: yv, s: calc };
    } else {
      mCell = { v: t.m[0], s: st };
      yCell = { v: t.y[0], s: st };
    }
    rows.push([
      inp(t.metric), inp(t.from || ''), inp(t.fromComp || ''), inp(t.ytd || 'Sum'),
      inp(t.prefix || ''), inp(t.suffix || ''), inp(t.dec), inp(t.better || 'Higher'),
      inp(t.varAs || ''), inp(t.bold || ''),
      mCell, { v: t.ev[0], s: st }, yCell, { v: t.ev[1], s: st }, inp(t.evBasis || 'Monthly'),
    ]);
  });
  const n = 200;
  return {
    name: 'Table', rows, widths: [26, 24, 16, 12, 8, 8, 10, 13, 13, 7, 14, 15, 13, 14, 22], freezeRows: 1,
    validations: [
      { range: `B2:B${n}`, formula: 'ChartNames' },
      { range: `D2:D${n}`, list: ['Sum', 'Average'] },
      { range: `H2:H${n}`, list: ['Higher', 'Lower'] },
      { range: `I2:I${n}`, list: ['%', 'Abs', 'Pts'] },
      { range: `J2:J${n}`, list: ['Y', 'N'] },
      { range: `O2:O${n}`, list: ['Monthly', 'Pro-rated quarterly', 'Pro-rated semi-annual', 'Pro-rated annual'] },
    ],
  };
}

// Hidden helper: the distinct Chart names from the Charts tab, for dropdowns.
// Classic (non-array) unique-list formula so it works in every Excel version.
const LIST_ROWS = 100;
function listsSheet() {
  const rows = [['Chart names']];
  for (let r = 2; r <= LIST_ROWS + 1; r++) {
    rows.push([{ f: `IFERROR(INDEX(Charts!$A$2:$A$500,MATCH(0,INDEX(COUNTIF($A$1:A${r - 1},Charts!$A$2:$A$500)+(Charts!$A$2:$A$500=""),0),0)),"")` }]);
  }
  return { name: 'Lists', rows, widths: [30], hidden: true };
}
const CHART_NAMES = { name: 'ChartNames', ref: `OFFSET(Lists!$A$2,0,0,MAX(1,COUNTIF(Lists!$A$2:$A$${LIST_ROWS + 1},"?*")),1)` };

function debtServiceSheet(d) {
  const rows = [[h('Line item'), h('Role'), ...d.quarters.map(h)]];
  for (const [name, role, vals] of d.lines) rows.push([inp(name), inp(role), ...vals.map((v) => ({ v, s: S.input2 }))]);
  for (let i = 0; i < 2; i++) rows.push([inp(''), inp(''), ...d.quarters.map(() => ({ v: '', s: S.input2 }))]);
  return {
    name: 'Debt Service', rows, widths: [26, 14, ...d.quarters.map(() => 11)], freezeRows: 1,
    validations: [{ range: 'B2:B100', list: ['Revenue', 'Expense', 'Debt service'] }],
  };
}

function reservesSheet(items) {
  const rows = [[h('Reserve'), h('Required'), h('Balance available')]];
  for (const [n, rq, av] of items) rows.push([inp(n), { v: rq, s: S.input2 }, { v: av, s: S.input2 }]);
  for (let i = 0; i < 2; i++) rows.push([inp(''), { v: '', s: S.input2 }, { v: '', s: S.input2 }]);
  return { name: 'Reserves', rows, widths: [28, 14, 18], freezeRows: 1 };
}

function dscrNotesSheet(items) {
  const rows = [[h('Heading'), h('Text')]];
  for (const [a, b] of items) rows.push([inp(a), inp(b)]);
  return { name: 'DSCR Notes', rows, widths: [30, 90], freezeRows: 1 };
}

function commentarySheet(items) {
  const rows = [[h('Heading'), h('Text')]];
  for (const [a, b] of items) rows.push([inp(a), inp(b)]);
  return { name: 'Commentary', rows, widths: [30, 90], freezeRows: 1 };
}

function sideTableSheet(grid) {
  const rows = grid.map((r, i) => r.map((c) => (i === 0 ? h(c) : inp(c))));
  if (!rows.length) rows.push([h('Item'), h('Value')]);
  return { name: 'Side Table', rows, widths: [26, 16, 16, 16, 16] };
}

function build(spec) {
  return workbook([
    instructionsSheet(),
    settingsSheet(spec.settings),
    chartsSheet(spec.series),
    footnotesSheet(spec.footnotes),
    tableSheet(spec),
    commentarySheet(spec.commentary),
    sideTableSheet(spec.sideTable),
    debtServiceSheet(spec.debt),
    reservesSheet(spec.reserves),
    dscrNotesSheet(spec.dscrNotes),
    listsSheet(),
  ], { names: [CHART_NAMES, ...calcNames(spec.settings)] });
}

const pad = (arr) => { const a = new Array(12).fill(null); arr.forEach((v, i) => { a[i] = v; }); return a; };

const COMMON = (o) => [
  ['Title', o.title],
  ['Subtitle', 'August 2026 Monthly Monitoring Dashboard'],
  ['Period label', 'MONTH ENDED AUGUST 31, 2026'],
  ['Header color', '#1F3B6E'],
  ['Current year', 2026],
  ['Prior year', 2025],
  ['Current month', 'Aug'],
  ['Chart section title', 'Monthly Performance - 2026 vs. 2025'],
  ['Data labels', 'Both years'],
  ['Chart columns', 'Auto'],
  ['Table title', o.tableTitle],
  ['Month heading', ''],
  ['YTD heading', ''],
  ['Actual label', 'Actual'],
  ['Comparison label', 'EV Case'],
  ['Variance label', 'Variance'],
  ['Negative numbers', 'Parentheses'],
  ['Side panel type', o.sideType],
  ['Side panel title', o.sideTitle],
  ['Side panel width %', o.sideWidth],
  ['Footer', o.footer],
  ['Page size', 'Letter'],
  ['Pro-rated note', ''],
  ['Include DSCR page', 'Auto'],
  ['DSCR page title', 'Debt Service Coverage - LTM Basis'],
  ['Quarters shown', 4],
  ['Distribution lock-up DSCR', o.lockup],
  ['Default DSCR', o.dflt],
  ['Reserves title', 'DSR and O&M Reserves'],
  ['Cash flow units', '$MM'],
  ['Cash flow decimals', 2],
];

// Fictional example: plain bars + commentary side panel.
const BLUEFIELD = {
  settings: COMMON({
    title: 'BLUEFIELD SOLAR HOLDINGS',
    tableTitle: 'Operating and Financial Performance vs. EV Case - Monthly & YTD',
    sideType: 'Commentary',
    sideTitle: 'Maintenance Commentary',
    sideWidth: 30,
    footer: 'Sources: Bluefield monthly operating reports; 2026 EV Case model.  Fictional example data.',
    lockup: 1.20,
    dflt: 1.10,
  }),
  series: [
    { chart: 'Generation (GWh)', year: 2026, decimals: 1, values: pad([24.6, 27.3, 38.9, 44.1, 49.8, 52.4, 41.7, 47.2]) },
    { chart: 'Generation (GWh)', year: 2025, decimals: 1, values: pad([22.9, 26.1, 36.4, 42.7, 47.5, 50.9, 49.6, 45.8, 39.2, 31.5, 25.4, 21.8]) },
    { chart: 'Revenue ($MM)', year: 2026, decimals: 1, values: pad([1.62, 1.84, 2.57, 3.03, 3.41, 4.12, 3.46, 3.92]) },
    { chart: 'Revenue ($MM)', year: 2025, decimals: 1, values: pad([1.5, 1.7, 2.4, 2.8, 3.2, 3.9, 4.0, 3.7, 2.9, 2.2, 1.7, 1.4]) },
    { chart: 'Operating income ($MM)', year: 2026, decimals: 1, values: pad([-0.41, 0.12, 0.88, 1.31, 1.69, 2.27, 1.66, 2.07]) },
    { chart: 'Operating income ($MM)', year: 2025, decimals: 1, values: pad([-0.6, -0.2, 0.7, 1.1, 1.5, 2.0, 2.2, 1.9, 1.2, 0.5, -0.1, -0.5]) },
  ],
  footnotes: [
    ['', 'Jul', 'Plant shut down July 13-17 for a utility transformer replacement at the point of interconnection.'],
    ['Operating income ($MM)', 'Jan', 'Annual property insurance premium expensed in January.'],
  ],
  table: [
    { metric: 'Generation', from: 'Generation (GWh)', suffix: ' GWh', dec: 1, ev: [50.6, 351.4] },
    { metric: 'Revenue', from: 'Revenue ($MM)', prefix: '$', suffix: 'MM', dec: 2, ev: [3.85, 25.30] },
    { metric: 'O&M expense', derive: ['Revenue', 'Operating income'], prefix: '$', suffix: 'MM', dec: 2, better: 'Lower', varAs: 'Abs', ev: [1.54, 13.68], evBasis: 'Pro-rated annual' },
    { metric: 'Operating income', from: 'Operating income ($MM)', prefix: '$', suffix: 'MM', dec: 2, bold: 'Y', ev: [2.31, 11.62] },
  ],
  commentary: [
    ['Interconnection', 'Utility replaced the POI transformer July 13-17; the plant was offline for the full outage.'],
    ['Tracker controls', 'Firmware update completed across all rows; stow logic retested and passed.'],
    ['Portfolio', 'Routine preventive maintenance continued; no safety or environmental events.'],
  ],
  sideTable: [['Item', 'Value']],
  debt: {
    quarters: ['Q4 2024', 'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'],
    lines: [
      ['Revenue', 'Revenue', [5.31, 5.62, 10.04, 10.52, 5.93, 6.08, 10.61]],
      ['O&M', 'Expense', [1.92, 2.01, 2.08, 2.17, 2.03, 2.11, 2.19]],
      ['Property taxes', 'Expense', [0.40, 0.40, 0.40, 0.40, 0.42, 0.45, 0.45]],
      ['Other taxes', 'Expense', [0.11, 0.09, 0.18, 0.21, 0.10, 0.08, 0.19]],
      ['Principal', 'Debt service', [2.40, 2.42, 2.48, 2.51, 2.57, 2.62, 2.68]],
      ['Interest', 'Debt service', [1.91, 1.86, 1.81, 1.76, 1.70, 1.65, 1.60]],
    ],
  },
  reserves: [
    ['Debt service reserve', 8.55, 8.62],
    ['O&M reserve', 2.10, 1.85],
  ],
  dscrNotes: [
    ['Seasonality', 'Q1 and Q4 coverage falls below 1.0x on a stand-alone basis every year; the covenants test on an LTM basis.'],
    ['Next test', 'Q3 2026 test at September 30, 2026.  Distributions require 1.20x LTM.'],
  ],
};

// Fictional example: stacked contracted/merchant bars + table and commentary side panel.
const RIDGELINE = {
  settings: COMMON({
    title: 'RIDGELINE POWER PARTNERS',
    tableTitle: 'Operating Metrics vs. EV Case - Monthly & YTD',
    sideType: 'Table + Commentary',
    sideTitle: 'Liquidity and Monitoring',
    sideWidth: 32,
    footer: 'Sources: Ridgeline monthly operating reports; 2026 EV Case model.  Fictional example data.',
    lockup: 1.25,
    dflt: 1.10,
  }),
  series: [
    { chart: 'Net generation (GWh)', component: 'Contracted', year: 2026, decimals: 0, values: pad([205, 188, 196, 112, 214, 231, 236, 228]) },
    { chart: 'Net generation (GWh)', component: 'Merchant', year: 2026, decimals: 0, values: pad([48, 35, 52, 21, 44, 73, 81, 57]) },
    { chart: 'Net generation (GWh)', component: 'Contracted', year: 2025, decimals: 0, values: pad([198, 182, 190, 168, 207, 224, 229, 221, 201, 186, 192, 203]) },
    { chart: 'Net generation (GWh)', component: 'Merchant', year: 2025, decimals: 0, values: pad([66, 51, 58, 72, 60, 88, 94, 79, 55, 47, 53, 62]) },
    { chart: 'Gross margin ($MM)', component: 'Contracted', year: 2026, decimals: 1, values: pad([5.02, 4.61, 4.83, 3.12, 5.18, 5.64, 5.71, 5.49]) },
    { chart: 'Gross margin ($MM)', component: 'Merchant', year: 2026, decimals: 1, values: pad([0.58, 0.41, 0.66, 0.22, 0.53, 1.38, 1.74, 0.82]) },
    { chart: 'Gross margin ($MM)', component: 'Contracted', year: 2025, decimals: 1, values: pad([4.8, 4.4, 4.6, 4.1, 5.0, 5.4, 5.5, 5.3, 4.9, 4.5, 4.7, 4.9]) },
    { chart: 'Gross margin ($MM)', component: 'Merchant', year: 2025, decimals: 1, values: pad([0.9, 0.6, 0.8, 1.1, 0.8, 1.8, 2.1, 1.2, 0.7, 0.5, 0.6, 0.8]) },
    { chart: 'EBITDA ($MM)', year: 2026, decimals: 1, values: pad([4.12, 3.58, 3.97, 2.21, 4.23, 5.41, 5.83, 4.79]) },
    { chart: 'EBITDA ($MM)', year: 2025, decimals: 1, values: pad([4.2, 3.6, 3.9, 3.7, 4.3, 5.7, 6.0, 5.0, 4.1, 3.5, 3.8, 4.2]) },
  ],
  footnotes: [
    ['', 'Apr', 'Unit 1 planned major outage April 6-24.'],
    ['Gross margin ($MM)', 'Jul', 'Merchant margin lifted by the July 14-22 heat wave price spike.'],
  ],
  table: [
    { metric: 'Capacity factor', suffix: '%', dec: 1, varAs: 'Pts', ytd: 'Average', m: [88.4], y: [84.9], ev: [93.0, 85.2] },
    { metric: 'Contracted generation', from: 'Net generation (GWh)', fromComp: 'Contracted', suffix: ' GWh', dec: 0, ev: [241, 1712] },
    { metric: 'Merchant generation', from: 'Net generation (GWh)', fromComp: 'Merchant', suffix: ' GWh', dec: 0, ev: [50, 398] },
    { metric: 'Net generation', from: 'Net generation (GWh)', suffix: ' GWh', dec: 0, bold: 'Y', ev: [291, 2110] },
    { metric: 'Contracted gross margin', from: 'Gross margin ($MM)', fromComp: 'Contracted', prefix: '$', suffix: 'MM', dec: 1, ev: [5.6, 41.3], evBasis: 'Pro-rated quarterly' },
    { metric: 'Merchant gross margin', from: 'Gross margin ($MM)', fromComp: 'Merchant', prefix: '$', suffix: 'MM', dec: 1, ev: [0.9, 6.2], evBasis: 'Pro-rated quarterly' },
    { metric: 'Total gross margin', from: 'Gross margin ($MM)', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', ev: [6.5, 47.5], evBasis: 'Pro-rated quarterly' },
    { metric: 'EBITDA', from: 'EBITDA ($MM)', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', ev: [5.1, 36.0], evBasis: 'Pro-rated annual' },
  ],
  commentary: [
    ['Status', 'No forced outages, safety incidents, or environmental events.'],
    ['Next event', 'Major inspection, Unit 2: Nov. 3-14, 2026.'],
  ],
  sideTable: [
    ['Item', 'Balance', 'MoM'],
    ['Unrestricted cash', '$3.4MM', '-$0.6MM'],
    ['O&M reserve', '$4.10MM', '+$0.05MM'],
    ['Debt service reserve', '$15.80MM', 'Flat'],
    ['Term loan', '$182.4MM', '-$1.8MM'],
    ['Revolver', '$0.0MM', 'Flat'],
  ],
  debt: {
    quarters: ['Q4 2024', 'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'],
    lines: [
      ['Revenue', 'Revenue', [28.41, 30.12, 27.23, 35.64, 29.02, 31.27, 24.81]],
      ['O&M', 'Expense', [9.18, 9.51, 9.09, 10.42, 9.33, 9.61, 11.84]],
      ['Property taxes', 'Expense', [1.20, 1.20, 1.20, 1.20, 1.25, 1.25, 1.25]],
      ['Other taxes', 'Expense', [0.52, 0.48, 0.61, 0.73, 0.50, 0.47, 0.41]],
      ['Principal', 'Debt service', [4.40, 4.50, 4.60, 4.60, 4.70, 4.80, 4.90]],
      ['Interest', 'Debt service', [3.31, 3.25, 3.20, 3.15, 3.10, 3.05, 3.00]],
    ],
  },
  reserves: [
    ['Debt service reserve', 15.80, 15.80],
    ['O&M reserve', 4.10, 4.10],
    ['Major maintenance reserve', 6.00, 5.20],
  ],
  dscrNotes: [
    ['Q2 2026', 'The April planned outage on Unit 1 reduced revenue and added O&M; LTM coverage stays well above lock-up.'],
  ],
};

const outDir = process.argv[2] || __dirname;
fs.writeFileSync(path.join(outDir, 'Bluefield-Example-Inputs.xlsx'), build(BLUEFIELD));
fs.writeFileSync(path.join(outDir, 'Ridgeline-Example-Inputs.xlsx'), build(RIDGELINE));
console.log('wrote examples to', outDir);
