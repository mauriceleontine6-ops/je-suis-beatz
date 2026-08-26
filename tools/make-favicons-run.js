const j = require('jimp');
(async ()=>{
  try{
    const img = await j.Jimp.read('icône_site.png');
    for(const s of [32,96,180]){
      const w = img.bitmap.width;
      const h = img.bitmap.height;
      const scale = Math.min(s / w, s / h);
      const newW = Math.max(1, Math.round(w * scale));
      const newH = Math.max(1, Math.round(h * scale));
      const resized = img.clone().resize({ w: newW, h: newH });
      const canvas = new j.Jimp({ width: s, height: s, color: 0x00000000 });
      const x = Math.round((s - newW) / 2);
      const y = Math.round((s - newH) / 2);
      canvas.composite(resized, x, y);
      await new Promise((res)=> canvas.write(`favicon-${s}.png`, () => res()));
      console.log('wrote', `favicon-${s}.png`);
    }
    console.log('done');
  }catch(e){console.error(e);process.exit(1)}
})();
