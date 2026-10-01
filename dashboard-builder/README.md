# Dashboard Builder

A one-page monthly monitoring dashboard generated from an Excel workbook.  Live at https://krengbible.com/dashboard-builder/ (not linked from the Bible site, and marked noindex).

Nothing to install: open the page (or the downloaded `Dashboard-Builder.html`) in Edge or Chrome, drag in a filled-in workbook, and click "Save as PDF".  The workbook is read in the browser and never uploaded.

- `index.html`: the builder, usable directly on the site.
- `Dashboard-Builder.html`: identical copy, offered as a download for offline use.
- `Bluefield-Example-Inputs.xlsx`: plain bars, commentary side panel.  Fictional data.
- `Ridgeline-Example-Inputs.xlsx`: stacked contracted/merchant bars, table + commentary side panel.  Fictional data.

## Workbook features

- **Current month** (Settings) sets the reporting month: the table's month and YTD columns, the default headings, and the cutoff for current-year bars.
- **Footnotes** tab: a note for any month on one chart, or on every chart when Chart is blank.  The month label gets a superscript number and the notes print under the charts.
- **Table** Month Actual and YTD Actual are Excel formulas (with cached values) that sum the "From Chart" chart (optionally one "From Component") on the Charts tab for the Current year and Current month, YTD Method Sum or Average.  O&M expense defaults to Revenue - Operating income.  Typing a number over a formula overrides it; the builder always uses the cell's value and only recomputes from the Charts tab when the cell is empty or an error.  Month EV Case and YTD EV Case are typed.  An **EV Basis** column (Monthly / Pro-rated quarterly / semi-annual / annual) marks pro-rated EV Case values with a letter and adds the explanation under the table; Settings > Pro-rated note overrides the wording.
- **Debt Service** tab (optional) is a running quarterly history (fixed headers Q1 2024 to Q4 2027, filled in as quarters close; page 2 shows the last completed quarter before the Current month's quarter and the 3 before it, e.g. Aug -> through Q2, Dec -> through Q3) and calculates down to CFADS in the workbook itself (Calculated rows: Total O&M costs, CFADS, Total debt service costs, quarterly and LTM DSCR; each total sums only its own block of input rows, so nothing is circular) and adds page 2, "Debt Service Coverage": quarterly Revenue less expenses (O&M, property and other taxes, or any rows you add) gives CFADS; principal plus interest gives debt service.  Page 2 shows CFADS against stacked debt service, quarterly and LTM DSCR against the distribution lock-up and default covenant lines, and the full cash flow table with an LTM column.  **Reserves** lists each reserve account's required balance and balance available (with % funded) below the DSCR chart, and **DSCR Notes** adds notes beneath it.  The distribution lock-up and default DSCR covenant lines only appear when those settings are filled in.

## Rebuilding from source

Only needed when changing the builder itself.  From `dashboard-builder/src`:

```
node make_examples.js ..
node build.js .. ../index.html ../Dashboard-Builder.html
```

## Crowded pages

Page 1 keeps every chart at least 85px tall.  When the table, footnotes and commentary would squeeze them, the builder first compacts the page (two-column footnotes, tighter table and text), then moves the chart footnotes, the side panel and the comparison table, in that order, to a continuation page 2.  The DSCR page follows as page 3.  The builder says what moved.
