// Builds .docx fixtures that exercise the structures real contracts contain:
// split formatting runs, fields, hyperlinks, bookmarks, comments, tables,
// numbering, content controls, existing tracked changes, images and headers.

import { zipSync } from 'fflate';

const NS =
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'mc:Ignorable="w14"';

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// 1×1 transparent PNG.
const PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

export interface FixtureOptions {
  body: string;
  header?: string;
  comments?: string;
  image?: boolean;
  /** Prefix document.xml with a UTF-8 byte-order mark. */
  bom?: boolean;
  /** Raw document.xml, bypassing the standard wrapper (body is ignored). */
  rawDocumentXml?: string;
}

export function buildDocx(opts: FixtureOptions): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const documentXml =
    opts.rawDocumentXml ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${NS}><w:body>${opts.body}` +
      `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:pgSz w:w="12240" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
      `</w:sectPr></w:body></w:document>`;

  const docRels = [
    `<Relationship Id="rIdStyles" Type="${REL_BASE}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdSettings" Type="${REL_BASE}/settings" Target="settings.xml"/>`,
    `<Relationship Id="rIdNumbering" Type="${REL_BASE}/numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rIdHeader1" Type="${REL_BASE}/header" Target="header1.xml"/>`,
    `<Relationship Id="rIdLink1" Type="${REL_BASE}/hyperlink" Target="https://example.com/security-policy" TargetMode="External"/>`,
  ];
  if (opts.comments) docRels.push(`<Relationship Id="rIdComments" Type="${REL_BASE}/comments" Target="comments.xml"/>`);
  if (opts.image) docRels.push(`<Relationship Id="rIdImage1" Type="${REL_BASE}/image" Target="media/image1.png"/>`);

  const overrides = [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    ['/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'],
    ['/word/header1.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ];
  if (opts.comments) {
    overrides.push(['/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml']);
  }

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/>` +
        overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
        `</Types>`,
    ),
    '_rels/.rels': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="${REL_BASE}/extended-properties" Target="docProps/app.xml"/>` +
        `</Relationships>`,
    ),
    'word/document.xml': opts.bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...enc(documentXml)]) : enc(documentXml),
    'word/_rels/document.xml.rels': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        docRels.join('') +
        `</Relationships>`,
    ),
    'word/styles.xml': enc(STYLES_XML),
    'word/settings.xml': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
    ),
    'word/numbering.xml': enc(NUMBERING_XML),
    'word/header1.xml': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NS}>` +
        (opts.header ??
          `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">Confidential — Page </w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`) +
        `</w:hdr>`,
    ),
    'docProps/core.xml': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
        `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>Master Services Agreement</dc:title><dc:creator>Counterparty Counsel</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-01T09:00:00Z</dcterms:created></cp:coreProperties>`,
    ),
    'docProps/app.xml': enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>`,
    ),
  };
  if (opts.comments) files['word/comments.xml'] = enc(opts.comments);
  if (opts.image) files['word/media/image1.png'] = PIXEL_PNG;

  return zipSync(files, { mtime: new Date('2026-09-01T09:00:00Z') });
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>` +
  `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
  `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
  `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
  `</w:tblBorders></w:tblPr></w:style></w:styles>`;

const NUMBERING_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>` +
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>` +
  `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="792" w:hanging="432"/></w:pPr></w:lvl>` +
  `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

// --- Paragraph helpers --------------------------------------------------------

const t = (text: string) => `<w:t xml:space="preserve">${text}</w:t>`;
const run = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t(text)}</w:r>`;
const heading = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
const clause = (...runs: string[]) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>${runs.join('')}</w:p>`;

export const SAMPLE_COMMENTS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:comment w:id="40" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z" w:initials="CC">` +
  `<w:p><w:r><w:t>This is standard for our vendors.</w:t></w:r></w:p></w:comment></w:comments>`;

/** A services agreement with the awkward structures real contracts contain. */
export function sampleMsaBody(): string {
  return [
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run('MASTER SERVICES AGREEMENT')}</w:p>`,
    `<w:p w14:paraId="1A2B3C4D" w14:textId="77777777" w:rsidR="00A1" w:rsidRDefault="00A1">` +
      `<w:r w:rsidR="00A1"><w:t xml:space="preserve">This Master Services Agreement (the “</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Agreement</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve">”) is entered into by Customer ABC, Inc. (“</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Customer</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve">”) and Provider LLC (“</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Provider</w:t></w:r>` +
      `<w:r><w:t>”).</w:t></w:r></w:p>`,
    heading('Services'),
    clause(
      run('Provider shall perform the services described in each Statement of Work (“'),
      run('SOW', '<w:b/>'),
      run('”), including any services reasonably implied thereby.'),
    ),
    clause(
      run('Customer may request changes to any SOW at any time, and Provider shall implement such changes', ''),
      `<w:r><w:tab/></w:r>`,
      run('without additional charge.'),
    ),
    heading('Fees and Payment'),
    clause(
      run('Customer shall pay undisputed invoices within '),
      `<w:del w:id="31" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"><w:r><w:delText>thirty (30)</w:delText></w:r></w:del>`,
      `<w:ins w:id="32" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"><w:r><w:t>ninety (90)</w:t></w:r></w:ins>`,
      run(' days of receipt, and payment shall be contingent on Customer’s receipt of payment from its end client.'),
    ),
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p>${run('Fee Item', '<w:b/>')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p>${run('Amount', '<w:b/>')}</w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p>${run('Monthly retainer')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p>${run('$25,000')}</w:p></w:tc></w:tr></w:tbl>`,
    heading('Restrictive Covenants'),
    clause(
      `<w:bookmarkStart w:id="10" w:name="_Ref_NonCompete"/>`,
      `<w:commentRangeStart w:id="40"/>`,
      run('During the Term and for two (2) years thereafter, Provider '),
      run('shall not', '<w:b/><w:u w:val="single"/>'),
      run(' pro'),
      `<w:proofErr w:type="spellStart"/>`,
      run('vide services', '<w:i/>'),
      `<w:proofErr w:type="spellEnd"/>`,
      run(' to any competitor of Customer.'),
      `<w:commentRangeEnd w:id="40"/>`,
      `<w:r><w:commentReference w:id="40"/></w:r>`,
      `<w:bookmarkEnd w:id="10"/>`,
    ),
    clause(
      run('The restrictions in Section '),
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>`,
      `<w:r><w:instrText xml:space="preserve"> REF _Ref_NonCompete \\r \\h </w:instrText></w:r>`,
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
      `<w:r><w:t>3.1</w:t></w:r>`,
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      run(' survive termination of this Agreement.'),
    ),
    heading('Intellectual Property'),
    clause(
      run('All work product, including Provider’s pre-existing tools and methodologies, shall be the exclusive property of Customer.'),
    ),
    heading('Security'),
    clause(
      run('Provider shall comply with Customer’s '),
      `<w:hyperlink r:id="rIdLink1" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>Security Policy</w:t></w:r></w:hyperlink>`,
      run(', as amended from time to time.'),
    ),
    `<w:sdt><w:sdtPr><w:alias w:val="Notice Address"/><w:tag w:val="notice"/></w:sdtPr><w:sdtContent>` +
      `<w:p>${run('Notices shall be sent to: 100 Main Street, Springfield.')}</w:p></w:sdtContent></w:sdt>`,
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="95250" cy="95250"/>` +
      `<wp:docPr id="1" name="Seal"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="95250" cy="95250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>${run(' Signed and sealed.')}</w:p>`,
    `<w:p>${run('IN WITNESS WHEREOF, the parties have executed this Agreement.')}<w:r><w:br/></w:r>${run('Customer ABC, Inc.  |  Provider LLC')}</w:p>`,
    `<w:p/>`,
  ].join('');
}

export function sampleMsa(): Uint8Array {
  return buildDocx({ body: sampleMsaBody(), comments: SAMPLE_COMMENTS, image: true });
}

/** Unusual-but-legal serialization: BOM, CRLF, single quotes, entities, comments, CDATA. */
export function quirkyDocx(): Uint8Array {
  const xml =
    `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\r\n` +
    `<!-- generated by a legacy system -->\r\n` +
    `<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>\r\n` +
    `  <w:body>\r\n` +
    `    <w:p>\r\n      <w:r>\r\n        <w:t xml:space='preserve'>Fees &amp; expenses &lt;capped&gt; at &#x201C;$10,000&#8221;.</w:t>\r\n      </w:r>\r\n    </w:p>\r\n` +
    `    <w:p><w:pPr/><w:r><w:t><![CDATA[Literal <markup> & text]]></w:t></w:r></w:p>\r\n` +
    `    <w:p><w:r><w:t>Second</w:t></w:r><w:r><w:t xml:space="preserve"> line.</w:t></w:r></w:p>\r\n` +
    `    <w:sectPr/>\r\n  </w:body>\r\n</w:document>\r\n`;
  return buildDocx({ body: '', rawDocumentXml: xml, bom: true });
}

/** The hardest structures we know of, in one document. */
export function kitchenSinkBody(): string {
  const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const cc = 'w:id="900" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"';
  return [
    // Astral-plane characters before and after editable text.
    `<w:p>${r('Fees 💰 are due 🗓️ within 𝟑𝟎 days.')}</w:p>`,
    // Nested table.
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>` +
      `<w:p>${r('Outer cell')}</w:p>` +
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p>${r('Inner cell text')}</w:p></w:tc></w:tr></w:tbl>` +
      `<w:p/></w:tc></w:tr></w:tbl>`,
    // Text box inside alternate content inside a run.
    `<w:p>${r('Before box ')}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><w:txbxContent><w:p><w:r><w:t>Boxed text</w:t></w:r></w:p></w:txbxContent></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Boxed text</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>${r(' after box.')}</w:p>`,
    // Tracked move.
    `<w:p><w:moveFromRangeStart w:id="901" w:name="move1"/><w:moveFrom ${cc.replace('900', '902')}><w:r><w:t>Moved sentence.</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="901"/>${r(' Stays here.')}</w:p>`,
    `<w:p>${r('Destination: ')}<w:moveToRangeStart w:id="903" w:name="move1"/><w:moveTo ${cc.replace('900', '904')}><w:r><w:t>Moved sentence.</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="903"/></w:p>`,
    // Field inside a hyperlink, simple field, footnote reference, symbol.
    `<w:p>${r('See ')}<w:hyperlink w:anchor="_Ref1"><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF _Ref1 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Section 9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>${r(' and ')}<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>${r(' of the terms')}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>${r(' apply ')}<w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r>${r('.')}</w:p>`,
    // Math, bidi wrapper, run-level content control, smart tag, empty runs.
    `<w:p>${r('Formula ')}<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x+1</m:t></m:r></m:oMath>${r(' then ')}<w:dir w:val="rtl">${r('שלום')}</w:dir>${r(' and ')}<w:sdt><w:sdtPr><w:alias w:val="Party"/></w:sdtPr><w:sdtContent>${r('Acme Corp')}</w:sdtContent></w:sdt>${r(' via ')}<w:smartTag w:uri="urn:x" w:element="place">${r('Springfield')}</w:smartTag><w:r/><w:r><w:t/></w:r>${r('.')}</w:p>`,
    // Paragraph whose mark the counterparty inserted, then one whose mark they deleted.
    `<w:p><w:pPr><w:rPr><w:ins ${cc.replace('900', '905')}/></w:rPr></w:pPr><w:ins ${cc.replace('900', '906')}>${r('Their new paragraph.')}</w:ins></w:p>`,
    `<w:p><w:pPr><w:rPr><w:del ${cc.replace('900', '907')}/></w:rPr></w:pPr>${r('Joined with the next ')}</w:p>`,
    `<w:p>${r('paragraph after their deletion.')}</w:p>`,
    // Bookmark spanning paragraphs, special characters, last-rendered page break.
    `<w:p><w:bookmarkStart w:id="908" w:name="_Ref1"/>${r('Span starts')}</w:p>`,
    `<w:p>${r('A&amp;B &lt;tags&gt; non')}<w:r><w:noBreakHyphen/><w:t>breaking, soft</w:t><w:softHyphen/><w:t>hyphen</w:t><w:cr/><w:t>after CR</w:t><w:lastRenderedPageBreak/></w:r><w:bookmarkEnd w:id="908"/></w:p>`,
    `<w:p>${r('Ends here.')}</w:p>`,
  ].join('');
}

export function kitchenSink(): Uint8Array {
  return buildDocx({ body: kitchenSinkBody() });
}
