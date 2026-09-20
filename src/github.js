// The GitHub side. Only the three calls we need, so there is nothing to bundle.

const API = process.env.GITHUB_API_URL || "https://api.github.com";

async function gh(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

/** Open issues other than this one, newest first, titles only. */
export async function openIssueTitles(token, repo, exceptNumber, limit = 40) {
  const items = await gh(token, `/repos/${repo}/issues?state=open&per_page=${Math.min(limit + 5, 100)}&sort=created&direction=desc`);
  return items
    .filter((i) => !i.pull_request && i.number !== exceptNumber)
    .slice(0, limit)
    .map((i) => i.title);
}

/** Labels that exist in the repo, so the bot never invents one. */
export async function existingLabels(token, repo) {
  const items = await gh(token, `/repos/${repo}/labels?per_page=100`);
  return new Set(items.map((l) => l.name));
}

/** The diff's shape, which is most of what a reviewer judges a PR on. */
export const pullFiles = (token, repo, number) =>
  gh(token, `/repos/${repo}/pulls/${number}/files?per_page=100`);

export const addLabels = (token, repo, number, labels) =>
  gh(token, `/repos/${repo}/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels }) });

export const comment = (token, repo, number, body) =>
  gh(token, `/repos/${repo}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
