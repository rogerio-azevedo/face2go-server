/** Doc Intelbras: cadastro de foto duplicado (firmware 20260416+). */
export function buildEnableRepFaceFiltSetConfigQuery(enable: boolean): string {
  return `action=setConfig&FaceImageThresholds[0].EnableRepFaceFilt=${enable ? 1 : 0}`;
}
