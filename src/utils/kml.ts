export function validateKmlSource(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').trim();

  if (!text) {
    throw new Error('文件为空');
  }

  if (!/<(?:[A-Za-z_][\w.-]*:)?kml(?:\s|>)/i.test(text)) {
    throw new Error('文件不包含 <kml> 根节点，可能不是有效 KML 或内容已被清空');
  }

  return text;
}

export function getXmlParserError(xml: Document): string | null {
  const errorNode = xml.querySelector('parsererror');
  if (!errorNode) return null;

  const detail = errorNode.textContent?.replace(/\s+/g, ' ').trim();
  return detail ? detail.slice(0, 240) : 'XML 结构不完整或包含非法字符';
}
