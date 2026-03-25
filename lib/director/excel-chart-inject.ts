import JSZip from "jszip";

const COLORS = [
  "4F46E5", "10B981", "F59E0B", "EF4444",
  "8B5CF6", "06B6D4", "EC4899", "84CC16",
];

export interface ChartDef {
  type: "line" | "bar" | "col";
  title: string;
  catRange: string;
  series: { nameRef: string; valRef: string }[];
  fromRow: number;
  toRow: number;
  fromCol: number;
  toCol: number;
}

/** Convert 1-based column number to Excel letter (1→A, 27→AA) */
export function colLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    num--;
    s = String.fromCharCode(65 + (num % 26)) + s;
    num = Math.floor(num / 26);
  }
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildChartXml(chart: ChartDef, idx: number): string {
  const ax1 = idx * 2 + 100000001;
  const ax2 = idx * 2 + 100000002;

  const serXml = chart.series.map((s, i) => {
    const c = COLORS[i % COLORS.length];
    const fill = chart.type === "line"
      ? `<c:spPr><a:ln w="22000"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:ln></c:spPr>`
      : `<c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr>`;
    const marker = chart.type === "line"
      ? `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr></c:marker><c:smooth val="0"/>`
      : "";
    return `<c:ser>
  <c:idx val="${i}"/><c:order val="${i}"/>
  <c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f></c:strRef></c:tx>
  ${fill}${marker}
  <c:cat><c:strRef><c:f>${esc(chart.catRange)}</c:f></c:strRef></c:cat>
  <c:val><c:numRef><c:f>${esc(s.valRef)}</c:f></c:numRef></c:val>
</c:ser>`;
  }).join("\n");

  let plot: string;
  if (chart.type === "line") {
    plot = `<c:lineChart><c:grouping val="standard"/>${serXml}<c:marker val="1"/>
<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:lineChart>`;
  } else {
    const dir = chart.type === "bar" ? "bar" : "col";
    plot = `<c:barChart><c:barDir val="${dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>
${serXml}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:barChart>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
  <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>
    <a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p>
  </c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea>
    <c:layout/>
    ${plot}
    <c:catAx>
      <c:axId val="${ax1}"/>
      <c:scaling><c:orientation val="minMax"/></c:scaling>
      <c:delete val="0"/><c:axPos val="b"/>
      <c:crossAx val="${ax2}"/><c:crosses val="autoZero"/>
      <c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>
    </c:catAx>
    <c:valAx>
      <c:axId val="${ax2}"/>
      <c:scaling><c:orientation val="minMax"/></c:scaling>
      <c:delete val="0"/><c:axPos val="l"/>
      <c:numFmt formatCode="General" sourceLinked="1"/>
      <c:crossAx val="${ax1}"/><c:crosses val="autoZero"/>
    </c:valAx>
  </c:plotArea>
  <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
  <c:plotVisOnly val="1"/>
  <c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

function buildDrawingXml(charts: ChartDef[]): string {
  const anchors = charts.map((ch, i) => `
<xdr:twoCellAnchor>
  <xdr:from><xdr:col>${ch.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:to><xdr:col>${ch.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
  <xdr:graphicFrame macro="">
    <xdr:nvGraphicFramePr>
      <xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>
      <xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr>
    </xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/>
      </a:graphicData>
    </a:graphic>
  </xdr:graphicFrame>
  <xdr:clientData/>
</xdr:twoCellAnchor>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`;
}

function buildDrawingRels(charts: ChartDef[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("\n")}
</Relationships>`;
}

/**
 * Post-process an ExcelJS-generated .xlsx buffer to inject native Excel charts.
 * @param xlsxBuffer  The buffer from ExcelJS `wb.xlsx.writeBuffer()`
 * @param charts      Chart definitions referencing data in the workbook
 * @param reportSheet 1-based sheet index where charts should appear
 */
export async function injectCharts(
  xlsxBuffer: Buffer | ArrayBuffer,
  charts: ChartDef[],
  reportSheet: number,
): Promise<Buffer> {
  if (charts.length === 0) return Buffer.from(xlsxBuffer as ArrayBufferLike);

  const zip = await JSZip.loadAsync(xlsxBuffer);

  // 1. Chart XML files
  charts.forEach((ch, i) => {
    zip.file(`xl/charts/chart${i + 1}.xml`, buildChartXml(ch, i));
  });

  // 2. Drawing + its relationships
  zip.file("xl/drawings/drawing1.xml", buildDrawingXml(charts));
  zip.file("xl/drawings/_rels/drawing1.xml.rels", buildDrawingRels(charts));

  // 3. Link the report worksheet to the drawing
  const relPath = `xl/worksheets/_rels/sheet${reportSheet}.xml.rels`;
  const existing = zip.file(relPath);
  if (existing) {
    let content = await existing.async("string");
    content = content.replace(
      "</Relationships>",
      `<Relationship Id="rIdDraw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>\n</Relationships>`,
    );
    zip.file(relPath, content);
  } else {
    zip.file(relPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdDraw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`);
  }

  // 4. Insert <drawing> element into the worksheet XML
  const sheetPath = `xl/worksheets/sheet${reportSheet}.xml`;
  const sheetFile = zip.file(sheetPath);
  if (sheetFile) {
    let xml = await sheetFile.async("string");
    // Ensure r: namespace is present
    if (!xml.includes("xmlns:r=")) {
      xml = xml.replace(
        "<worksheet ",
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      );
    }
    xml = xml.replace("</worksheet>", '<drawing r:id="rIdDraw1"/>\n</worksheet>');
    zip.file(sheetPath, xml);
  }

  // 5. Register content types
  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ct = await ctFile.async("string");
    const parts = [
      `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      ...charts.map((_, i) =>
        `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      ),
    ];
    ct = ct.replace("</Types>", parts.join("\n") + "\n</Types>");
    zip.file("[Content_Types].xml", ct);
  }

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
