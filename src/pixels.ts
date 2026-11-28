import { inflateSync } from "node:zlib";

/** 画素の並び。1 画素は RGBA の 4 バイト。 */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * ブラウザが撮ったスクリーンショット (PNG) を、画素の並びに戻す。
 * 対象は 8 ビットの RGB と RGBA で、インターレースのないものに限る。
 */
export function decodePng(png: Buffer): Bitmap {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colorType = body[9];
      if (body[8] !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) throw new Error("unsupported PNG format");
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      chunks.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.buffer, raw.byteOffset + y * (stride + 1) + 1, stride).slice();
    // 行ごとに掛かっているフィルターを外す。
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (line[x]! + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      data[to] = line[from]!;
      data[to + 1] = line[from + 1]!;
      data[to + 2] = line[from + 2]!;
      data[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, data };
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2 枚の画像を升目に区切って比べ、変化した升目に印を付ける。大きさは同じでなければならない。 */
function changedCells(a: Bitmap, b: Bitmap, cell: number, tolerance: number): { columns: number; rows: number; changed: Uint8Array } {
  const columns = Math.ceil(a.width / cell);
  const rows = Math.ceil(a.height / cell);
  const changed = new Uint8Array(columns * rows);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i]! - b.data[i]!) > tolerance || Math.abs(a.data[i + 1]! - b.data[i + 1]!) > tolerance || Math.abs(a.data[i + 2]! - b.data[i + 2]!) > tolerance) {
        changed[Math.floor(y / cell) * columns + Math.floor(x / cell)] = 1;
        // この升目は変化したと分かったので、次の升目まで飛ばす。
        x = (Math.floor(x / cell) + 1) * cell - 1;
      }
    }
  }
  return { columns, rows, changed };
}

/**
 * 1 枚目と 2 枚目の違いのうち、もともと動き続けている部分を除いたものが残るかを返す。
 * moving には、同じ状態で続けて撮った 2 枚を渡す。その 2 枚の間で変わった升目と、その隣の升目は、比較から外す。
 */
export function changedOutsideMotion(a: Bitmap, b: Bitmap, moving: [Bitmap, Bitmap], cell = 8, tolerance = 12): boolean {
  if (a.width !== b.width || a.height !== b.height) return true;
  const difference = changedCells(a, b, cell, tolerance);
  const noise = changedCells(moving[0], moving[1], cell, tolerance);
  const { columns, rows } = difference;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!difference.changed[y * columns + x]) continue;
      let nearNoise = false;
      for (let dy = -1; dy <= 1 && !nearNoise; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && noise.changed[ny * columns + nx]) {
            nearNoise = true;
            break;
          }
        }
      }
      if (!nearNoise) return true;
    }
  }
  return false;
}

/**
 * 2 枚の画像を升目に区切って比べ、変化した升目をつながりごとにまとめて返す。
 * tolerance は、色の成分ごとに見逃す差の大きさ。圧縮や描画のゆらぎを拾わないためのもの。
 */
export function changedRegions(a: Bitmap, b: Bitmap, cell = 16, tolerance = 12): Region[] {
  if (a.width !== b.width || a.height !== b.height) return [{ x: 0, y: 0, width: Math.min(a.width, b.width), height: Math.min(a.height, b.height) }];
  const { columns, rows, changed } = changedCells(a, b, cell, tolerance);
  // 隣り合う升目を 1 つの範囲にまとめる。
  const regions: Region[] = [];
  const seen = new Uint8Array(columns * rows);
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    let minX = columns;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const cx = index % columns;
      const cy = Math.floor(index / columns);
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const next = ny * columns + nx;
        if (changed[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    regions.push({ x: minX * cell, y: minY * cell, width: Math.min(a.width, (maxX + 1) * cell) - minX * cell, height: Math.min(a.height, (maxY + 1) * cell) - minY * cell });
  }
  return regions;
}
