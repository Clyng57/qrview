
import type ByteView from 'byteview'

declare module 'qrview'

declare class BitMatrix {
  #offset
  #size
  #penaltyScore
  #length = 0

  static from (
    version: number,
    codewords: ByteView,
    errorLevel: string,
    maskIndex: number
  ): BitMatrix

  static alloc (
    version: number
  ): BitMatrix

  static optimalMask (
    version: number,
    codewords: ByteView,
    errorLevel: string
  ): [BitMatrix, number]

  constructor (
    matrix: Array,
    offset: number
  ): BitMatrix

  get offset (): number
  get size (): number
  get length (): number
  get penaltyScore (): number

  fill (
    row: number,
    value: 1 | 0 | ByteView,
    start: number
  ): void

  setBit (
    row: number,
    column: number,
    value: 1 | 0
  ): this

  getBit (
    row: number,
    column: number
  ): 1 | 0

  toString (): string

  toJSON (): {
    type: number,
    size: string
  }
}

declare interface QRViewJSON {
  type: 'QRView',
  matrix: BitMatrix,
  version: number,
  size: number,
  errorLevel: 'H' | 'Q' | 'M' | 'L',
  encodingMode: number,
  codewords: ByteView,
  maskIndex: number
}

declare class QRPNG {
  light: number
  dark: number
  data: ByteView
  size: number

  constructor (
    matrix: BitMatrix,
    scale: number,
    margin: number,
    light: string,
    dark: string
  ): QRPNG

  get buffer (): ByteView
}

export default class QRView {
  /**
   *
   * Create a QRView from a JSON.stringified QRView.
   */
  static fromJSON (
    json: string
  ): QRView

  /**
   * 
   * Reviver to pass into JSON.parse.
   * Will transfom data into QRViews and ByteViews.
   */
  static reviver (
    key: string,
    value: any
  ): any

  /**
   *
   * Create QRPNG from string.
   * Use QRPNG.buffer to get a buffer containing all of the png data.
   */
  static createPNG (
    content: string,
    options?: {
      errorCorrection?: 'H' | 'Q' | 'M' | 'L',
      width?: number,
      margin?: number,
      color?: {
        light?: string,
        dark?: string
      }
    }
  ): QRPNG

  matrix: BitMatrix
  version: number
  size: number
  errorLevel: 'H' | 'Q' | 'M' | 'L'
  encodingMode: number
  codewords: ByteView
  maskIndex: number

  constructor (
    content: string | QRViewJSON,
    errorCorrection?: 'H' | 'Q' | 'M' | 'L'
  ): QRView

  toPNG (
    options?: {
      width?: number,
      margin?: number,
      color?: {
        light?: string,
        dark?: string
      }
    }
  ): QRPNG

  toJSON (): QRViewJSON
}
