const BASE = "/api";

async function req(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const listSellers = () => req("/sellers");
export const getDashboard = (sellerId) => req(`/sellers/${sellerId}/dashboard`);
export const getItems = (sellerId) => req(`/sellers/${sellerId}/items`);
export const askAccount = (sellerId, question) =>
  req(`/sellers/${sellerId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
export const reportUrl = (sellerId) => `${BASE}/sellers/${sellerId}/report.pdf`;
