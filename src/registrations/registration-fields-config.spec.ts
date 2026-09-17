import {
  applyRestrictMinorsFieldRules,
  defaultConfigForClientType,
  overrideFromResolved,
  resolveRegistrationFieldsConfig,
} from './registration-fields-config';

describe('registration-fields-config', () => {
  it('condomínio exige bloco e unidade e oculta nascimento', () => {
    const config = defaultConfigForClientType('condominium');
    expect(config.document).toBe('required');
    expect(config.block).toBe('required');
    expect(config.unit).toBe('required');
    expect(config.room).toBe('hidden');
    expect(config.birthDate).toBe('hidden');
  });

  it('mescla override salvo com o default do tipo', () => {
    const resolved = resolveRegistrationFieldsConfig('condominium', {
      birthDate: 'required',
      document: 'optional',
    });
    expect(resolved.birthDate).toBe('required');
    expect(resolved.document).toBe('optional');
    expect(resolved.block).toBe('required');
  });

  it('grava só o que difere do default', () => {
    const resolved = resolveRegistrationFieldsConfig('condominium', {
      birthDate: 'required',
    });
    expect(overrideFromResolved('condominium', resolved)).toEqual({
      birthDate: 'required',
    });
  });

  it('força data de nascimento quando há leitor 18+', () => {
    const hidden = defaultConfigForClientType('other');
    expect(hidden.birthDate).toBe('hidden');
    expect(applyRestrictMinorsFieldRules(hidden, false).birthDate).toBe(
      'hidden',
    );
    expect(applyRestrictMinorsFieldRules(hidden, true).birthDate).toBe(
      'required',
    );
  });
});
