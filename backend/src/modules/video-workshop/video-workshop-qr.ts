const VERSION = 6;
const MODULE_COUNT = 21 + (VERSION - 1) * 4;
const DATA_CODEWORDS = 136;
const BLOCK_DATA_CODEWORDS = 68;
const ERROR_CODEWORDS_PER_BLOCK = 18;
const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;

const GF_EXP = new Array<number>(512).fill(0);
const GF_LOG = new Array<number>(256).fill(0);

let value = 1;
for (let index = 0; index < 255; index += 1) {
  GF_EXP[index] = value;
  GF_LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < GF_EXP.length; index += 1) {
  GF_EXP[index] = GF_EXP[index - 255];
}

function multiply(left: number, right: number) {
  if (!left || !right) return 0;
  return GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function generatorPolynomial(degree: number) {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let offset = 0; offset < polynomial.length; offset += 1) {
      next[offset] ^= polynomial[offset];
      next[offset + 1] ^= multiply(polynomial[offset], GF_EXP[index]);
    }
    polynomial = next;
  }
  return polynomial;
}

const ERROR_GENERATOR = generatorPolynomial(ERROR_CODEWORDS_PER_BLOCK);

function errorCorrection(data: number[]) {
  const message = [
    ...data,
    ...new Array<number>(ERROR_CODEWORDS_PER_BLOCK).fill(0),
  ];
  for (let index = 0; index < data.length; index += 1) {
    const factor = message[index];
    if (!factor) continue;
    for (let offset = 0; offset < ERROR_GENERATOR.length; offset += 1) {
      message[index + offset] ^= multiply(ERROR_GENERATOR[offset], factor);
    }
  }
  return message.slice(data.length);
}

class BitBuffer {
  private readonly bits: boolean[] = [];

  put(value: number, length: number) {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.bits.push(((value >>> index) & 1) === 1);
    }
  }

  get length() {
    return this.bits.length;
  }

  toBytes() {
    const bytes = new Array<number>(Math.ceil(this.bits.length / 8)).fill(0);
    this.bits.forEach((bit, index) => {
      if (bit) bytes[Math.floor(index / 8)] |= 0x80 >>> (index % 8);
    });
    return bytes;
  }
}

function createCodewords(text: string) {
  const payload = Array.from(new TextEncoder().encode(text));
  if (payload.length > 134) {
    throw new Error('Phone upload URL is too long for the local QR code');
  }

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(payload.length, 8);
  payload.forEach((byte) => buffer.put(byte, 8));

  const capacityBits = DATA_CODEWORDS * 8;
  buffer.put(0, Math.min(4, capacityBits - buffer.length));
  while (buffer.length % 8) buffer.put(0, 1);

  const data = buffer.toBytes();
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < DATA_CODEWORDS) {
    data.push(pads[padIndex % 2]);
    padIndex += 1;
  }

  const blocks = [
    data.slice(0, BLOCK_DATA_CODEWORDS),
    data.slice(BLOCK_DATA_CODEWORDS, BLOCK_DATA_CODEWORDS * 2),
  ];
  const errors = blocks.map(errorCorrection);
  const codewords: number[] = [];

  for (let index = 0; index < BLOCK_DATA_CODEWORDS; index += 1) {
    blocks.forEach((block) => codewords.push(block[index]));
  }
  for (let index = 0; index < ERROR_CODEWORDS_PER_BLOCK; index += 1) {
    errors.forEach((block) => codewords.push(block[index]));
  }
  return codewords;
}

type Modules = Array<Array<boolean | null>>;

function setupFinder(modules: Modules, row: number, column: number) {
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    const nextRow = row + rowOffset;
    if (nextRow < 0 || nextRow >= MODULE_COUNT) continue;
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      const nextColumn = column + columnOffset;
      if (nextColumn < 0 || nextColumn >= MODULE_COUNT) continue;
      modules[nextRow][nextColumn] =
        (rowOffset >= 0 &&
          rowOffset <= 6 &&
          (columnOffset === 0 || columnOffset === 6)) ||
        (columnOffset >= 0 &&
          columnOffset <= 6 &&
          (rowOffset === 0 || rowOffset === 6)) ||
        (rowOffset >= 2 &&
          rowOffset <= 4 &&
          columnOffset >= 2 &&
          columnOffset <= 4);
    }
  }
}

function setupAlignment(modules: Modules) {
  const positions = [6, 34];
  for (const row of positions) {
    for (const column of positions) {
      if (modules[row][column] !== null) continue;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          modules[row + rowOffset][column + columnOffset] =
            Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== 1;
        }
      }
    }
  }
}

function setupTiming(modules: Modules) {
  for (let index = 8; index < MODULE_COUNT - 8; index += 1) {
    if (modules[index][6] === null) modules[index][6] = index % 2 === 0;
    if (modules[6][index] === null) modules[6][index] = index % 2 === 0;
  }
}

function bchDigit(value: number) {
  let digit = 0;
  let current = value;
  while (current) {
    digit += 1;
    current >>>= 1;
  }
  return digit;
}

function formatBits(maskPattern: number) {
  const data = (1 << 3) | maskPattern;
  let value = data << 10;
  while (bchDigit(value) - bchDigit(FORMAT_GENERATOR) >= 0) {
    value ^= FORMAT_GENERATOR << (bchDigit(value) - bchDigit(FORMAT_GENERATOR));
  }
  return ((data << 10) | value) ^ FORMAT_MASK;
}

function setupFormatInfo(modules: Modules, maskPattern: number) {
  const bits = formatBits(maskPattern);
  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    if (index < 6) modules[index][8] = dark;
    else if (index < 8) modules[index + 1][8] = dark;
    else modules[MODULE_COUNT - 15 + index][8] = dark;
  }

  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    if (index < 8) modules[8][MODULE_COUNT - index - 1] = dark;
    else if (index < 9) modules[8][15 - index] = dark;
    else modules[8][15 - index - 1] = dark;
  }
  modules[MODULE_COUNT - 8][8] = true;
}

function mask(maskPattern: number, row: number, column: number) {
  switch (maskPattern) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row * column) % 3) + ((row + column) % 2)) % 2 === 0;
  }
}

function mapData(modules: Modules, codewords: number[], maskPattern: number) {
  let row = MODULE_COUNT - 1;
  let direction = -1;
  let byteIndex = 0;
  let bitIndex = 7;

  for (let column = MODULE_COUNT - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const nextColumn = column - offset;
        if (modules[row][nextColumn] !== null) continue;
        let dark =
          byteIndex < codewords.length &&
          ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        if (mask(maskPattern, row, nextColumn)) dark = !dark;
        modules[row][nextColumn] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row >= 0 && row < MODULE_COUNT) continue;
      row -= direction;
      direction = -direction;
      break;
    }
  }
}

export function createQrSvg(text: string) {
  const modules: Modules = Array.from({ length: MODULE_COUNT }, () =>
    new Array<boolean | null>(MODULE_COUNT).fill(null),
  );
  setupFinder(modules, 0, 0);
  setupFinder(modules, MODULE_COUNT - 7, 0);
  setupFinder(modules, 0, MODULE_COUNT - 7);
  setupAlignment(modules);
  setupTiming(modules);
  const maskPattern = 0;
  setupFormatInfo(modules, maskPattern);
  mapData(modules, createCodewords(text), maskPattern);

  const quietZone = 4;
  const size = MODULE_COUNT + quietZone * 2;
  const paths: string[] = [];
  for (let row = 0; row < MODULE_COUNT; row += 1) {
    for (let column = 0; column < MODULE_COUNT; column += 1) {
      if (modules[row][column]) {
        paths.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<path d="${paths.join('')}" fill="#111827"/>`,
    '</svg>',
  ].join('');
}

export function createQrDataUrl(text: string) {
  return `data:image/svg+xml;base64,${Buffer.from(createQrSvg(text)).toString('base64')}`;
}
