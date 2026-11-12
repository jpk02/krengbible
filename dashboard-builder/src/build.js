// Embeds the example workbooks into the builder page.
// Usage: node build.js <examples dir> <output.html> [<output2.html> ...]
const fs = require('fs');
const path = require('path');
const [exDir, ...outs] = process.argv.slice(2);
const ex = {
  a: { file: 'Bluefield Example Inputs.xlsx', data: fs.readFileSync(path.join(exDir, 'Bluefield-Example-Inputs.xlsx')).toString('base64') },
  b: { file: 'Ridgeline Example Inputs.xlsx', data: fs.readFileSync(path.join(exDir, 'Ridgeline-Example-Inputs.xlsx')).toString('base64') },
};
let html = fs.readFileSync(path.join(__dirname, 'builder.template.html'), 'utf8');
if (!html.includes('/*__EXAMPLES__*/{}')) throw new Error('placeholder missing');
html = html.replace('/*__EXAMPLES__*/{}', JSON.stringify(ex));
for (const o of outs) { fs.writeFileSync(o, html); console.log('built', o, html.length); }
