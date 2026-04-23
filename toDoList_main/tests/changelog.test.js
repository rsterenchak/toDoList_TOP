import { changelog, getNewestChangelogDate } from '../src/changelog.js';

describe('changelog', () => {
    it('exports a non-empty array of entries', () => {
        expect(Array.isArray(changelog)).toBe(true);
        expect(changelog.length).toBeGreaterThan(0);
    });

    it('each entry has a version string and an ISO date', () => {
        changelog.forEach((entry) => {
            expect(typeof entry.version).toBe('string');
            expect(entry.version.length).toBeGreaterThan(0);
            expect(typeof entry.date).toBe('string');
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    it('each entry has at least one of added/changed/fixed with string bullets', () => {
        changelog.forEach((entry) => {
            const groups = ['added', 'changed', 'fixed']
                .map((k) => entry[k])
                .filter(Boolean);
            expect(groups.length).toBeGreaterThan(0);
            groups.forEach((bullets) => {
                expect(Array.isArray(bullets)).toBe(true);
                expect(bullets.length).toBeGreaterThan(0);
                bullets.forEach((text) => {
                    expect(typeof text).toBe('string');
                    expect(text.length).toBeGreaterThan(0);
                });
            });
        });
    });

    it('entries are ordered newest-first by date', () => {
        for (let i = 1; i < changelog.length; i++) {
            expect(changelog[i - 1].date >= changelog[i].date).toBe(true);
        }
    });
});

describe('getNewestChangelogDate', () => {
    it('returns the first entry date (newest-first ordering)', () => {
        expect(getNewestChangelogDate()).toBe(changelog[0].date);
    });
});
