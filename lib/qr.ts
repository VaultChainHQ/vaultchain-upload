// A small QR Code encoder (byte mode, error-correction level M, versions 1-40, automatic mask choice).
// No dependencies. The algorithm follows ISO/IEC 18004; the unit tests decode the output with a
// reference decoder (jsQR) to prove it. `qrMatrix` returns the module grid; `qrSvgPath` draws it.

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_BITS_M = 0; // level M

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const res = new Array<number>(degree).fill(0);
  res[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < res.length; j++) {
      res[j] = gfMul(res[j], root);
      if (j + 1 < res.length) res[j] ^= res[j + 1];
    }
    root = gfMul(root, 2);
  }
  return res;
}

function rsRemainder(data: number[], div: number[]): number[] {
  const res = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ (res.shift() as number);
    res.push(0);
    div.forEach((c, i) => (res[i] ^= gfMul(c, f)));
  }
  return res;
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export class QrTooLongError extends Error {
  constructor() {
    super("text is too long for a QR code");
    this.name = "QrTooLongError";
  }
}

function buildCodewords(bytes: number[]): { ver: number; words: number[] } {
  let ver = 1;
  for (;; ver++) {
    if (ver > 40) throw new QrTooLongError();
    const cap = dataCodewords(ver) * 8;
    const need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (need <= cap) break;
  }
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capBits = dataCodewords(ver) * 8;
  push(0, Math.min(4, capBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; words.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) words.push(pad);
  // Split into blocks, add error correction, interleave.
  const nb = BLOCKS_M[ver];
  const eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const blocks: number[][] = [];
  const div = rsDivisor(eccLen);
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = words.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]);
    });
  }
  return { ver, words: out };
}

class Grid {
  readonly size: number;
  readonly mods: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly ver: number) {
    this.size = ver * 4 + 17;
    this.mods = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    this.mods[y][x] = dark;
    this.fn[y][x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.set(x, y, d !== 2 && d !== 4);
        }
    }
    const pos = alignPositions(this.ver);
    for (let i = 0; i < pos.length; i++)
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.drawFormat(0); // reserve
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const b = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const c = Math.floor(i / 3);
        this.set(a, c, b);
        this.set(c, a, b);
      }
    }
  }
  drawFormat(mask: number) {
    const n = this.size;
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true);
  }
  drawCodewords(words: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.fn[y][x] && i < words.length * 8) {
            this.mods[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        let inv: boolean;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.fn[y][x] && inv) this.mods[y][x] = !this.mods[y][x];
      }
  }
  penalty(): number {
    const n = this.size;
    const m = this.mods;
    let score = 0;
    const runs = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          if (get(a, b) === get(a, b - 1)) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else run = 1;
        }
      }
    };
    runs((a, b) => m[a][b]);
    runs((a, b) => m[b][a]);
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    const pat = [true, false, true, true, true, false, true, false, false, false, false];
    const finder = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < n; a++)
        for (let b = 0; b + 11 <= n; b++) {
          let f1 = true;
          let f2 = true;
          for (let k = 0; k < 11; k++) {
            if (get(a, b + k) !== pat[k]) f1 = false;
            if (get(a, b + k) !== pat[10 - k]) f2 = false;
          }
          if (f1) score += 40;
          if (f2) score += 40;
        }
    };
    finder((a, b) => m[a][b]);
    finder((a, b) => m[b][a]);
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;
    return score + Math.max(0, k) * 10;
  }
}

function alignPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n - 1) / 2) * 2; // (size - 13) / intervals, rounded up to even
  const res = [6];
  for (let pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

/** The QR module grid for `text` (true = dark). Throws QrTooLongError past ~2,300 bytes. */
export function qrMatrix(text: string): boolean[][] {
  const { ver, words } = buildCodewords(utf8(text));
  const g = new Grid(ver);
  g.drawFunctionPatterns();
  g.drawCodewords(words);
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    g.applyMask(mask);
    g.drawFormat(mask);
    const p = g.penalty();
    if (p < bestScore) {
      bestScore = p;
      best = mask;
    }
    g.applyMask(mask); // undo
  }
  g.applyMask(best);
  g.drawFormat(best);
  return g.mods;
}

/** One SVG path (`M x y h1 v1 h-1z` per dark module, merged by row) for the grid, with a 4-module quiet zone. */
export function qrSvgPath(m: boolean[][], quiet = 4): { d: string; size: number } {
  const parts: string[] = [];
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      parts.push(`M${x + quiet} ${y + quiet}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return { d: parts.join(""), size: m.length + quiet * 2 };
}
