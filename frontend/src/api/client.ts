const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  responseType?: "json" | "blob";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const responseType = options.responseType ?? "json";
  const { method = "GET", body, headers: providedHeaders, ...fetchOptions } = options;
  const headers = new Headers(providedHeaders);

  const isFormData = body instanceof FormData;

  if (!isFormData) {
    headers.set("Content-Type", "application/json");
  }

  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = readCookie("csrf_token");
    if (csrfToken) headers.set("x-csrf-token", csrfToken);
  }

  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    method,
    body: isFormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    headers,
    credentials: "include",
  });

  if (!resp.ok) {
    let message = resp.statusText;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      // response body wasn't JSON; fall back to statusText
    }
    throw new ApiRequestError(resp.status, message);
  }

  if (resp.status === 204) return undefined as T;

  const contentType = resp.headers.get("content-type");
  if (responseType === "blob" || contentType?.includes("application/zip") || contentType?.includes("application/octet-stream")) {
    return (await resp.blob()) as unknown as T;
  }

  return (await resp.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) => {
    const postOptions: RequestOptions = {
      ...options,
      method: "POST",
      body: body as BodyInit,
    };
    return request<T>(path, postOptions);
  },
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body as BodyInit,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
