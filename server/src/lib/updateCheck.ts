const REPO = "minchiki/mc-panel";
const CACHE_MS = 60 * 60_000;

export interface UpdateInfo {
  current: string;
  available: boolean;
  /** How many commits the published branch is ahead of the installed version. */
  behindBy: number;
  latest: string;
  message: string;
}

const NONE = (current: string): UpdateInfo => ({ current, available: false, behindBy: 0, latest: "", message: "" });

interface CompareResponse {
  status?: string;
  ahead_by?: number;
  commits?: { sha: string; commit?: { message?: string } }[];
}

/** GitHub "compare installed...main": `ahead` means main has commits the installed version lacks. */
export function parseCompare(current: string, data: CompareResponse): UpdateInfo {
  if (data.status !== "ahead" || !data.ahead_by) return NONE(current);
  const last = data.commits?.at(-1);
  return {
    current,
    available: true,
    behindBy: data.ahead_by,
    latest: last?.sha.slice(0, 7) ?? "",
    message: (last?.commit?.message ?? "").split("\n")[0]?.slice(0, 120) ?? "",
  };
}

let cache: { current: string; at: number; info: UpdateInfo } | null = null;

/** Never throws: when GitHub is unreachable or doesn't know this build (custom commits), no update is reported. */
export async function checkForUpdate(current: string): Promise<UpdateInfo> {
  if (!/^[0-9a-f]{7,40}$/.test(current)) return NONE(current);
  if (cache && cache.current === current && Date.now() - cache.at < CACHE_MS) return cache.info;
  let info = NONE(current);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${current}...main`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "mc-panel-update-check" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) info = parseCompare(current, (await res.json()) as CompareResponse);
  } catch {
    // offline or blocked: stay silent, retry after the cache window
  }
  cache = { current, at: Date.now(), info };
  return info;
}
