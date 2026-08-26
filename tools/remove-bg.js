const jimpPkg = require('jimp');
const { Jimp, JimpMime } = jimpPkg;

(async () => {
  try {
    const inPath = 'icône_site.jpeg';
    const outPath = 'icône_site.png';
    console.log('Reading', inPath);
    const img = await Jimp.read(inPath);
    console.log('Got image, size', img.bitmap.width, 'x', img.bitmap.height);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    // Create a mask from bright pixels (the neon) then dilate to include glow
    const brightThreshold = 60;
    const mask = new Uint8Array(w * h);
    img.scan(0,0,w,h, function(x,y,idx){
      const r = this.bitmap.data[idx+0];
      const g = this.bitmap.data[idx+1];
      const b = this.bitmap.data[idx+2];
      const brightness = (r+g+b)/3;
      if (brightness >= brightThreshold) mask[y*w + x] = 1;
    });

    // Dilate the mask several times to capture glow
    const iterations = 8;
    for (let iter = 0; iter < iterations; iter++) {
      const newMask = mask.slice();
      for (let y0 = 1; y0 < h-1; y0++) {
        for (let x0 = 1; x0 < w-1; x0++) {
          const i0 = y0*w + x0;
          if (mask[i0]) continue;
          // check 8-neighbors
          if (mask[i0-1] || mask[i0+1] || mask[i0-w] || mask[i0+w] || mask[i0-w-1] || mask[i0-w+1] || mask[i0+w-1] || mask[i0+w+1]) {
            newMask[i0] = 1;
          }
        }
      }
      mask.set(newMask);
    }

    // Apply mask: keep pixel if mask true, else make transparent
    img.scan(0,0,w,h, function(x,y,idx){
      const m = mask[y*w + x];
      if (!m) {
        this.bitmap.data[idx+3] = 0;
      }
    });
    const fs = require('fs');
    console.log('Generating PNG buffer...');
    img.write(outPath, (werr) => {
      if (werr) return console.error('write error', werr);
      console.log('Wrote', outPath);
    });
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();