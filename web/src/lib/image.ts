export type FitMode = "cover" | "contain";

export const ICON_SIZE = 64;
const ACCEPTED = /^image\/(png|jpe?g|webp|gif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon|avif)$/;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Браузер не смог открыть эту картинку. Попробуйте PNG или JPG."));
    img.src = src;
  });
}

/**
 * Converts any browser-decodable image into the 64×64 PNG Minecraft requires.
 * "cover" crops the centre to a square, "contain" fits it with transparent bars.
 * Downscales in halving steps so large photos don't alias into noise.
 * (Data URLs, not blob: URLs, because the panel's CSP doesn't allow blob: images.)
 */
export async function toServerIcon(file: File, mode: FitMode): Promise<string> {
  if (file.type && !ACCEPTED.test(file.type)) throw new Error("Это не картинка. Подойдут PNG, JPG, WebP, GIF, BMP, SVG.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Файл больше 25 МБ");
  const img = await loadImage(await readAsDataUrl(file));
  const w = img.naturalWidth || 512;
  const h = img.naturalHeight || 512;

  let sx = 0;
  let sy = 0;
  let sw = w;
  let sh = h;
  let dx = 0;
  let dy = 0;
  let dw = ICON_SIZE;
  let dh = ICON_SIZE;
  if (mode === "cover") {
    const side = Math.min(w, h);
    sx = (w - side) / 2;
    sy = (h - side) / 2;
    sw = sh = side;
  } else {
    const scale = ICON_SIZE / Math.max(w, h);
    dw = Math.max(1, Math.round(w * scale));
    dh = Math.max(1, Math.round(h * scale));
    dx = Math.round((ICON_SIZE - dw) / 2);
    dy = Math.round((ICON_SIZE - dh) / 2);
  }

  // Step down by halves from the source crop to just above the target size.
  let source: CanvasImageSource = img;
  let curW = sw;
  let curH = sh;
  let cx = sx;
  let cy = sy;
  while (curW / 2 > dw && curH / 2 > dh) {
    const step = document.createElement("canvas");
    step.width = Math.round(curW / 2);
    step.height = Math.round(curH / 2);
    const ctx = step.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, cx, cy, curW, curH, 0, 0, step.width, step.height);
    source = step;
    cx = cy = 0;
    curW = step.width;
    curH = step.height;
  }

  const out = document.createElement("canvas");
  out.width = out.height = ICON_SIZE;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, cx, cy, curW, curH, dx, dy, dw, dh);
  return out.toDataURL("image/png");
}
