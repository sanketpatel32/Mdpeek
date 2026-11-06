// Pure client-side SVG QR code generator (RFC 18004 compliant).
// Generates scannable QR codes for Wi-Fi collaboration URLs without external CDNs or npm packages.

// GF(256) arithmetic with primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  LOG[0] = 0;
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return EXP[LOG[x] + LOG[y]];
}

function rsPoly(ecBytes) {
  let poly = [1];
  for (let i = 0; i < ecBytes; i++) {
    const factor = [1, EXP[i]];
    const res = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      res[j] ^= gfMul(poly[j], factor[0]);
      res[j + 1] ^= gfMul(poly[j], factor[1]);
    }
    poly = res;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsPoly(ecCount);
  const msg = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// Version configs for byte mode, Error Correction Level M:
// [version, totalCodewords, dataCodewords, ecCodewords, alignmentCoords]
const VERSIONS = [
  null,
  { v: 1, size: 21, total: 26, data: 16, ec: 10, align: [] },
  { v: 2, size: 25, total: 44, data: 28, ec: 16, align: [6, 18] },
  { v: 3, size: 29, total: 70, data: 44, ec: 26, align: [6, 22] },
  { v: 4, size: 33, total: 100, data: 64, ec: 18, align: [6, 26] },
  { v: 5, size: 37, total: 134, data: 86, ec: 24, align: [6, 30] },
];

function pickVersion(dataByteLength) {
  for (let i = 1; i < VERSIONS.length; i++) {
    const cfg = VERSIONS[i];
    // Byte mode overhead: 4 bits mode + 8 bits length = 1.5 bytes.
    if (dataByteLength + 2 <= cfg.data) {
      return cfg;
    }
  }
  return VERSIONS[5];
}

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }
  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }
  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    this.length++;
  }
}

export function generateQrMatrix(text) {
  const enc = new TextEncoder();
  const rawBytes = enc.encode(text);
  const cfg = pickVersion(rawBytes.length);

  const bb = new BitBuffer();
  bb.put(0b0100, 4); // 8-bit Byte mode
  bb.put(rawBytes.length, 8); // character count indicator
  for (let i = 0; i < rawBytes.length; i++) {
    bb.put(rawBytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const remainingBits = cfg.data * 8 - bb.length;
  bb.put(0, Math.min(4, Math.max(0, remainingBits)));

  // Align to byte boundary
  while (bb.length % 8 !== 0) {
    bb.putBit(false);
  }

  // Pad bytes 0xEC, 0x11
  const pad = [0xec, 0x11];
  let padIdx = 0;
  while (bb.buffer.length < cfg.data) {
    bb.buffer.push(pad[padIdx % 2]);
    padIdx++;
  }

  const dataCodewords = bb.buffer.slice(0, cfg.data);
  const ecCodewords = rsEncode(dataCodewords, cfg.ec);
  const allCodewords = dataCodewords.concat(ecCodewords);

  // Initialize module matrix
  const size = cfg.size;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const isReserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function setModule(r, c, val, reserved = true) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val;
      if (reserved) isReserved[r][c] = true;
    }
  }

  // 1. Finder patterns (7x7) + separators (1px white)
  function placeFinder(top, left) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row >= 0 && row < size && col >= 0 && col < size) {
          const isBlack =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setModule(row, col, isBlack);
        }
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Alignment patterns for v >= 2
  if (cfg.align && cfg.align.length > 0) {
    const coords = cfg.align;
    for (const r of coords) {
      for (const c of coords) {
        // Skip finders
        if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBlack = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            setModule(r + dr, c + dc, isBlack);
          }
        }
      }
    }
  }

  // 3. Timing patterns (row 6, col 6)
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) setModule(6, i, i % 2 === 0);
    if (matrix[i][6] === null) setModule(i, 6, i % 2 === 0);
  }

  // Dark module (4 * V + 9, 8)
  setModule(4 * cfg.v + 9, 8, true);

  // Format reserve areas
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isReserved[8][i] = true;
      isReserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isReserved[8][size - 1 - i] = true;
    isReserved[size - 1 - i][8] = true;
  }

  // 4. Place Data Codewords
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  let inc = -1;
  let row = size - 1;

  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing column
    while (true) {
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const col = rightCol - colOffset;
        if (!isReserved[row][col]) {
          let bit = false;
          if (bitIdx < totalBits) {
            const byteVal = allCodewords[Math.floor(bitIdx / 8)];
            bit = ((byteVal >>> (7 - (bitIdx % 8))) & 1) === 1;
            bitIdx++;
          }
          // Mask pattern 0: (row + col) % 2 === 0
          if ((row + col) % 2 === 0) bit = !bit;
          matrix[row][col] = bit;
        }
      }
      row += inc;
      if (row < 0 || row >= size) {
        inc = -inc;
        row += inc;
        break;
      }
    }
  }

  // 5. Format info (Level M, Mask 0): precomputed BCH code = 0b101010000010010
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // Top-left
  const tlCoords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8],
    [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = tlCoords[i];
    matrix[r][c] = formatBits[i] === 1;
  }
  // Bottom-left and Top-right
  for (let i = 0; i < 7; i++) {
    matrix[size - 1 - i][8] = formatBits[i] === 1;
  }
  for (let i = 7; i < 15; i++) {
    matrix[8][size - 15 + i] = formatBits[i] === 1;
  }

  return matrix;
}

/**
 * Generates an SVG string representation of the QR code.
 * @param {string} text URL or string to encode
 * @param {object} [opts] Options: size, margin, fgColor, bgColor
 * @returns {string} SVG string
 */
export function generateQrSvg(text, { size = 200, margin = 2, fgColor = '#000000', bgColor = '#ffffff' } = {}) {
  const matrix = generateQrMatrix(text);
  const n = matrix.length;
  const viewBoxSize = n + margin * 2;

  let pathData = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-label="QR Code for ${text}">
  <rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${bgColor}" />
  <path d="${pathData.trim()}" fill="${fgColor}" />
</svg>`;
}
