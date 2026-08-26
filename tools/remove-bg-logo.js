const jimpPkg = require('jimp');
const { Jimp } = jimpPkg;

(async () => {
  try {
    const inPath = 'logo.png';
    const outPath = 'logo.png';
    console.log('Reading', inPath);
    const img = await Jimp.read(inPath);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    console.log('Image size', w, 'x', h);

    // Build mask: keep pixels that are sufficiently bright/non-black
    const mask = new Uint8Array(w * h);
    const brightThreshold = 30; // tune: pixels brighter than this are kept

    img.scan(0, 0, w, h, function (x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      // perceptual luminance
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum > brightThreshold) mask[y * w + x] = 1;
    });

    // Dilate mask to include glow edges
    const iterations = 12;
    for (let iter = 0; iter < iterations; iter++) {
      const newMask = new Uint8Array(mask);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (mask[i]) continue;
          if (
            mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w] ||
            mask[i - w - 1] || mask[i - w + 1] || mask[i + w - 1] || mask[i + w + 1]
          ) {
            newMask[i] = 1;
          }
        }
      }
      mask.set(newMask);
    }

    // Apply mask: make background pixels transparent
    let removed = 0;
    img.scan(0, 0, w, h, function (x, y, idx) {
      const i = y * w + x;
      if (!mask[i]) {
        this.bitmap.data[idx + 3] = 0; // alpha = 0
        removed++;
      }
    });

    console.log('Transparent pixels set:', removed);
    img.write(outPath, (err) => {
      if (err) return console.error('write error', err);
      console.log('Wrote', outPath);
    });
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
