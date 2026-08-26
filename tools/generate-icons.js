const jimpPkg = require('jimp');
const { Jimp } = jimpPkg;
const fs = require('fs');
(async () => {
  try {
    const inPath = 'icône_site.png';
    console.log('Reading', inPath);
    const img = await Jimp.read(inPath);
    console.log('Image loaded', img.bitmap.width, 'x', img.bitmap.height);
    const sizes = [16,32,96,180,512];
    for (const s of sizes) {
      const out = `favicon-${s}.png`;
      const copy = img.clone().resize({ w: s, h: s });
      const buf = await new Promise((resolve, reject) => {
        copy.getBuffer(jimpPkg.JimpMime.png, (err, data) => err ? reject(err) : resolve(data));
      });
      fs.writeFileSync(out, buf);
      console.log('Wrote', out);
    }
    // also write apple touch icon and large icon
    const buf180 = await new Promise((resolve, reject) => {
      img.clone().resize({ w: 180, h: 180 }).getBuffer(jimpPkg.JimpMime.png, (err, data) => err ? reject(err) : resolve(data));
    });
    fs.writeFileSync('apple-touch-icon.png', buf180);
    console.log('Wrote apple-touch-icon.png');
  } catch (e) {
    console.error('Error', e);
    process.exit(1);
  }
})();