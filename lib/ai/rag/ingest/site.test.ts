import { describe, expect, it } from 'vitest';

import { extrairTextoDeSite } from './site';

describe('fonte de conhecimento por site', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://localhost/segredo',
    'http://169.254.169.254/latest/meta-data',
  ])('recusa destino interno antes de buscar: %s', async (url) => {
    await expect(extrairTextoDeSite(url)).rejects.toThrow();
  });
});
