
import ByteView from 'byteview'

const crcTable = (() => {
  const crcTableInternal = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTableInternal[n] = c >>> 0
  }
  return crcTableInternal
})()

export default function crc32 (...args) {
  const { length: argsLength } = args
  let crc = -1
  let indexA = -1

  while (++indexA < argsLength) {
    const byteView = ByteView.from(args[indexA])
    const { length: bvLength } = byteView
    let indexB = -1

    while (++indexB < bvLength) {
      crc = crcTable[(crc ^ byteView[indexB]) & 0xFF] ^ (crc >>> 8)
    }
  }

  return (crc ^ -1) >>> 0
}
