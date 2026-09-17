import { ApiError } from "./api-error";
export { ApiError } from "./api-error";
export const browserMode = import.meta.env.MODE === "pages";
let csrfToken = "";
export function setCsrf(value: string) {
  csrfToken = value;
}
export async function api<T>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (browserMode) {
    const { browserApi } = await import("./pages/runtime");
    try {
      return await browserApi<T>(url, body, method);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        !url.startsWith("/api/auth/")
      ) {
        window.dispatchEvent(new Event("agenda:session-expired"));
      }
      throw error;
    }
  }
  const response = await fetch(url, {
    method: method || (body ? "POST" : "GET"),
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.startsWith("/api/auth/"))
    window.dispatchEvent(new Event("agenda:session-expired"));
  if (!response.ok)
    throw new ApiError(
      data.message ||
        data.error ||
        "Permintaan belum berhasil. Silakan coba lagi.",
      response.status,
      data,
    );
  return data;
}
