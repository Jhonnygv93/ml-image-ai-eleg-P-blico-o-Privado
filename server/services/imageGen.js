import OpenAI, { toFile } from "openai";
import pLimit from "p-limit";
import sharp from "sharp";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Tamaño que soporta nativamente la API de imágenes (cuadrado más cercano).
const IMAGE_SIZE = process.env.IMAGE_SIZE || "1024x1024";
// Tamaño final pedido por el prompt maestro (1200x1200). La API no genera
// ese tamaño de forma nativa, así que cada imagen se reescala después.
const OUTPUT_SIZE = Number(process.env.OUTPUT_SIZE || 1200);
const CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY || 3);

/**
 * Genera UNA imagen usando la foto de muestra como referencia visual
 * (endpoint de edición de imágenes de gpt-image-1), guiada por el prompt
 * específico de ese slot, y la reescala a OUTPUT_SIZE x OUTPUT_SIZE.
 *
 * Cambiar de proveedor de IA: este es el único archivo que hay que tocar.
 * Reemplazá el cuerpo de esta función por una llamada a Stability AI,
 * Google Imagen, etc. El resto del proyecto no cambia.
 */
async function generateSingleImage({ prompt, referenceImageBuffer }) {
  const file = await toFile(referenceImageBuffer, "reference.png", { type: "image/png" });

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: file,
    prompt,
    size: IMAGE_SIZE,
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("La API de imágenes no devolvió datos.");

  const rawBuffer = Buffer.from(b64, "base64");
  const resizedBuffer = await sharp(rawBuffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
    .png()
    .toBuffer();

  return `data:image/png;base64,${resizedBuffer.toString("base64")}`;
}

/**
 * Genera las 12 imágenes (una por prompt) con un límite de concurrencia
 * para no golpear los rate limits de la API. Si una imagen individual
 * falla, no rompe el resto: se devuelve con status "error".
 *
 * @param {Array<{id:string,label:string,prompt:string}>} prompts
 * @param {Buffer} referenceImageBuffer - misma foto de muestra para las 12
 * @returns {Promise<Array<{slot:string,label:string,dataUrl:string|null,error?:string}>>}
 */
export async function generateProductImages(prompts, referenceImageBuffer) {
  const limit = pLimit(CONCURRENCY);

  const tasks = prompts.map((p) =>
    limit(async () => {
      try {
        const dataUrl = await generateSingleImage({
          prompt: p.prompt,
          referenceImageBuffer,
        });
        return {
          slot: p.id,
          label: p.label,
          titleText: p.titleText,
          subtitleText: p.subtitleText,
          dataUrl,
        };
      } catch (err) {
        return {
          slot: p.id,
          label: p.label,
          titleText: p.titleText,
          subtitleText: p.subtitleText,
          dataUrl: null,
          error: String(err?.message || err),
        };
      }
    })
  );

  return Promise.all(tasks);
}
