/** PostgreSQL may abort one writer when an authorizer changes while accepting. */
export async function retryTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      let cause: unknown = error;
      let retryable = false;
      for (let depth = 0; cause && depth < 5; depth++) {
        const item = cause as { code?: string; cause?: unknown };
        if (item.code === '40P01' || item.code === '40001') retryable = true;
        cause = item.cause;
      }
      if (!retryable || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
