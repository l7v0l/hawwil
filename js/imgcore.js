/* Image pipeline shared by the page and the image worker: resize / crop, choose format, hit a target size.
   env = { canvas(w, h), toBlob(canvas, type, quality) } so it runs on <canvas> or OffscreenCanvas. */

export function fitSize(w, h, maxDim) {
  if (!maxDim || (w <= maxDim && h <= maxDim)) return [w, h];
  const k = maxDim / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function hasAlpha(canvas, env) {
  const k = Math.min(1, 200 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
  const c = env.canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/* source: ImageBitmap | HTMLImageElement; returns { blob, w, h, type } */
export async function processImage(source, sw, sh, o, env) {
  /* o: { maxDim, type: 'auto'|mime, quality, origType, bg, crop: 'w:h'|null, target: bytes|0, forceFlat } */
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (o.crop) {
    const [rw, rh] = o.crop.split(':').map(Number), want = rw / rh;
    if (sw / sh > want) { cw = Math.round(sh * want); sx = Math.round((sw - cw) / 2); }
    else { ch = Math.round(sw / want); sy = Math.round((sh - ch) / 2); }
  }
  let [w, h] = fitSize(cw, ch, o.maxDim || 0);
  const draw = (tw, th, bg) => {
    const c = env.canvas(tw, th), ctx = c.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, tw, th); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, cw, ch, 0, 0, tw, th);
    return c;
  };
  let canvas = draw(w, h, null);
  const alpha = hasAlpha(canvas, env);
  let type = o.type;
  if (type === 'auto' || (o.target && type === 'image/png')) type = o.origType === 'image/webp' ? 'image/webp' : alpha ? 'image/webp' : 'image/jpeg';
  if (type === 'image/jpeg' && alpha) canvas = draw(w, h, o.bg || '#fff');
  const q0 = o.quality ?? 0.9;
  let blob = await env.toBlob(canvas, type, q0);
  if (blob.type !== type) type = blob.type;                // browser could not encode the format we asked for
  if (o.target && type !== 'image/png') {
    let tries = 0;
    let quality = q0;
    while (tries < 6) {
      const hasHeadroom = blob.size <= o.target;
      let lo = hasHeadroom ? quality : 0.3;
      let hi = hasHeadroom ? 1 : quality;
      let best = hasHeadroom ? blob : null;
      for (let i = 0; i < 8 && hi > lo; i++) {
        const mid = (lo + hi) / 2, b = await env.toBlob(canvas, type, mid);
        if (b.size <= o.target) { best = b; lo = mid; } else hi = mid;
      }
      if (best) { blob = best; break; }
      w = Math.max(16, Math.round(w * 0.85)); h = Math.max(16, Math.round(h * 0.85));
      canvas = draw(w, h, type === 'image/jpeg' ? (o.bg || '#fff') : null);
      quality = 0.3;
      blob = await env.toBlob(canvas, type, quality);
      tries++;
    }
  }
  return { blob, w, h, type };
}
