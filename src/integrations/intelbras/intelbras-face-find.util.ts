/** Interpreta o payload de FaceInfoManager startFind (JSON ou CGI texto). */
export function intelbrasFaceFindIndicatesExists(data: unknown): boolean {
  if (data && typeof data === 'object' && 'Total' in data) {
    const total = Number((data as { Total?: unknown }).Total);
    return Number.isFinite(total) && total > 0;
  }
  if (typeof data === 'string') {
    const totalMatch = /(?:^|[\r\n])Total=(\d+)/i.exec(data);
    if (totalMatch) return parseInt(totalMatch[1], 10) > 0;
    const foundMatch = /(?:^|[\r\n])found=(\d+)/i.exec(data);
    if (foundMatch) return parseInt(foundMatch[1], 10) > 0;
  }
  return false;
}
