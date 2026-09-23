/** Tenta religar a trava de face parecida. A segunda falha vira erro do job. */
export async function restoreSimilarFaceLock(
  enable: () => Promise<void>,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await enable();
      return;
    } catch (err) {
      last = err;
    }
  }
  const detail =
    last instanceof Error ? last.message : last != null ? String(last) : '';
  throw new Error(
    `A trava de foto parecida pode ter ficado desligada neste leitor.${detail ? ` ${detail}` : ''}`,
  );
}
