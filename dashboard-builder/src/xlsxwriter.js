// Minimal styled .xlsx writer (inline strings, a handful of fixed styles,
// column widths, frozen header, list-style data validation).
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Style ids (index into cellXfs below)
const S = {
  text: 0, header: 1, note: 2, num1: 3, num2: 4, wrap: 5, bold: 6, title: 7,
  input: 8, input1: 9, input2: 10, section: 11,
  calc0: 12, calc1: 13, calc2: 14,  // formula cells: black on white, bordered
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
<fonts count="6">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="16"/><color rgb="FF1F3B6E"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><sz val="11"/><color rgb="FF0000FF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3B6E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// sheet = { name, rows: [[cell...]], widths: [..], freezeRows, validations: [{range, list:[..]}] }
// cell = null | value | { v, s }
function sheetXml(sh) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  if (sh.freezeRows) {
    const tl = `A${sh.freezeRows + 1}`;
    out.push(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freezeRows}" topLeftCell="${tl}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${tl}" sqref="${tl}"/></sheetView></sheetViews>`);
  } else {
    out.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
  }
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sh.widths && sh.widths.length) {
    out.push('<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  }
  out.push('<sheetData>');
  sh.rows.forEach((row, ri) => {
    const cells = [];
    (row || []).forEach((cell, ci) => {
      if (cell === null || cell === undefined) return;
      const obj = typeof cell === 'object' ? cell : { v: cell };
      const ref = colName(ci) + (ri + 1);
      const sAttr = obj.s ? ` s="${obj.s}"` : '';
      if (obj.f) {
        // Cached result so the value is readable before Excel recalculates.
        if (typeof obj.v === 'number' && Number.isFinite(obj.v)) cells.push(`<c r="${ref}"${sAttr}><f>${esc(obj.f)}</f><v>${obj.v}</v></c>`);
        else cells.push(`<c r="${ref}"${sAttr} t="str"><f>${esc(obj.f)}</f><v>${esc(obj.v ?? '')}</v></c>`);
      } else if (obj.v === null || obj.v === undefined || obj.v === '') {
        if (obj.s) cells.push(`<c r="${ref}"${sAttr}/>`);
      } else if (typeof obj.v === 'number') {
        cells.push(`<c r="${ref}"${sAttr}><v>${obj.v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(obj.v)}</t></is></c>`);
      }
    });
    const ht = row && row.height ? ` ht="${row.height}" customHeight="1"` : '';
    out.push(`<row r="${ri + 1}"${ht}>${cells.join('')}</row>`);
  });
  out.push('</sheetData>');
  if (sh.validations && sh.validations.length) {
    out.push(`<dataValidations count="${sh.validations.length}">`);
    for (const dv of sh.validations) {
      const f1 = dv.formula ? esc(dv.formula) : `"${esc(dv.list.join(','))}"`;
      out.push(`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${dv.range}"><formula1>${f1}</formula1></dataValidation>`);
    }
    out.push('</dataValidations>');
  }
  out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  out.push('</worksheet>');
  return out.join('');
}

// opts.names: [{ name, ref }] workbook-level defined names.
function workbook(sheets, opts = {}) {
  const files = [];
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`]);
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>${(opts.names || []).length ? `<definedNames>${opts.names.map((n) => `<definedName name="${esc(n.name)}">${esc(n.ref)}</definedName>`).join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml', STYLES]);
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return zip(files);
}

module.exports = { workbook, S, colName, zip };
