const idleState = document.getElementById("idle-state");
const loadingState = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const resultState = document.getElementById("result-state");
const loadingText = document.getElementById("loading-text");
const errorText = document.getElementById("error-text");
const listingTitle = document.getElementById("listing-title");
const imageGrid = document.getElementById("image-grid");
const backendUrlInput = document.getElementById("backend-url");

function showState(name) {
  idleState.classList.add("hidden");
  loadingState.classList.add("hidden");
  errorState.classList.add("hidden");
  resultState.classList.add("hidden");
  document.getElementById(`${name}-state`).classList.remove("hidden");
}

async function loadBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  backendUrlInput.value = backendUrl || "http://localhost:3000";
}

async function saveBackendUrl() {
  await chrome.storage.local.set({ backendUrl: backendUrlInput.value.trim() });
}

function renderImages(images) {
  imageGrid.innerHTML = "";
  images.forEach((img, i) => {
    const figure = document.createElement("figure");
    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = img.slot;

    const dl = document.createElement("a");
    dl.className = "dl";
    dl.href = img.dataUrl;
    dl.download = `${String(i + 1).padStart(2, "0")}-${img.slot}.png`;
    dl.textContent = "↓";

    const caption = document.createElement("figcaption");
    caption.textContent = img.label || img.slot;

    figure.appendChild(imgEl);
    figure.appendChild(dl);
    figure.appendChild(caption);
    imageGrid.appendChild(figure);
  });
}

async function run() {
  showState("loading");
  loadingText.textContent = "Analizando publicación…";

  chrome.runtime.sendMessage({ type: "ML_IMAGE_AI_RUN" }, (response) => {
    if (chrome.runtime.lastError) {
      errorText.textContent = chrome.runtime.lastError.message;
      showState("error");
      return;
    }
    if (!response?.ok) {
      errorText.textContent = response?.error || "Ocurrió un error inesperado.";
      showState("error");
      return;
    }
    listingTitle.textContent = response.listing?.title || "";
    renderImages(response.images || []);
    showState("result");
  });

  // Feedback de progreso mientras esperamos la respuesta del backend
  setTimeout(() => {
    if (!loadingState.classList.contains("hidden")) {
      loadingText.textContent = "Generando 12 imágenes con IA (puede tardar ~1 min)…";
    }
  }, 2500);
}

document.getElementById("run-btn").addEventListener("click", run);
document.getElementById("retry-btn").addEventListener("click", run);
document.getElementById("run-again-btn").addEventListener("click", run);
document.getElementById("save-backend-btn").addEventListener("click", saveBackendUrl);

loadBackendUrl();
