import { csvField, toCSV } from '@/lib/db/backup';

describe('csv export', () => {
  it('quotes fields and blocks formula injection', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField(undefined)).toBe('');
  });

  it('includes symptoms and factors in time order', () => {
    const csv = toCSV(
      [{ id: '1', name: 'Headache', severity: 7, timestamp: '2026-06-02T10:00:00.000Z', notes: 'bad, very' }],
      [{ id: '2', name: 'Dairy', category: 'food', timestamp: '2026-06-01T10:00:00.000Z' }],
    );
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toMatch(/^type,name,category,severity/);
    expect(lines[1]).toMatch(/^factor,Dairy,food/);
    expect(lines[2]).toMatch(/^symptom,Headache,,7,.*"bad, very"/);
  });
});
