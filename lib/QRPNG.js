
import ByteView from 'byteview'
import { deflate } from 'pako'
import crc32 from './crc32.js'

const PNG_HEAD = ByteView.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_IHDR = [
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  8,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0
]
const PNG_PLTE = [0, 0, 0, 12, 80, 76, 84, 69, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 251, 0, 96, 246]
const PNG_IDAT = ByteView.from([0, 0, 0, 0, 73, 68, 65, 84])
const PNG_IEND = ByteView.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])

export default class QRPNG {
  constructor (matrix, scale, margin, light, dark) {
    const lightRGB = 0xFF
    const darkRGB = 0x00
    const N = matrix.length
    const X = ((N + 2 * margin) * scale)
    const data = ByteView.alloc((X + 1) * X * scale)

    // fill with light color uint
    data.fill(lightRGB, 0)

    for (let i = 0; i < X; i++) {
      data[i * (X + 1)] = 0
    }

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (matrix.getBit(i, j)) {
          const offset = ((margin + i) * (X + 1) + (margin + j)) * scale
          const endSize = offset + scale
          let offsetTarget = offset
          while (offsetTarget < endSize) {
            offsetTarget = data.setUint8(offsetTarget, darkRGB, false)
          }
          for (let c = 1; c < scale; c++) {
            data.copy(data, offset + c * (X + 1), offset, offset + scale)
          }
        }
      }
    }

    this.light = hexToUint32(light)
    this.dark = hexToUint32(dark)
    this.data = data
    this.size = X
  }

  get buffer () {
    const IHDR = ByteView.from(PNG_IHDR)
    IHDR.setUint32(8, this.size, false)
    IHDR.setUint32(12, this.size, false)
    IHDR.setUint8(17, 3)
    IHDR.setUint32(21, crc32(IHDR.slice(4, -4)), false)
    const PLTE = ByteView.from(PNG_PLTE)
    let offset = PLTE.setUint32(8, this.dark, false)
    offset = PLTE.setUint32(offset, this.dark, false)
    offset = PLTE.setUint32(offset, this.light, false)
    PLTE.setUint32(offset, crc32(PLTE.slice(4, -4)), false)

    const IDAT = ByteView.concat([
      PNG_IDAT,
      deflate(this.data),
      new ByteView(4)
    ])

    IDAT.setUint32(0, IDAT.length - 12, false)
    IDAT.setUint32(IDAT.length - 4, crc32(IDAT.slice(4, -4)), false)

    return ByteView.concat([PNG_HEAD, IHDR, PLTE, IDAT, PNG_IEND])
  }
}

function hexToUint32 (hex) {
  const hasAlpha = hex.length > 7
  hex = hex.replace(/^#/, '')
  return hasAlpha ? Number(`0x${hex}`) : Number(`0x${hex}FF`)
}
