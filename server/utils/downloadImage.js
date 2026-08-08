import sharp from "sharp";

/**
 * Descarga la imagen de referencia (primera foto de la publicación de ML)
 * y la normaliza a PNG cuadrado, formato requerido por la API de edición
 * de imágenes de OpenAI (gpt-image-1).
 *
 * @param {string} url - URL pública de la imagen (ej. http2.mlstatic.com/...)
 * @returns {Promise<Buffer>} PNG buffer listo para enviar a la API
 */
export async function downloadAndNormalizeImage(url) {
  if (!url) throw new Error("No se recibió referenceImageUrl.");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen de referencia (${res.status}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Normalizamos a PNG, fondo blanco, tamaño cuadrado (requisito de la API de edición).
  const pngBuffer = await sharp(inputBuffer)
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  return pngBuffer;
}
