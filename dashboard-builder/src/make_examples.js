// Builds the two fictional example input workbooks (Bluefield and Ridgeline).
const fs = require('fs');
const path = require('path');
const { workbook, S } = require('./xlsxwriter.js');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const h = (v) => ({ v, s: S.header });
const note = (v) => ({ v, s: S.note });
const inp = (v) => ({ v, s: S.input });
const FROM_CHARTS = '(from Charts)';

const LISTS = {
  'Current month': MONTHS,
  'Data labels': ['Both years', 'This year', 'None'],
  'Chart columns': ['Auto', '1', '2', '3'],
  'Negative numbers': ['Parentheses', 'Minus sign'],
  'Side panel type': ['Commentary', 'Table', 'Table + Commentary', 'None'],
  'Page size': ['Letter', 'A4'],
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
    ['               Pick a chart in "From Chart" (dropdown) to fill Month Actual and YTD Actual from the Charts tab automatically'],
    ['               (add a "From Component" to use just one component, e.g. Contracted).  Leave "From Chart" blank to type the actuals yourself.'],
    ['               "YTD Method": Sum (default) adds the months up; Average averages them (use for percentages like capacity factor).'],
    ['               Month EV Case and YTD EV Case are always typed in.'],
    ['Commentary  -  Heading + Text pairs for the bottom-right box.'],
    ['Side Table  -  a free-form grid for the bottom-right box.  Row 1 = column headers.  Values print exactly as they appear in Excel.'],
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

function tableSheet(items) {
  const rows = [[
    h('Metric'), h('From Chart'), h('From Component'), h('YTD Method'),
    h('Prefix'), h('Suffix'), h('Decimals'), h('Better When'), h('Variance As'), h('Bold'),
    h('Month Actual'), h('Month EV Case'), h('YTD Actual'), h('YTD EV Case'),
  ]];
  for (const t of items) {
    const st = t.dec >= 2 ? S.input2 : S.input1;
    const actual = (v) => (t.from ? note(FROM_CHARTS) : { v, s: st });
    rows.push([
      inp(t.metric), inp(t.from || ''), inp(t.fromComp || ''), inp(t.ytd || 'Sum'),
      inp(t.prefix || ''), inp(t.suffix || ''), inp(t.dec), inp(t.better || 'Higher'),
      inp(t.varAs || ''), inp(t.bold || ''),
      actual(t.m && t.m[0]), { v: t.ev[0], s: st }, actual(t.y && t.y[0]), { v: t.ev[1], s: st },
    ]);
  }
  const n = 200;
  return {
    name: 'Table', rows, widths: [26, 24, 16, 12, 8, 8, 10, 13, 13, 7, 14, 15, 13, 14], freezeRows: 1,
    validations: [
      { range: `B2:B${n}`, formula: 'ChartNames' },
      { range: `D2:D${n}`, list: ['Sum', 'Average'] },
      { range: `H2:H${n}`, list: ['Higher', 'Lower'] },
      { range: `I2:I${n}`, list: ['%', 'Abs', 'Pts'] },
      { range: `J2:J${n}`, list: ['Y', 'N'] },
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
    tableSheet(spec.table),
    commentarySheet(spec.commentary),
    sideTableSheet(spec.sideTable),
    listsSheet(),
  ], { names: [CHART_NAMES] });
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
    { metric: 'O&M expense', prefix: '$', suffix: 'MM', dec: 2, better: 'Lower', varAs: 'Abs', m: [0.86], y: [6.12], ev: [0.74, 6.40] },
    { metric: 'Operating income', from: 'Operating income ($MM)', prefix: '$', suffix: 'MM', dec: 2, bold: 'Y', ev: [2.31, 11.62] },
  ],
  commentary: [
    ['Interconnection', 'Utility replaced the POI transformer July 13-17; the plant was offline for the full outage.'],
    ['Tracker controls', 'Firmware update completed across all rows; stow logic retested and passed.'],
    ['Portfolio', 'Routine preventive maintenance continued; no safety or environmental events.'],
  ],
  sideTable: [['Item', 'Value']],
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
    { metric: 'Contracted gross margin', from: 'Gross margin ($MM)', fromComp: 'Contracted', prefix: '$', suffix: 'MM', dec: 1, ev: [5.6, 41.3] },
    { metric: 'Merchant gross margin', from: 'Gross margin ($MM)', fromComp: 'Merchant', prefix: '$', suffix: 'MM', dec: 1, ev: [0.9, 6.2] },
    { metric: 'Total gross margin', from: 'Gross margin ($MM)', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', ev: [6.5, 47.5] },
    { metric: 'EBITDA', from: 'EBITDA ($MM)', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', ev: [5.1, 36.0] },
  ],
  commentary: [
    ['Status', 'No forced outages, safety incidents, or environmental events.'],
    ['Next event', 'Major inspection, Unit 2: Nov. 3-14, 2026.'],
  ],
  sideTable: [
    ['Item', 'Balance', 'MoM'],
    ['Unrestricted cash', '$3.4MM', '-$0.6MM'],
    ['O&M reserve', '$4.10MM', '+$0.05MM'],
    ['Debt service reserve', '$12.25MM', 'Flat'],
    ['Term loan', '$182.4MM', '-$1.8MM'],
    ['Revolver', '$0.0MM', 'Flat'],
  ],
};

const outDir = process.argv[2] || __dirname;
fs.writeFileSync(path.join(outDir, 'Bluefield-Example-Inputs.xlsx'), build(BLUEFIELD));
fs.writeFileSync(path.join(outDir, 'Ridgeline-Example-Inputs.xlsx'), build(RIDGELINE));
console.log('wrote examples to', outDir);
