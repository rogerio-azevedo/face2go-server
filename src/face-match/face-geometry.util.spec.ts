import {
  applySimilarity,
  cosineSimilarity,
  estimateSimilarity,
} from './face-geometry.util';

describe('estimateSimilarity', () => {
  it('aplica escala e translação', () => {
    const src: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const dst = src.map(([x, y]): [number, number] => [x * 2 + 10, y * 2 + 5]);
    const sim = estimateSimilarity(src, dst);
    const [x, y] = applySimilarity(sim, 3, 4);
    expect(x).toBeCloseTo(16);
    expect(y).toBeCloseTo(13);
  });

  it('aplica rotação de 90 graus', () => {
    const src: [number, number][] = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    const dst = src.map(([x, y]): [number, number] => [-y, x]);
    const sim = estimateSimilarity(src, dst);
    const [x, y] = applySimilarity(sim, 2, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(2);
  });
});

describe('cosineSimilarity', () => {
  it('é 1 para o mesmo vetor e 0 para ortogonais', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
