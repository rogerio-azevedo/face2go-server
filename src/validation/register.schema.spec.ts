import { registerSchema } from './register.schema';

describe('registerSchema', () => {
  it('grava e-mail em minúsculas', () => {
    const parsed = registerSchema.parse({
      email: 'PSuelrocha@Gmail.com',
      password: 'secret1',
      name: 'Sueli Pereira Rocha',
      invite: 'ABCD',
    });
    expect(parsed.email).toBe('psuelrocha@gmail.com');
  });
});
