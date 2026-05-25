import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

function readPngDimensions(filePath: string): { width: number; height: number } {
  const header = fs.readFileSync(filePath).subarray(0, 24);

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function readDragArrowMetrics(backgroundSource: string): {
  bodyLength: number;
  headLength: number;
  height: number;
  width: number;
} {
  const arrowPath = backgroundSource.match(/id="dmg-drag-arrow-outline"[\s\S]*?d="([^"]+)"/);
  const points =
    arrowPath?.[1]
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map((coordinate) => Number(coordinate)) ?? [];
  const coordinates = [];
  for (let index = 0; index < points.length; index += 2) {
    coordinates.push({ x: points[index], y: points[index + 1] });
  }
  const uniqueX = [...new Set(coordinates.map((coordinate) => coordinate.x))].sort((a, b) => a - b);
  const uniqueY = [...new Set(coordinates.map((coordinate) => coordinate.y))].sort((a, b) => a - b);
  const [left, shoulderX, tipX] = uniqueX;

  return {
    bodyLength: shoulderX - left,
    headLength: tipX - shoulderX,
    height: uniqueY[uniqueY.length - 1] - uniqueY[0],
    width: tipX - left,
  };
}

describe('DMG packaging', () => {
  test('uses a background asset with the drag-to-Applications arrow', () => {
    const config = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');
    const backgroundMatch = config.match(/^\s{2}background:\s*(.+)$/m);

    expect(backgroundMatch?.[1]).toBe('assets/dmg-background.png');
    expect(config).not.toMatch(/^\s{2}backgroundColor:/m);

    const backgroundPath = path.join(repoRoot, backgroundMatch?.[1] ?? '');

    expect(fs.existsSync(backgroundPath)).toBe(true);
    expect(readPngDimensions(backgroundPath)).toEqual({ width: 580, height: 360 });
  });

  test('keeps the drag arrow as a dashed outline cue', () => {
    const backgroundSource = fs.readFileSync(
      path.join(repoRoot, 'assets/dmg-background.svg'),
      'utf8',
    );

    expect(backgroundSource).toContain('stroke-dasharray');
    expect(backgroundSource).toContain('dmg-drag-arrow-outline');
  });

  test('keeps the drag arrow visually balanced', () => {
    const backgroundSource = fs.readFileSync(
      path.join(repoRoot, 'assets/dmg-background.svg'),
      'utf8',
    );
    const metrics = readDragArrowMetrics(backgroundSource);

    expect(metrics.width).toBeGreaterThan(metrics.height * 2);
    expect(metrics.width).toBeLessThanOrEqual(96);
    expect(metrics.height).toBeLessThanOrEqual(36);
    expect(metrics.bodyLength).toBeGreaterThan(metrics.headLength);
  });
});
