/**
 * freezePanes.ts
 * -----------------------------------------------------------------------------
 * Injects frozen panes into a generated .xlsx.
 *
 * WHY THIS EXISTS
 * ---------------
 * xlsx-js-style writes styles, column widths and autofilters, but has NO
 * support for freezing panes — verified by grepping its bundle for `pane` and
 * `sheetViews` and finding nothing. Setting `worksheet['!freeze']` therefore
 * looks like it works and silently does nothing, which is worse than not
 * offering it.
 *
 * An .xlsx is a zip of XML. This unpacks it, adds the `<pane>` element to each
 * worksheet, and repacks — cheaper than a heavier workbook library that would
 * need Node stream polyfills to run under React Native.
 *
 * The library already emits an EMPTY `<sheetViews><sheetView workbookViewId="0"/>
 * </sheetViews>`, so the job is to place `<pane>` inside that existing
 * sheetView rather than to add a second sheetViews block — two of them is
 * schema-invalid and Excel refuses to open the file. The sheetView is written
 * self-closing, so it has to be reopened first.
 * -----------------------------------------------------------------------------
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface FreezeSpec {
  /** Columns to freeze from the left. 0 = none. */
  columns: number;
  /** Rows to freeze from the top. 0 = none. */
  rows: number;
}

/** 0 -> 'A', 2 -> 'C'. Enough for the 36 columns this report reaches. */
function columnName(index: number): string {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function paneXml(spec: FreezeSpec): string {
  const { columns, rows } = spec;
  if (columns <= 0 && rows <= 0) {
    return '';
  }
  const topLeft = columnName(columns) + (rows + 1);
  // activePane names the quadrant BELOW-RIGHT of the split; with only one axis
  // frozen Excel expects the matching single-axis name instead.
  const activePane =
    columns > 0 && rows > 0 ? 'bottomRight' : columns > 0 ? 'topRight' : 'bottomLeft';

  const attrs = [
    columns > 0 ? 'xSplit="' + columns + '"' : '',
    rows > 0 ? 'ySplit="' + rows + '"' : '',
    'topLeftCell="' + topLeft + '"',
    'activePane="' + activePane + '"',
    'state="frozen"',
  ]
    .filter(Boolean)
    .join(' ');

  // Inner elements only — they are placed inside the sheetView that the
  // workbook writer has already emitted.
  return '<pane ' + attrs + '/><selection pane="' + activePane + '"/>';
}

/**
 * Put `<pane>` inside the worksheet's existing `<sheetView>`.
 *
 * Handles both shapes the writer may produce:
 *   <sheetView .../>            self-closing, must be reopened
 *   <sheetView ...>...</...>    already has children, insert at the front
 *
 * `<pane>` must be the FIRST child of sheetView per the schema, which is why
 * it is inserted immediately after the opening tag rather than appended.
 */
function injectPane(xml: string, pane: string): string | null {
  const open = xml.indexOf('<sheetView ');
  if (open === -1) {
    return null;
  }
  const tagEnd = xml.indexOf('>', open);
  if (tagEnd === -1) {
    return null;
  }

  const selfClosing = xml.charAt(tagEnd - 1) === '/';
  if (selfClosing) {
    const openTag = xml.slice(open, tagEnd - 1) + '>';
    return (
      xml.slice(0, open) + openTag + pane + '</sheetView>' + xml.slice(tagEnd + 1)
    );
  }
  return xml.slice(0, tagEnd + 1) + pane + xml.slice(tagEnd + 1);
}

/**
 * Apply freeze specs to a base64 .xlsx.
 *
 * `specs` is indexed by sheet position, matching the order sheets were appended
 * to the workbook. Returns the original payload untouched if anything about the
 * archive is unexpected — a report that opens without frozen panes beats one
 * that does not open.
 */
export function applyFreezePanes(base64: string, specs: FreezeSpec[]): string {
  try {
    const bytes = base64ToBytes(base64);
    const archive = unzipSync(bytes);

    specs.forEach((spec, index) => {
      const path = 'xl/worksheets/sheet' + (index + 1) + '.xml';
      const entry = archive[path];
      if (!entry) {
        return;
      }
      const xml = strFromU8(entry);
      // Idempotent: if a future library version writes panes itself, leave it.
      if (xml.includes('<pane ')) {
        return;
      }
      const pane = paneXml(spec);
      if (!pane) {
        return;
      }
      const updated = injectPane(xml, pane);
      if (updated) {
        archive[path] = strToU8(updated);
      }
    });

    return bytesToBase64Local(zipSync(archive));
  } catch {
    return base64;
  }
}

/* ------------------------------------------------------------- base64 io -- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = B64.indexOf(clean.charAt(i));
    if (value < 0) {
      continue;
    }
    // eslint-disable-next-line no-bitwise -- base64 is inherently bitwise
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      // eslint-disable-next-line no-bitwise
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

function bytesToBase64Local(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    // eslint-disable-next-line no-bitwise
    const triple = (b0 << 16) | (b1 << 8) | b2;
    /* eslint-disable no-bitwise */
    out += B64.charAt((triple >> 18) & 0x3f);
    out += B64.charAt((triple >> 12) & 0x3f);
    out += i + 1 < bytes.length ? B64.charAt((triple >> 6) & 0x3f) : '=';
    out += i + 2 < bytes.length ? B64.charAt(triple & 0x3f) : '=';
    /* eslint-enable no-bitwise */
  }
  return out;
}
