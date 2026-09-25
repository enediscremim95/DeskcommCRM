import { describe, expect, it, vi } from 'vitest';
import { loadSkills } from './skills';

describe('loadSkills', () => {
  it('loadSkills expõe versionId de cada skill', async () => {
    const rows = [{ organization_id: null, id: 'ver-1', name: 'frete', description: 'd', body: 'b', matcher: { any_keywords: ['frete'] } }];
    const db = { query: vi.fn().mockResolvedValue({ rows }) } as never;
    const skills = await loadSkills(db, 'org1');
    expect(skills[0]?.versionId).toBe('ver-1');
  });

  it('a versão publicada limita as skills oferecidas ao turno', async () => {
    const rows = [
      { organization_id: null, id: 'ver-1', name: 'frete', description: 'd', body: 'b', matcher: { any_keywords: ['frete'] } },
      { organization_id: null, id: 'ver-2', name: 'agenda', description: 'd', body: 'b', matcher: { any_keywords: ['agenda'] } },
    ];
    const db = { query: vi.fn().mockResolvedValue({ rows }) } as never;

    expect((await loadSkills(db, 'org1', ['agenda'])).map((skill) => skill.name)).toEqual(['agenda']);
    expect(await loadSkills(db, 'org1', [])).toEqual([]);
  });
});
