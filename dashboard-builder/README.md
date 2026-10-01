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
- **Table** rows can pull Month Actual and YTD Actual from the Charts tab via "From Chart" (and optionally "From Component"), with a YTD Method of Sum or Average.  Month EV Case and YTD EV Case are typed.

## Rebuilding from source

Only needed when changing the builder itself.  From `dashboard-builder/src`:

```
node make_examples.js ..
node build.js .. ../index.html ../Dashboard-Builder.html
```
