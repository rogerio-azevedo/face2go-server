import { buildEnableRepFaceFiltSetConfigQuery } from './intelbras-rep-face-filt.util';

describe('buildEnableRepFaceFiltSetConfigQuery', () => {
  it('desliga o filtro com 0 e colchetes literais', () => {
    const qs = buildEnableRepFaceFiltSetConfigQuery(false);
    expect(qs).toBe(
      'action=setConfig&FaceImageThresholds[0].EnableRepFaceFilt=0',
    );
    expect(qs).not.toContain('%5B');
  });

  it('religa o filtro com 1', () => {
    expect(buildEnableRepFaceFiltSetConfigQuery(true)).toContain(
      'EnableRepFaceFilt=1',
    );
  });
});
