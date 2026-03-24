export function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  const repositoryNameWithOwner = match?.[1]?.trim() ?? "";
  return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}

export function parseGitHubWebUrlFromRemoteUrl(url: string | null): string | null {
  const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url);
  return repositoryNameWithOwner ? `https://github.com/${repositoryNameWithOwner}` : null;
}

export function buildGitHubSshRemoteUrl(repositoryNameWithOwner: string): string {
  return `git@github.com:${repositoryNameWithOwner}.git`;
}
