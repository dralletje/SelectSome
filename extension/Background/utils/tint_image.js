/**
 * @param {string} color
 * @returns {{ color: string, alpha: number }}
 */
let find_and_replace_alpha = (color) => {
  let match = null;
  if (
    (match = color
      .replace(/ /g, "")
      .match(/^(rgba?\([^,]+,[^,]+,[^,]+,)([^,]+)(\))$/))
  ) {
    let [fullmatch, before, transparency, after] = match;
    let alpha = Number(transparency);
    if (!Number.isNaN(alpha)) {
      return {
        color: `${before}1${after}`,
        alpha: alpha,
      };
    } else {
      return { color, alpha: 1 };
    }
  } else if (
    (match = color.replace(/ /g, "").match(/^(#\d\d\d\d\d\d)(\d\d)$/))
  ) {
    let [fullmatch, before, transparency] = match;
    let alpha = Number(`0x${transparency}`) / 255;
    if (!Number.isNaN(alpha)) {
      return {
        color: `${before}`,
        alpha: alpha,
      };
    } else {
      return { color, alpha: 1 };
    }
  } else {
    return { color, alpha: 1 };
  }
};

/** @type {Map<string, Promise<ImageData>>} */
let color_icon_cache = new Map();

/**
 * @template T
 * @param {T} x
 * @returns {NonNullable<T>}
 */
let notnull = (x) => {
  if (x == null) {
    throw new Error("Unexpected null");
  }
  return x;
};

/**
 * Colorize an image with the use of a canvas
 * @param {string} url
 * @param {string} color
 * @returns {Promise<ImageData>}
 */
export let tint_image = async (url, color) => {
  let identifier = `${url}@${color}`;
  if (color_icon_cache.has(identifier)) {
    return notnull(color_icon_cache.get(identifier));
  } else {
    let icon = _color_icon(url, color);
    color_icon_cache.set(identifier, icon);
    return await icon;
  }
};

/**
 * @param {string} url
 * @param {string} _color
 */
let _color_icon = async (url, _color) => {
  let { color, alpha } = find_and_replace_alpha(_color);

  let image_bitmap = await createImageBitmap(await (await fetch(url)).blob());

  let canvas = new OffscreenCanvas(image_bitmap.width, image_bitmap.height);

  // Initaliase a 2-dimensional drawing context
  let ctx = notnull(canvas.getContext("2d"));
  let width = ctx.canvas.width;
  let height = ctx.canvas.height;

  // create offscreen buffer,
  let buffer = new OffscreenCanvas(image_bitmap.width, image_bitmap.height);
  let bx = notnull(buffer.getContext("2d"));
  // fill offscreen buffer with the tint color
  bx.fillStyle = color;
  bx.fillRect(0, 0, buffer.width, buffer.height);
  // destination atop makes a result with an alpha channel identical to fg, but with all pixels retaining their original color *as far as I can tell*
  bx.globalCompositeOperation = "destination-atop";
  bx.drawImage(image_bitmap, 0, 0);

  // to tint the image, draw it first
  ctx.drawImage(image_bitmap, 0, 0);
  ctx.drawImage(buffer, 0, 0);

  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(canvas, 0, 0, width, height);
  ctx.globalAlpha = 1.0;

  return ctx.getImageData(0, 0, width, height);
};
