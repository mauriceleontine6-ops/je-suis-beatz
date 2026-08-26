const jimpPkg = require('jimp');
const { Jimp } = jimpPkg;

(async () => {
  const img = await Jimp.read('logo.png');
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const samples = [ [0,0], [10,10], [w-1,0], [0,h-1], [Math.floor(w/2), Math.floor(h/2)] ];
  samples.forEach(([x,y]) => {
    const idx = (y * w + x) * 4;
    const a = img.bitmap.data[idx+3];
    console.log(`pixel (${x},${y}) alpha = ${a}`);
  });
})();
