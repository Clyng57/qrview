
import { polyRest } from './utils.js'
import ByteView from 'byteview'

const RULE_3_PATTERN = new Uint8Array([1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0])
const RULE_3_REVERSED_PATTERN = RULE_3_PATTERN.slice().reverse()
const MASK_FNS = [
  (row, column) => ((row + column) & 1) === 0,
  (row, column) => (row & 1) === 0,
  (row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (((row >> 1) + Math.floor(column / 3)) & 1) === 0,
  (row, column) => ((row * column) & 1) + ((row * column) % 3) === 0,
  (row, column) => ((((row * column) & 1) + ((row * column) % 3)) & 1) === 0,
  (row, column) => ((((row + column) & 1) + ((row * column) % 3)) & 1) === 0
]

const EDC_ORDER = 'MLHQ'
const FORMAT_DIVISOR = new Uint8Array([1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1])
const FORMAT_MASK = new Uint8Array([
  1,
  0,
  1,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  1,
  0
])
const VERSION_DIVISOR = new Uint8Array([1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1])

export default class BitMatrix {
  #offset
  #size
  #penaltyScore
  #length = 0

  static from (version, codewords, errorLevel, maskIndex) {
    const sequence = getModuleSequence(version)
    const matrix = BitMatrix.alloc(version)
    let index = -1
    const { length } = sequence

    while (++index < length) {
      const [row, column] = sequence[index]
      // Each codeword contains 8 modules, so shifting the index to the
      // right by 3 gives the codeword's index
      const codeword = codewords[index >> 3]
      const bitShift = 7 - (index & 7)
      const moduleBit = (codeword >> bitShift) & 1
      matrix.setBit(row, column, (moduleBit ^ MASK_FNS[maskIndex](row, column)))
    }

    placeFormatModules(matrix, errorLevel, maskIndex)
    placeFixedPatterns(matrix, version)
    placeVersionModules(matrix)

    return matrix
  }

  static alloc (version) {
    const length = getSize(version)
    let rem = 1
    let outSize = length
    let offset = 0

    while (rem !== 0) {
      rem = outSize % 8
      if (rem === 0) {
        offset = outSize - length
      } else {
        ++outSize
      }
    }

    return new BitMatrix(
      Array.from(
        { length },
        () => ByteView.alloc(outSize / 8)
      ),
      offset
    )
  }

  static optimalMask (version, codewords, errorLevel) {
    let bestMatrix
    let bestScore = Infinity
    let bestMask = -1
    for (let index = 0; index < 8; index++) {
      const matrix = BitMatrix.from(version, codewords, errorLevel, index)
      const penaltyScore = matrix.penaltyScore
      if (penaltyScore < bestScore) {
        bestScore = penaltyScore
        bestMatrix = matrix
        bestMask = index
      }
    }
    return [bestMatrix, bestMask]
  }

  constructor (matrix, offset) {
    this.#length = matrix.length
    let index = -1
    const { length } = matrix
    while (++index < length) {
      this[index] = matrix[index]
    }
    this.#offset = offset
    this.#size = length
    this.#penaltyScore = getPenaltyScore(this)
    Object.preventExtensions(this)
  }

  get offset () {
    return this.#offset
  }

  get size () {
    return this.#size
  }

  get length () {
    return this.#length
  }

  get penaltyScore () {
    return this.#penaltyScore
  }

  fill (row, value, start) {
    const end = value.length > this.#size ? this.#size : value.length
    let count = -1
    start -= 1
    while (++count < end) {
      const bit = value[count]
      this.setBit(row, ++start, bit)
    }
  }

  setBit (row, column, value) {
    this[row].setBit(column + this.#offset, value)
    return this
  }

  getBit (row, column) {
    return this[row].getBit(column + this.#offset)
  }

  toString () {
    const { size } = this
    let res = `${size}`
    let row = -1
    while (++row < size) {
      let column = -1
      res += ', '
      while (++column < size) {
        res += String(this[row].getBit(column + this.#offset))
      }
    }
    return res
  }

  [Symbol.for('nodejs.util.inspect.custom')] () {
    return this.inspect()
  }

  inspect () {
    const { size } = this
    let res = `BitMatrix(${size}x${size}) [`
    let row = -1
    while (++row < size) {
      let column = -1
      res += row === 0 ? '\n  ' : ',\n  '
      while (++column < size) {
        res += String(this[row].getBit(column + this.#offset))
      }
    }
    return res + '\n]'
  }

  toJSON () {
    return {
      type: 'BitMatrix',
      size: this.size
    }
  }
}

function fillBitArea (matrix, row, column, width, height, fill = 1) {
  const fillRow = ByteView.alloc(width).fill(fill)
  for (let index = row; index < row + height; index++) {
    // YES, this mutates the matrix. Watch out!
    matrix.fill(index, fillRow, column)
  }
}

/**
 *
 * @param {number} version
 * @returns {number[][]}
 */
function getModuleSequence (version) {
  const matrix = BitMatrix.alloc(version)
  const size = matrix.size

  // Finder patterns + divisors
  fillBitArea(matrix, 0, 0, 9, 9)
  fillBitArea(matrix, 0, size - 8, 8, 9)
  fillBitArea(matrix, size - 8, 0, 9, 8)
  // CHANGED PART in order to support multiple alignment patterns
  // Alignment patterns
  const alignmentTracks = getAlignmentCoordinates(version)
  const lastTrack = alignmentTracks.length - 1
  alignmentTracks.forEach((row, rowIndex) => {
    alignmentTracks.forEach((column, columnIndex) => {
      // Skipping the alignment near the finder patterns
      if (
        (rowIndex === 0 && (columnIndex === 0 || columnIndex === lastTrack)) ||
        (columnIndex === 0 && rowIndex === lastTrack)
      ) {
        return
      }
      fillBitArea(matrix, row - 2, column - 2, 5, 5)
    })
  })

  // Timing patterns
  fillBitArea(matrix, 6, 9, version * 4, 1)
  fillBitArea(matrix, 9, 6, 1, version * 4)
  // Dark module
  matrix.setBit(size - 8, 8, 1)
  // ADDED PART
  // Version info
  if (version > 6) {
    fillBitArea(matrix, 0, size - 11, 3, 6)
    fillBitArea(matrix, size - 11, 0, 6, 3)
  }

  let rowStep = -1
  let row = size - 1
  let column = size - 1
  const sequence = []
  let index = 0
  while (column >= 0) {
    if (matrix.getBit(row, column) === 0) {
      sequence.push([row, column])
    }
    // Checking the parity of the index of the current module
    if (index & 1) {
      row += rowStep
      if (row === -1 || row === size) {
        rowStep = -rowStep
        row += rowStep
        column -= column === 7 ? 2 : 1
      } else {
        column++
      }
    } else {
      column--
    }
    index++
  }
  return sequence
}

// WARNING: this function *mutates* the given matrix!
/**
 *
 * @param {BitMatrix} matrix
 * @returns {void}
 */
function placeVersionModules (matrix) {
  const size = matrix.size
  const version = (size - 17) >> 2
  if (version < 7) {
    return
  }
  getVersionInformation(version).forEach((bit, index) => {
    const row = Math.floor(index / 3)
    const col = index % 3
    matrix.setBit(5 - row, size - 9 - col, bit)
    matrix.setBit(size - 11 + col, row, bit)
  })
}

// WARNING: this function *mutates* the given matrix!
/**
 *
 * @param {BitMatrix} matrix
 * @param {string} errorLevel
 * @param {number} maskIndex
 * @returns {void}
 */
function placeFormatModules (matrix, errorLevel, maskIndex) {
  const formatModules = getFormatModules(errorLevel, maskIndex)
  matrix.fill(8, formatModules.subarray(0, 6), 0)
  matrix.fill(8, formatModules.subarray(6, 8), 7)
  matrix.fill(8, formatModules.subarray(7), matrix.length - 8)
  matrix.setBit(7, 8, formatModules[8])
  formatModules
    .subarray(0, 7)
    .forEach((cell, index) => (matrix.setBit(matrix.length - index - 1, 8, cell)))
  formatModules
    .subarray(9)
    .forEach((cell, index) => (matrix.setBit(5 - index, 8, cell)))
}

// WARNING: this function *mutates* the given matrix!
function placeFixedPatterns (matrix, version) {
  const size = matrix.size
  // Finder patterns
  ;[
    [0, 0],
    [size - 7, 0],
    [0, size - 7]
  ].forEach(([row, col]) => {
    fillBitArea(matrix, row, col, 7, 7)
    fillBitArea(matrix, row + 1, col + 1, 5, 5, 0)
    fillBitArea(matrix, row + 2, col + 2, 3, 3)
  })
  // Separators
  fillBitArea(matrix, 7, 0, 8, 1, 0)
  fillBitArea(matrix, 0, 7, 1, 7, 0)
  fillBitArea(matrix, size - 8, 0, 8, 1, 0)
  fillBitArea(matrix, 0, size - 8, 1, 7, 0)
  fillBitArea(matrix, 7, size - 8, 8, 1, 0)
  fillBitArea(matrix, size - 7, 7, 1, 7, 0)
  // Alignment patterns
  const alignmentTracks = getAlignmentCoordinates(version)
  const lastTrack = alignmentTracks.length - 1
  alignmentTracks.forEach((row, rowIndex) => {
    alignmentTracks.forEach((column, columnIndex) => {
      // Skipping the alignment near the finder patterns
      if (
        (rowIndex === 0 && (columnIndex === 0 || columnIndex === lastTrack)) ||
        (columnIndex === 0 && rowIndex === lastTrack)
      ) {
        return
      }

      fillBitArea(matrix, row - 2, column - 2, 5, 5)
      fillBitArea(matrix, row - 1, column - 1, 3, 3, 0)
      matrix.setBit(row, column, 1)
    })
  })
  fillBitArea(matrix, size - 8, size - 8, 3, 3, 0)
  matrix.setBit(size - 7, size - 7, 1)
  // Timing patterns
  for (let pos = 8; pos < size - 9; pos += 2) {
    matrix.setBit(6, pos, 1)
    matrix.setBit(6, pos + 1, 0)
    matrix.setBit(pos, 6, 1)
    matrix.setBit(pos + 1, 6, 0)
  }
  matrix.setBit(6, size - 7, 1)
  matrix.setBit(size - 7, 6, 1)
  // Dark module
  matrix.setBit(size - 8, 8, 1)
}

function getSize (version) {
  return version * 4 + 17
}

function getLinePenalty (line, size, offset) {
  let count = 0
  let counting = 0
  let penalty = 0
  let index = -1 + offset
  let num = -1
  while (++num < size) {
    const cell = line.getBit(++index)
    if (cell !== counting) {
      counting = cell
      count = 1
    } else {
      count++
      if (count === 5) {
        penalty += 3
      } else if (count > 5) {
        penalty++
      }
    }
  }
  return penalty
}

function mapMatrix (matrix, callback) {
  const { length } = matrix
  const response = new Array(length)
  let index = -1

  while (++index < length) {
    response[index] = callback(matrix[index], index)
  }

  return response
}

function reduceMatrix (matrix, callback, initialValue) {
  const { size } = matrix
  let index = -1
  while (++index < size) {
    initialValue = callback(initialValue, matrix[index], index)
  }
  return initialValue
}

function reduceColumn (matrix, row, callback, initialValue) {
  let count = matrix.offset - 1
  const { size } = matrix
  while (++count < size) {
    const bit = matrix[row].getBit(count)
    initialValue = callback(initialValue, bit)
  }
  return initialValue
}

/**
 *
 * @param {BitMatrix} matrix
 * @returns
 */
function getPenaltyScore (matrix) {
  let totalPenalty = 0

  // Rule 1
  const rowPenalty = reduceMatrix(matrix, (sum, row) => {
    return sum + getLinePenalty(row, matrix.size, matrix.offset)
  }, 0)
  totalPenalty += rowPenalty

  const columnPenalty = reduceMatrix(matrix, (sum, _, columnIndex) => {
    const column = ByteView.from(mapMatrix(matrix, (row, i) => {
      return matrix.getBit(i, columnIndex)
    }))
    return sum + getLinePenalty(column, matrix.size, matrix.offset)
  }, 0)
  totalPenalty += columnPenalty

  // Rule 2
  let blocks = 0
  const { size } = matrix
  for (let row = 0; row < size - 1; row++) {
    for (let column = 0; column < size - 1; column++) {
      const module = matrix.getBit(row, column)
      if (
        matrix.getBit(row, column + 1) === module &&
        matrix.getBit(row + 1, column) === module &&
        matrix.getBit(row + 1, column + 1) === module
      ) {
        blocks++
      }
    }
  }
  totalPenalty += blocks * 3

  // Rule 3
  let patterns = 0
  for (let index = 0; index < size; index++) {
    const row = index
    for (let columnIndex = 0; columnIndex < size - 11; columnIndex++) {
      if (
        [RULE_3_PATTERN, RULE_3_REVERSED_PATTERN].some(pattern =>
          pattern.every((cell, ptr) => cell === matrix.getBit(row, columnIndex + ptr))
        )
      ) {
        patterns++
      }
    }
    for (let rowIndex = 0; rowIndex < size - 11; rowIndex++) {
      if (
        [RULE_3_PATTERN, RULE_3_REVERSED_PATTERN].some(pattern =>
          pattern.every((cell, ptr) => cell === matrix.getBit(rowIndex + ptr, index))
        )
      ) {
        patterns++
      }
    }
  }
  totalPenalty += patterns * 40

  // Rule 4
  const totalModules = size * size
  const darkModules = reduceMatrix(matrix, (sum, line, row) => {
    return sum + reduceColumn(matrix, row, (lineSum, cell) => lineSum + cell, 0)
  }, 0)
  const percentage = (darkModules * 100) / totalModules
  const mixPenalty = Math.abs(Math.trunc(percentage / 5 - 10)) * 10

  return totalPenalty + mixPenalty
}

function getFormatModules (errorLevel, maskIndex) {
  const formatPoly = new Uint8Array(15)
  const errorLevelIndex = EDC_ORDER.indexOf(errorLevel)
  formatPoly[0] = errorLevelIndex >> 1
  formatPoly[1] = errorLevelIndex & 1
  formatPoly[2] = maskIndex >> 2
  formatPoly[3] = (maskIndex >> 1) & 1
  formatPoly[4] = maskIndex & 1
  const rest = polyRest(formatPoly, FORMAT_DIVISOR)
  formatPoly.set(rest, 5)
  const maskedFormatPoly = formatPoly.map(
    (bit, index) => bit ^ FORMAT_MASK[index]
  )
  return maskedFormatPoly
}

function getAlignmentCoordinates (version) {
  if (version === 1) return []
  const intervals = Math.floor(version / 7) + 1
  const distance = 4 * version + 4 // between first and last pattern
  const step = Math.ceil(distance / intervals / 2) * 2
  return [6].concat(
    Array.from(
      { length: intervals },
      (_, index) => distance + 6 - (intervals - 1 - index) * step
    )
  )
}

// getVersionInformation(26)
// => Uint8Array(18) [0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1]
function getVersionInformation (version) {
  // Using `Uint8Array.from` on a string feels kinda cheating... but it works!
  const poly = Uint8Array.from(
    version.toString(2).padStart(6, '0') + '000000000000'
  )
  poly.set(polyRest(poly, VERSION_DIVISOR), 6)
  return poly
}
