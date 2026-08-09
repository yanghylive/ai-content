import type { AutoUploadAccount } from "./api/auto-upload";

export function autoUploadAccountIdentityKey(
  account: AutoUploadAccount,
): string {
  const platform =
    account.platformKey || account.platform || String(account.type);
  const accountId =
    Number.isFinite(account.id) && account.id > 0
      ? String(account.id)
      : account.stableId || account.filePath || account.userName;
  return `${platform}:${accountId}`;
}

export function dedupeAutoUploadAccounts(
  data: unknown,
): AutoUploadAccount[] {
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  return (data as AutoUploadAccount[]).filter((account) => {
    if (!account || account.id == null) return false;
    const key = autoUploadAccountIdentityKey(account);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isAutoUploadAccountLoggedIn(
  account: AutoUploadAccount,
): boolean {
  if (account.sessionStatus === "logged_in") return true;
  if (
    account.sessionStatus === "needs_login" ||
    account.sessionStatus === "error"
  ) {
    return false;
  }
  return account.status === 1;
}
