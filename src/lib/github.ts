// Minimal GitHub Contents API client used by the admin screen to save the
// managed pass list (public/passes.json) straight back to the repo. The token
// is supplied by the admin and only ever lives in their browser's localStorage.

const OWNER = "markusbaechler";
const REPO = "motorbike";
const BRANCH = "claude/eloquent-keller-H9SiF";
const PATH = "public/passes.json";

const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// base64 of a UTF-8 string (handles umlauts in pass names).
function toBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

async function currentSha(token: string): Promise<string | undefined> {
  // Always hit the network (a cached, stale SHA is what causes the 409).
  const res = await fetch(`${API}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub-Lesen fehlgeschlagen (HTTP ${res.status}). ${t.slice(0, 160)}`);
  }
  const j = (await res.json()) as { sha?: string };
  return j.sha;
}

/** Commit the given JSON content to public/passes.json on the deploy branch. */
export async function commitPasses(jsonText: string, token: string): Promise<void> {
  let lastError = "";
  // Retry on 409 (SHA conflict): refetch the fresh SHA and try once more.
  for (let attempt = 0; attempt < 3; attempt++) {
    const sha = await currentSha(token);
    const res = await fetch(API, {
      method: "PUT",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Pässe via Admin aktualisiert",
        content: toBase64(jsonText),
        sha,
        branch: BRANCH,
      }),
    });
    if (res.ok) return;
    const t = await res.text();
    lastError = `HTTP ${res.status}. ${t.slice(0, 200)}`;
    if (res.status !== 409) break; // only SHA conflicts are worth retrying
  }
  throw new Error(`GitHub-Speichern fehlgeschlagen (${lastError})`);
}

export const ADMIN_TARGET = { OWNER, REPO, BRANCH, PATH };
