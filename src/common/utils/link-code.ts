/** Código curto para links públicos (8 chars base36 maiúsculos). */
export function randomLinkCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
