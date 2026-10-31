export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** JSON API call. Adds the CSRF header the backend requires for cookie sessions. */
export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "mc-panel" };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? "GET", headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Нет связи с панелью. Проверьте интернет.");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Ошибка ${res.status}`;
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("mcp:unauthorized"));
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: "DELETE", body });

/** Multipart upload with progress (fetch has no upload progress). */
export function upload(path: string, files: File[], onProgress?: (pct: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("X-Requested-With", "mc-panel");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const data = xhr.responseText ? (JSON.parse(xhr.responseText) as { error?: string }) : {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Загрузка прервалась"));
    xhr.send(form);
  });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
