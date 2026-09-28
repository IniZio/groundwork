import { describe, it, expect } from 'bun:test';
import { formatRowList } from '../../src/engine/run.js';

describe('formatRowList', () => {
  it('empty input returns empty string', () => {
    expect(formatRowList([])).toBe('');
  });

  it('single row returns that number', () => {
    expect(formatRowList([5])).toBe('5');
  });

  it('two non-consecutive rows renders as two singles', () => {
    expect(formatRowList([3, 7])).toBe('3, 7');
  });

  it('two consecutive rows collapses into a range', () => {
    expect(formatRowList([4, 5])).toBe('4-5');
  });

  it('long consecutive run collapses into one range', () => {
    // rows 3..232 (230 rows, all consecutive)
    const rows = Array.from({ length: 230 }, (_, i) => i + 3);
    expect(formatRowList(rows)).toBe('3-232');
  });

  it('gap between runs produces separate segments', () => {
    // rows 14-17, then 42, 61 — three segments total
    expect(formatRowList([14, 15, 16, 17, 42, 61])).toBe('14-17, 42, 61');
  });

  it('exactly 8 segments — no truncation', () => {
    const rows = [1, 3, 5, 7, 9, 11, 13, 15];
    expect(formatRowList(rows)).toBe('1, 3, 5, 7, 9, 11, 13, 15');
  });

  it('>8 segments — caps at 8, appends +N more with exact remaining ROW count', () => {
    const rows = [1, 3, 5, 7, 9, 11, 13, 15, 17];
    expect(formatRowList(rows)).toBe('1, 3, 5, 7, 9, 11, 13, 15, +1 more');
  });

  it('>8 segments — +N more counts rows not segments', () => {
    const rows = [1, 3, 5, 7, 9, 11, 13, 15, 20, 21, 22, 23, 24, 25];
    expect(formatRowList(rows)).toBe('1, 3, 5, 7, 9, 11, 13, 15, +6 more');
  });

  it('rows with multiple gaps all within 8 segments renders all segments', () => {
    expect(formatRowList([14, 15, 16, 17, 42, 61, 78])).toBe('14-17, 42, 61, 78');
  });

  it('5 consecutive comment rows renders as range not comma list', () => {
    expect(formatRowList([1, 2, 3, 4, 5])).toBe('1-5');
  });

  it('6 consecutive rows renders as range', () => {
    expect(formatRowList([1, 2, 3, 4, 5, 6])).toBe('1-6');
  });
});
