// Builds the two fictional example input workbooks (Bluefield and Ridgeline).
const fs = require('fs');
const path = require('path');
const { workbook, S } = require('./xlsxwriter.js');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const h = (v) => ({ v, s: S.header });
const note = (v) => ({ v, s: S.note });
const inp = (v) => ({ v, s: S.input });

const LISTS = {
  'Data labels': ['This year', 'Both years', 'None'],
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
    ['1.  Fill in the Settings, Charts, Table, Commentary and Side Table tabs.  Blue text on yellow = inputs.'],
    ['2.  Save this workbook.'],
    ['3.  Open "Dashboard Builder.html" in Edge or Chrome and drag this workbook onto the page.'],
    ['4.  Click "Save as PDF" (or press Ctrl+P), choose "Save as PDF", and save.'],
    [],
    [{ v: 'Tabs', s: S.bold }],
    ['Settings  -  titles, labels, footer, and layout options.  The Notes column explains each one.'],
    ['Charts  -  one row per chart / component / year with Jan-Dec values.  Leave months blank where there is no data yet.'],
    ['               Each distinct "Chart" name becomes its own chart.  Rows with a "Component" (e.g. Contracted, Merchant) are stacked.'],
    ['               Every chart shows the Current year and Prior year from Settings side by side, month by month.'],
    ['Table  -  any number of rows.  The variance is calculated for you; "Better When" sets whether it shows green or red.'],
    ['Commentary  -  Heading + Text pairs for the bottom-right box.'],
    ['Side Table  -  a free-form grid for the bottom-right box.  Row 1 = column headers.  Values print exactly as they appear in Excel.'],
    [],
    [{ v: 'Tips', s: S.bold }],
    ['-  Do not rename the tabs or the column headers in row 1.  You can add, delete or reorder rows freely.'],
    ['-  Copy this workbook for each asset (one workbook = one dashboard).'],
    ['-  Your data never leaves your computer: the builder page reads the file locally in the browser.'],
  ];
  return { name: 'Instructions', rows: lines, widths: [130] };
}

function settingsSheet(settings) {
  const notes = {
    'Title': 'Large text in the top banner.',
    'Subtitle': 'Smaller line under the title.',
    'Period label': 'Shown at the top right of the banner.',
    'Header color': 'Hex color for the banner and section headers, e.g. #1F3B6E.',
    'Current year': 'Year whose values are the solid bars.',
    'Prior year': 'Year whose values are the lighter bars next to them.',
    'Chart section title': 'Header above the charts.',
    'Data labels': 'Which bars get value labels: This year / Both years / None.',
    'Chart columns': 'Auto = 1 column for up to 3 charts, 2 columns for more.',
    'Table title': 'Header above the comparison table.',
    'Month heading': 'Heading over the monthly columns, e.g. August.',
    'YTD heading': 'Heading over the year-to-date columns.',
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
  return { name: 'Settings', rows, widths: [24, 70, 70], freezeRows: 1, validations };
}

function chartsSheet(series) {
  const rows = [[h('Chart'), h('Component'), h('Year'), h('Decimals'), ...MONTHS.map(h)]];
  for (const s of series) {
    const style = s.decimals >= 2 ? S.input2 : S.input1;
    rows.push([
      inp(s.chart), inp(s.component || ''), inp(s.year), inp(s.decimals),
      ...MONTHS.map((_, i) => (s.values[i] === undefined || s.values[i] === null ? { v: '', s: style } : { v: s.values[i], s: style })),
    ]);
  }
  return {
    name: 'Charts', rows, widths: [26, 16, 8, 10, ...MONTHS.map(() => 8)], freezeRows: 1,
  };
}

function tableSheet(items) {
  const rows = [[
    h('Metric'), h('Prefix'), h('Suffix'), h('Decimals'), h('Better When'), h('Variance As'), h('Bold'),
    h('Month Actual'), h('Month Comparison'), h('YTD Actual'), h('YTD Comparison'),
  ]];
  for (const t of items) {
    const st = t.dec >= 2 ? S.input2 : S.input1;
    rows.push([
      inp(t.metric), inp(t.prefix || ''), inp(t.suffix || ''), inp(t.dec), inp(t.better || 'Higher'),
      inp(t.varAs || ''), inp(t.bold || ''),
      { v: t.m[0], s: st }, { v: t.m[1], s: st }, { v: t.y[0], s: st }, { v: t.y[1], s: st },
    ]);
  }
  const n = 200;
  return {
    name: 'Table', rows, widths: [26, 8, 8, 10, 13, 13, 7, 14, 18, 12, 16], freezeRows: 1,
    validations: [
      { range: `E2:E${n}`, list: ['Higher', 'Lower'] },
      { range: `F2:F${n}`, list: ['%', 'Abs', 'Pts'] },
      { range: `G2:G${n}`, list: ['Y', 'N'] },
    ],
  };
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
    tableSheet(spec.table),
    commentarySheet(spec.commentary),
    sideTableSheet(spec.sideTable),
  ]);
}

const pad = (arr) => { const a = new Array(12).fill(null); arr.forEach((v, i) => { a[i] = v; }); return a; };
const at = (map) => { const a = new Array(12).fill(null); for (const [m, v] of Object.entries(map)) a[MONTHS.indexOf(m)] = v; return a; };

const COMMON = (o) => [
  ['Title', o.title],
  ['Subtitle', 'August 2026 Monthly Monitoring Dashboard'],
  ['Period label', 'MONTH ENDED AUGUST 31, 2026'],
  ['Header color', '#1F3B6E'],
  ['Current year', 2026],
  ['Prior year', 2025],
  ['Chart section title', 'Monthly Performance - 2026 vs. 2025'],
  ['Data labels', 'This year'],
  ['Chart columns', 'Auto'],
  ['Table title', o.tableTitle],
  ['Month heading', 'August'],
  ['YTD heading', 'YTD Through August'],
  ['Actual label', 'Actual'],
  ['Comparison label', 'Budget'],
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
    tableTitle: 'Operating and Financial Performance vs. Budget - Monthly & YTD',
    sideType: 'Commentary',
    sideTitle: 'Maintenance Commentary',
    sideWidth: 30,
    footer: 'Sources: Bluefield monthly operating reports; 2026 budget model.  Fictional example data.',
  }),
  series: [
    { chart: 'Generation (GWh)', year: 2026, decimals: 1, values: pad([24.6, 27.3, 38.9, 44.1, 49.8, 52.4, 51.7, 47.2]) },
    { chart: 'Generation (GWh)', year: 2025, decimals: 1, values: pad([22.9, 26.1, 36.4, 42.7, 47.5, 50.9, 49.6, 45.8, 39.2, 31.5, 25.4, 21.8]) },
    { chart: 'Revenue ($MM)', year: 2026, decimals: 1, values: pad([1.6, 1.8, 2.6, 3.0, 3.4, 4.1, 4.3, 3.9]) },
    { chart: 'Revenue ($MM)', year: 2025, decimals: 1, values: pad([1.5, 1.7, 2.4, 2.8, 3.2, 3.9, 4.0, 3.7, 2.9, 2.2, 1.7, 1.4]) },
    { chart: 'Operating income ($MM)', year: 2026, decimals: 1, values: pad([-0.4, 0.1, 0.9, 1.3, 1.7, 2.3, 2.5, 2.1]) },
    { chart: 'Operating income ($MM)', year: 2025, decimals: 1, values: pad([-0.6, -0.2, 0.7, 1.1, 1.5, 2.0, 2.2, 1.9, 1.2, 0.5, -0.1, -0.5]) },
  ],
  table: [
    { metric: 'Generation', suffix: ' GWh', dec: 1, m: [47.2, 50.6], y: [336.0, 351.4] },
    { metric: 'Revenue', prefix: '$', suffix: 'MM', dec: 2, m: [3.92, 3.85], y: [24.71, 25.30] },
    { metric: 'O&M expense', prefix: '$', suffix: 'MM', dec: 2, better: 'Lower', varAs: 'Abs', m: [0.86, 0.74], y: [6.12, 6.40] },
    { metric: 'Operating income', prefix: '$', suffix: 'MM', dec: 2, bold: 'Y', m: [2.07, 2.31], y: [10.48, 11.62] },
  ],
  commentary: [
    ['Inverter block 3', 'Two central inverters offline August 4-9 for warranty replacement of power modules.'],
    ['Tracker controls', 'Firmware update completed across all rows; stow logic retested and passed.'],
    ['Portfolio', 'Routine preventive maintenance continued; no safety or environmental events.'],
  ],
  sideTable: [['Item', 'Value']],
};

// Fictional example: stacked contracted/merchant bars + table and commentary side panel.
const RIDGELINE = {
  settings: COMMON({
    title: 'RIDGELINE POWER PARTNERS',
    tableTitle: 'Operating Metrics vs. Budget - Monthly & YTD',
    sideType: 'Table + Commentary',
    sideTitle: 'Liquidity and Monitoring',
    sideWidth: 32,
    footer: 'Sources: Ridgeline monthly operating reports; 2026 budget model.  Fictional example data.',
  }),
  series: [
    { chart: 'Net generation (GWh)', component: 'Contracted', year: 2026, decimals: 0, values: pad([205, 188, 196, 172, 214, 231, 236, 228]) },
    { chart: 'Net generation (GWh)', component: 'Merchant', year: 2026, decimals: 0, values: pad([48, 35, 52, 61, 44, 73, 81, 57]) },
    { chart: 'Net generation (GWh)', component: 'Contracted', year: 2025, decimals: 0, values: pad([198, 182, 190, 168, 207, 224, 229, 221, 201, 186, 192, 203]) },
    { chart: 'Net generation (GWh)', component: 'Merchant', year: 2025, decimals: 0, values: pad([66, 51, 58, 72, 60, 88, 94, 79, 55, 47, 53, 62]) },
    { chart: 'Gross margin ($MM)', component: 'Contracted', year: 2026, decimals: 1, values: pad([5.0, 4.6, 4.8, 4.3, 5.2, 5.6, 5.7, 5.5]) },
    { chart: 'Gross margin ($MM)', component: 'Merchant', year: 2026, decimals: 1, values: pad([0.6, 0.4, 0.7, 0.9, 0.5, 1.4, 1.7, 0.8]) },
    { chart: 'Gross margin ($MM)', component: 'Contracted', year: 2025, decimals: 1, values: pad([4.8, 4.4, 4.6, 4.1, 5.0, 5.4, 5.5, 5.3, 4.9, 4.5, 4.7, 4.9]) },
    { chart: 'Gross margin ($MM)', component: 'Merchant', year: 2025, decimals: 1, values: pad([0.9, 0.6, 0.8, 1.1, 0.8, 1.8, 2.1, 1.2, 0.7, 0.5, 0.6, 0.8]) },
    { chart: 'EBITDA ($MM)', year: 2026, decimals: 1, values: pad([4.1, 3.6, 4.0, 3.7, 4.2, 5.4, 5.8, 4.8]) },
    { chart: 'EBITDA ($MM)', year: 2025, decimals: 1, values: pad([4.2, 3.6, 3.9, 3.7, 4.3, 5.7, 6.0, 5.0, 4.1, 3.5, 3.8, 4.2]) },
  ],
  table: [
    { metric: 'Capacity factor', suffix: '%', dec: 1, varAs: 'Pts', m: [88.4, 93.0], y: [86.7, 85.2] },
    { metric: 'Contracted generation', suffix: ' GWh', dec: 0, m: [228, 241], y: [1670, 1712] },
    { metric: 'Merchant generation', suffix: ' GWh', dec: 0, m: [57, 50], y: [451, 398] },
    { metric: 'Net generation', suffix: ' GWh', dec: 0, bold: 'Y', m: [285, 291], y: [2121, 2110] },
    { metric: 'Contracted gross margin', prefix: '$', suffix: 'MM', dec: 1, m: [5.5, 5.6], y: [40.7, 41.3] },
    { metric: 'Merchant gross margin', prefix: '$', suffix: 'MM', dec: 1, m: [0.8, 0.9], y: [7.0, 6.2] },
    { metric: 'Total gross margin', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', m: [6.3, 6.5], y: [47.7, 47.5] },
    { metric: 'EBITDA', prefix: '$', suffix: 'MM', dec: 1, bold: 'Y', m: [4.8, 5.1], y: [35.6, 36.0] },
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
