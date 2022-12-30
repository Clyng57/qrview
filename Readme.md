
# QRView
[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)

Generate QR Codes

<br />

## Table of Contents
- [ Installation ](#install)
- [ Usage ](#usage)

<br />

<a name="install"></a>
## Install

```console
npm i qrview 
```

<br />

<a name="usage"></a>
## Usage


### new QRView:

```js
import QRView from 'qrview'

const qrView = new QRView('https://example.com')

qrView.toPNG() // returns a ByteView of png data
```
