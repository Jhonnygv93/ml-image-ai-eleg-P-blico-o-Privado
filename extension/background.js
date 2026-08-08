// background.js — service worker (Manifest V3)
// Coordina: popup -> content script (scrape) -> backend (generación) -> popup (resultado)

const DEFAULT_BACKEND_URL = "http://localhost:3000";

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND_URL;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractListingFromActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error("No se encontró una pestaña activa.");
  if (!/mercadolibre\./.test(tab.url || "")) {
    throw new Error("Abrí una publicación de MercadoLibre antes de analizar.");
  }
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "ML_IMAGE_AI_EXTRACT_LISTING",
  });
  if (!response?.ok) {
    throw new Error(response?.error || "No se pudo leer la publicación.");
  }
  return response.listing;
}

async function generateImages(listing) {
  const backendUrl = await getBackendUrl();
  const res = await fetch(`${backendUrl}/api/generate-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Error del backend (${res.status})`);
  }
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ML_IMAGE_AI_RUN") {
    (async () => {
      try {
        const listing = await extractListingFromActiveTab();
        const result = await generateImages(listing);
        sendResponse({ ok: true, listing, images: result.images });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // respuesta asíncrona
  }
});
