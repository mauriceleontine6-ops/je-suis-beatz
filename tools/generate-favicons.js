const jimpPkg = require('jimp');
const { Jimp } = jimpPkg;
const sizes = [16,32,96,180];
(async()=>{
  try{
    const src = 'icône_site.png';
    const img = await Jimp.read(src);
    for(const s of sizes){
      const out = `favicon-${s}.png`;
      const w = img.bitmap.width;
      const h = img.bitmap.height;
      const scale = Math.min(s / w, s / h);
      const newW = Math.max(1, Math.round(w * scale));
      const newH = Math.max(1, Math.round(h * scale));
      const resized = img.clone().resize({ w: newW, h: newH });
      const canvas = new Jimp({ width: s, height: s, color: 0x00000000 });
      const x = Math.round((s - newW) / 2);
      const y = Math.round((s - newH) / 2);
      canvas.composite(resized, x, y);
      await new Promise((res,rej)=> canvas.write(out, err=> err?rej(err):res()));
      console.log('wrote', out);
    }
    // create 16/32 explicitly
    const make = async (s, out) => {
      const w = img.bitmap.width;
      const h = img.bitmap.height;
      const scale = Math.min(s / w, s / h);
      const newW = Math.max(1, Math.round(w * scale));
      const newH = Math.max(1, Math.round(h * scale));
      const resized = img.clone().resize({ w: newW, h: newH });
      const canvas = new Jimp({ width: s, height: s, color: 0x00000000 });
      const x = Math.round((s - newW) / 2);
      const y = Math.round((s - newH) / 2);
      canvas.composite(resized, x, y);
      await new Promise((res,rej)=> canvas.write(out, err=> err?rej(err):res()));
    };
    await make(16, 'favicon-16.png');
    await make(32, 'favicon-32.png');
    console.log('favicon generation done');
  }catch(e){console.error(e);process.exit(1)}
})();
