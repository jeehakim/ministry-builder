/** Pages a visitor can open without being signed in: the invitation link has to work before sign-in. */
export function isPublicPath(pathname: string): boolean {
  return /^\/invite\/[^/]+\/?$/.test(pathname);
}
