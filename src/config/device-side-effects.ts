/**
 * Default ligada. Só `0` desliga o listener de leitores e o worker de sync.
 * O notebook local aponta para o banco e o gateway ISUP de produção.
 */
export function deviceSideEffectsEnabled(
  value: string | undefined = process.env.DEVICE_SIDE_EFFECTS,
): boolean {
  return value !== '0';
}
