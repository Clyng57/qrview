
import ByteView from 'byteview'
import ByteEncoder from 'byte-encoder'
import EC_TABLE from './lib/EC_TABLE.js'
import { polyRest, getGeneratorPoly } from './lib/utils.js'
import BitMatrix from './lib/BitMatrix.js'
import QRPNG from './lib/QRPNG.js'

const NUMERIC_RE = /^\d*$/
const ALPHANUMERIC_RE = /^[\dA-Z $%*+\-./:]*$/
/* eslint-disable-next-line no-control-regex */
const LATIN1_RE = /^[\x00-\xff]*$/
const KANJI_RE = /^[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]*$/u
const BIT_WIDTHS = [0, 4, 7, 10]
const ALPHACHAR_MAP = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

function getEDC (data, codewords) {
  const degree = codewords - data.length
  const messagePoly = new Uint8Array(codewords)
  messagePoly.set(data, 0)
  return polyRest(messagePoly, getGeneratorPoly(degree))
}

class NumericMode {
  constructor () {
    this.id = 0b0001
  }

  * values (content) {
    for (let index = 0; index < content.length; index += 3) {
      const chunk = content.substr(index, 3)
      const bitLength = BIT_WIDTHS[chunk.length]
      const value = parseInt(chunk, 10)
      yield { value, bitLength }
    }
  }

  lengthBits (version) {
    return version > 26 ? 14 : version > 9 ? 12 : 10
  }

  /**
   *
   * @param {number} availableBits
   * @returns {number}
   */
  getCapacity (availableBits) {
    const remainderBits = availableBits % 10
    return (
      Math.floor(availableBits / 10) * 3 +
      (remainderBits > 6 ? 2 : remainderBits > 3 ? 1 : 0)
    )
  }

  valueOf () {
    return this.id
  }

  toJSON () {
    return this.id
  }
}

class AlphanumericMode {
  constructor () {
    this.id = 0b0010
  }

  * values (content) {
    for (let index = 0; index < content.length; index += 2) {
      const chunk = content.substr(index, 2)
      const bitLength = chunk.length === 1 ? 6 : 11
      const codes = chunk.split('').map(char => ALPHACHAR_MAP.indexOf(char))
      const value = chunk.length === 1 ? codes[0] : codes[0] * ALPHACHAR_MAP.length + codes[1]
      yield { value, bitLength }
    }
  }

  lengthBits (version) {
    return version > 26 ? 13 : version > 9 ? 11 : 9
  }

  /**
   *
   * @param {number} availableBits
   * @returns {number}
   */
  getCapacity (availableBits) {
    return Math.floor(availableBits / 11) * 2 + (availableBits % 11 > 5 ? 1 : 0)
  }

  valueOf () {
    return this.id
  }

  toJSON () {
    return this.id
  }
}

class UTFMode {
  constructor () {
    this.id = 0b0100
  }

  * values (content) {
    for (const value of new ByteEncoder.Iterator(content)) {
      yield {
        value,
        bitLength: 8
      }
    }
  }

  lengthBits (version) {
    return version > 26 ? 16 : version > 9 ? 16 : 8
  }

  /**
   *
   * @param {number} availableBits
   * @returns {number}
   */
  getCapacity (availableBits) {
    return availableBits >> 3
  }

  valueOf () {
    return this.id
  }

  toJSON () {
    return this.id
  }
}

class KanjiMode {
  constructor () {
    this.id = 0b1000
  }

  * values (content) {
    for (const char of content) {
      /* eslint-disable-next-line */
      const code = getShiftJISCode(char)
      const reduced = code - (code >= 0xe040 ? 0xc140 : 0x8140)
      const value = (reduced >> 8) * 192 + (reduced & 255)
      yield { value, bitLength: 13 }
    }
  }

  lengthBits (version) {
    return version > 26 ? 12 : version > 9 ? 10 : 8
  }

  /**
   *
   * @param {number} availableBits
   * @returns {number}
   */
  getCapacity (availableBits) {
    return Math.floor(availableBits / 13)
  }

  valueOf () {
    return this.id
  }

  toJSON () {
    return this.id
  }
}

class QREncoder {
  constructor (content, errorCorrection) {
    if (typeof content !== 'string') {
      throw new Error('Did not recieve valid content.')
    }

    if (NUMERIC_RE.test(content)) {
      this.mode = new NumericMode()
    } else if (ALPHANUMERIC_RE.test(content)) {
      this.mode = new AlphanumericMode()
    } else if (LATIN1_RE.test(content)) {
      this.mode = new UTFMode()
    } else if (KANJI_RE.test(content)) {
      this.mode = new KanjiMode()
    } else {
      throw new Error('could not get encodingMode from content.')
    }

    // The error levels we're going to consider
    const errorLevels = 'HQML'.slice(0, 'HQML'.indexOf(errorCorrection) + 1)
    let foundInfo = false
    let version = 0
    // find best version with a max of 40
    while (++version <= 40) {
      let errorLevelIndex = -1
      // test errorLevels
      while (++errorLevelIndex < errorLevels.length) {
        const errorLevel = errorLevels[errorLevelIndex]
        const totalCodewords = getAvailableModules(version) >> 3
        const [blocks, ecBlockSize] = EC_TABLE[version - 1][errorLevel]
        const dataCodewords = totalCodewords - blocks * ecBlockSize
        const lengthBits = this.mode.lengthBits(version)
        const availableBits = (dataCodewords << 3) - lengthBits - 4
        const capacity = this.mode.getCapacity(availableBits)
        if (capacity >= content.length) {
          this.version = version
          this.errorLevel = errorLevel
          this.lengthBits = lengthBits
          this.dataCodewords = dataCodewords
          foundInfo = true
          break
        }
      }
      if (foundInfo) break
    }
  }

  writeBits (buffer, value, bitLength, offset) {
    const byteStart = offset >> 3
    const byteEnd = (offset + bitLength - 1) >> 3
    let remainingBits = bitLength
    for (let index = byteStart; index <= byteEnd; index++) {
      const availableBits = index === byteStart ? 8 - (offset & 7) : 8
      const bitMask = (1 << availableBits) - 1
      const rightShift = Math.max(0, remainingBits - availableBits)
      const leftShift = Math.max(0, availableBits - remainingBits)
      // chunk might get over 255, but it won't fit a Uint8 anyway, so no
      // problem here. Watch out using other languages or data structures!
      const chunk = ((value >> rightShift) & bitMask) << leftShift
      buffer[index] |= chunk
      remainingBits -= availableBits
    }
  }

  /**
   *
   * @param {string} content
   * @returns {ByteView}
   */
  #getInitialData (content) {
    let offset = 4 + this.lengthBits
    const initialData = ByteView.alloc(this.dataCodewords)
    this.writeBits(initialData, this.mode.valueOf(), 4, 0)
    this.writeBits(initialData, content.length, this.lengthBits, 4)
    for (const { value, bitLength } of this.mode.values(content)) {
      this.writeBits(initialData, value, bitLength, offset)
      offset += bitLength
    }
    const remainderBits = 8 - (offset & 7)
    const fillerStart = (offset >> 3) + (remainderBits < 4 ? 2 : 1)
    for (let index = 0; index < this.dataCodewords - fillerStart; index++) {
      const byte = index & 1 ? 17 : 236
      initialData[fillerStart + index] = byte
    }
    return initialData
  }

  /**
   *
   * @param {string} content
   * @returns {ByteView}
   */
  encode (content) {
    // Initial Data
    const initialData = this.#getInitialData(content)
    const [ecBlockSize, blocks] = EC_TABLE[this.version - 1][this.errorLevel]

    // Codewords in data blocks (in group 1)
    const blockSize = Math.floor(initialData.length / blocks)
    const blocksInGroup1 = blocks - (initialData.length % blocks)

    // Reorder Data
    // Starting index of each block inside `initialData`
    const blockStartIndexes = Array.from(
      { length: blocks },
      (_, index) => {
        return index < blocksInGroup1 ? blockSize * index : (blockSize + 1) * index - blocksInGroup1
      }
    )
    const reorderView = ByteView.alloc(initialData.length)
    const { length: reorderViewLength } = reorderView
    let reorderViewIndex = -1
    while (++reorderViewIndex < reorderViewLength) {
      // Index of the codeword inside the block
      const blockOffset = Math.floor(reorderViewIndex / blocks)
      /*
        Index of the block to take the codeword from
        If we're at the end (`blockOffset === blockSize`),
        then we take only from the blocks of group 2
      */
      const blockIndex = (reorderViewIndex % blocks) + (blockOffset === blockSize ? blocksInGroup1 : 0)
      // Index of the codeword inside `initialData`
      const codewordIndex = blockStartIndexes[blockIndex] + blockOffset
      reorderView[reorderViewIndex] = initialData[codewordIndex]
    }
    // End Reorder Data

    // Error Correction Data
    const errorCorrectionView = ByteView.alloc(ecBlockSize * blocks)
    for (let offset = 0; offset < blocks; offset++) {
      const start = offset < blocksInGroup1 ? blockSize * offset : (blockSize + 1) * offset - blocksInGroup1
      const end = start + blockSize + (offset < blocksInGroup1 ? 0 : 1)
      const dataBlock = initialData.subarray(start, end)
      const ecCodewords = getEDC(dataBlock, dataBlock.length + ecBlockSize)
      // Interleaving the EC codewords: we place one every `blocks`
      let index = -1
      const { length: ecLength } = ecCodewords
      while (++index < ecLength) {
        errorCorrectionView[index * blocks + offset] = ecCodewords[index]
      }
    }
    // End Error Correction Data

    return ByteView.concat([reorderView, errorCorrectionView])
  }
}

function getAvailableModules (version) {
  if (version === 1) {
    return 21 * 21 - 3 * 8 * 8 - 2 * 15 - 1 - 2 * 5
  }
  const alignmentCount = Math.floor(version / 7) + 2
  return (
    (version * 4 + 17) ** 2 -
    3 * 8 * 8 -
    (alignmentCount ** 2 - 3) * 5 * 5 -
    2 * (version * 4 + 1) +
    (alignmentCount - 2) * 5 * 2 -
    2 * 15 -
    1 -
    (version > 6 ? 2 * 3 * 6 : 0)
  )
}

function verifyQRView (qr) {
  const props = ['matrix', 'version', 'size', 'errorLevel', 'encodingMode', 'codewords', 'maskIndex']
  let res = true
  props.forEach(prop => {
    if (typeof qr[prop] === 'undefined') res = false
  })
  return res
}

export default class QRView {
  static fromJSON (json) {
    return JSON.parse(json, QRView.reviver)
  }

  static encodingMode (string) {
    if (NUMERIC_RE.test(string)) {
      return 0b0001
    }
    if (ALPHANUMERIC_RE.test(string)) {
      return 0b0010
    }
    if (LATIN1_RE.test(string)) {
      return 0b0100
    }
    if (KANJI_RE.test(string)) {
      return 0b1000
    }
    return 0b0111
  }

  static reviver (key, value) {
    return value && value.type === 'ByteView'
      ? ByteView.from(value.data)
      : value.type === 'QRView'
        ? new QRView(value)
        : value
  }

  static createPNG (content, options = {}) {
    options.errorCorrection = options.errorCorrection || 'M'
    const { errorCorrection, ...rest } = options
    const qrView = new QRView(content, errorCorrection)
    return qrView.toPNG(rest)
  }

  constructor (content, errorCorrection = 'M') {
    if (typeof content === 'object') {
      if (verifyQRView(content)) {
        this.matrix = BitMatrix.from(
          content.version,
          content.codewords,
          content.errorLevel,
          content.maskIndex
        )
        this.version = content.version
        this.size = content.size
        this.errorLevel = content.errorLevel
        this.encodingMode = content.encodingMode
        this.codewords = content.codewords
        this.maskIndex = content.maskIndex
      } else {
        throw new TypeError('QRView did not recieve valid type')
      }
    } else {
      const qrEncoder = new QREncoder(content, errorCorrection)
      const codewords = qrEncoder.encode(content)
      const { version, errorLevel } = qrEncoder

      const [bitMatrix, maskIndex] = BitMatrix.optimalMask(version, codewords, errorLevel)
      const { size } = bitMatrix

      this.matrix = bitMatrix
      this.version = version
      this.size = size
      this.errorLevel = errorLevel
      this.encodingMode = qrEncoder.mode.valueOf()
      this.codewords = codewords
      this.maskIndex = maskIndex
    }
  }

  toPNG (
    {
      width = 300,
      margin = 2,
      color = {
        light: 'FFFFFFFF',
        dark: '000000FF'
      }
    } = {
      width: 300,
      margin: 2,
      color: {
        light: 'FFFFFFFF',
        dark: '000000FF'
      }
    }
  ) {
    const { light = 'FFFFFFFF', dark = '000000FF' } = color
    const scale = width && width >= this.size + margin * 2
      ? Math.floor(width / (this.size + margin * 2))
      : 8
    return new QRPNG(this.matrix, scale, margin, light, dark).buffer
  }

  toJSON () {
    return {
      type: 'QRView',
      matrix: this.matrix,
      version: this.version,
      size: this.size,
      errorLevel: this.errorLevel,
      encodingMode: this.encodingMode,
      codewords: this.codewords,
      maskIndex: this.maskIndex
    }
  }
}
