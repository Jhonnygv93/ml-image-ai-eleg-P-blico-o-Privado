import { Router } from "express";
import { downloadAndNormalizeImage } from "../utils/downloadImage.js";
import { generateImagePrompts } from "../services/promptGen.js";
import { generateProductImages } from "../services/imageGen.js";

const router = Router();

router.post("/generate-images", async (req, res) => {
  const { listing } = req.body || {};

  if (!listing || !listing.title) {
    return res.status(400).json({ error: "Falta 'listing' con al menos un título." });
  }
  if (!listing.referenceImageUrl) {
    return res.status(400).json({
      error:
        "No se encontró una imagen de muestra (referenceImageUrl) en la publicación. Verificá que la publicación tenga fotos.",
    });
  }

  try {
    // 1) Descargar y normalizar la primera imagen de la publicación (muestra)
    const referenceImageBuffer = await downloadAndNormalizeImage(listing.referenceImageUrl);

    // 2) GPT-4o-mini analiza la foto de muestra + datos de la publicación
    //    y arma los 12 prompts anclados en las características reales
    const prompts = await generateImagePrompts(listing, referenceImageBuffer);

    // 3) gpt-image-1 genera las 12 imágenes usando la foto de muestra como
    //    referencia visual (edición guiada), en paralelo con concurrencia limitada
    const images = await generateProductImages(prompts, referenceImageBuffer);

    return res.json({ images, promptsUsed: prompts });
  } catch (err) {
    console.error("Error generando imágenes:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
