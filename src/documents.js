import { tr } from './i18n';
import { unzipSync } from 'fflate';
import { digest, now, uid } from './data';

export const maxFileSize = 35 * 1024 * 1024;
const xmlNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const strictNS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

let pdfModules;
export async function readPdf(blob) {
  pdfModules ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
  const [pdfjs, worker] = await pdfModules;
  globalThis.pdfjsWorker = worker;
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableFontFace: false, isOffscreenCanvasSupported: false, useSystemFonts: true }).promise;
}

export async function drawPage(pdf, pageNumber, canvas, width) {
  const page = await pdf.getPage(pageNumber);
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, width / original.width, 3500 / original.height) });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

async function pdfParts(file) {
  let pdf;
  try { pdf = await readPdf(file); }
  catch (error) { throw new Error(tr(error.name === 'PasswordException' ? 'Unlock this PDF before importing it.' : 'This PDF could not be read. Check that it opens in a PDF viewer.')); }
  try {
    if (pdf.numPages > 500) throw new Error(tr("PDF exceeds the 500-page import limit."));
    const parts = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const source = await pdf.getPage(page);
      const content = await source.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : item.str && !/\s$/.test(item.str) ? ' ' : '');
      }
      const groups = text.trim().split(/\n\s*\n/);
      groups.forEach((group, idx) => parts.push({ id: `p${page}-${idx + 1}`, page, label: groups.length > 1 ? `Page ${page}, passage ${idx + 1}` : `Page ${page}`, text: group.trim() }));
      source.cleanup();
    }
    return parts;
  } finally {
    await pdf?.destroy();
  }
}

function docxParts(bytes) {
  let files;
  try { files = unzipSync(bytes, { filter: entry => entry.name === 'word/document.xml' && entry.originalSize <= 20 * 1024 * 1024 }); }
  catch { throw new Error(tr('This DOCX could not be read. Check that Word can open it.')); }
  if (!files['word/document.xml']) throw new Error(tr("The DOCX body is missing or too large."));
  let parsed;
  try { parsed = new DOMParser().parseFromString(new TextDecoder('utf-8', { fatal: true }).decode(files['word/document.xml']), 'application/xml'); }
  catch { throw new Error(tr('The DOCX body contains invalid XML.')); }
  if (parsed.querySelector('parsererror') || parsed.doctype) throw new Error(tr("The DOCX body contains invalid XML."));
  const paragraphs = [...parsed.getElementsByTagNameNS('*', 'p')].filter(node => [xmlNS, strictNS].includes(node.namespaceURI));
  return paragraphs.flatMap((node, index) => {
    const text = [...node.getElementsByTagNameNS(node.namespaceURI, '*')].map(child => ({ t: child.textContent, tab: '\t', br: '\n', cr: '\n' })[child.localName] || '').join('').trim();
    return text ? [{ id: `s${index + 1}`, label: `Paragraph ${index + 1}`, text }] : [];
  });
}

function decode(bytes) {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error(tr("Save this text file as UTF-8 or UTF-16 with a byte-order mark and retry.")); }
}

function textParts(bytes, csv) {
  const text = decode(bytes).replace(/\r\n?/g, '\n');
  if (text.includes('\0')) throw new Error(tr("Binary data was found in this text file."));
  const rows = [];
  if (csv) {
    let quoted = false;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '"') quoted = !quoted;
      if (text[index] === '\n' && !quoted) { rows.push(text.slice(start, index)); start = index + 1; }
    }
    if (quoted) throw new Error(tr("CSV contains an unclosed quoted field."));
    rows.push(text.slice(start));
  } else {
    rows.push(...text.split(/\n[ \t]*\n+/));
  }
  return rows.flatMap((part, index) => part.trim() ? [{ id: `s${index + 1}`, label: `${csv ? 'Row' : 'Paragraph'} ${index + 1}`, text: part.trim() }] : []);
}

export async function importEvidence(file, source) {
  const type = file.name.split('.').at(-1)?.toUpperCase();
  if (!['TXT', 'CSV', 'DOCX', 'PDF'].includes(type)) throw new Error(tr("Choose a PDF, DOCX, TXT, or CSV file."));
  if (!file.size || file.size > maxFileSize) throw new Error(tr("Files must contain data and be 35 MB or smaller."));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = { PDF: 'application/pdf', DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', TXT: 'text/plain', CSV: 'text/csv' }[type];
  const original = new Blob([bytes], { type: mime });
  let parts;
  if (type === 'PDF') parts = await pdfParts(original);
  else if (type === 'DOCX') parts = docxParts(bytes);
  else parts = textParts(bytes, type === 'CSV');
  if (parts.length > 100000 || parts.reduce((sum, part) => sum + part.text.length, 0) > 8_000_000) throw new Error(tr("This document exceeds the text indexing limit. Split it into smaller files to import it."));
  return { id: uid(), name: file.name, type, original, hash: digest(bytes), parts, source: source.trim() || 'Local file', notes: '', tags: [], verified: false, imported: now(), modified: file.lastModified ? new Date(file.lastModified).toISOString() : null, size: file.size, annotations: [] };
}

export async function ocrPage(doc, page, language) {
  const { recognize } = await import('./ocr');
  const pdf = await readPdf(doc.original);
  const canvas = document.createElement('canvas');
  try {
    await drawPage(pdf, page, canvas, 2000);
    return (await recognize(canvas, language)).trim();
  } finally {
    await pdf.destroy();
  }
}

export function download(name, data) {
  const url = URL.createObjectURL(data);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
