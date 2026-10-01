export type Point = [number, number];

/** x' = a*x - b*y + tx; y' = b*x + a*y + ty */
export type Similarity = {
  a: number;
  b: number;
  tx: number;
  ty: number;
};

export function applySimilarity(sim: Similarity, x: number, y: number): Point {
  return [sim.a * x - sim.b * y + sim.tx, sim.b * x + sim.a * y + sim.ty];
}

function accumulate(
  ata: number[][],
  atb: number[],
  row: number[],
  target: number,
): void {
  for (let i = 0; i < 4; i++) {
    atb[i] += row[i] * target;
    for (let j = 0; j < 4; j++) ata[i][j] += row[i] * row[j];
  }
}

function solve4(matrix: number[][], vector: number[]): number[] {
  const m = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let row = col + 1; row < 4; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    if (Math.abs(div) < 1e-12) {
      throw new Error('Alinhamento facial singular.');
    }
    for (let c = col; c < 5; c++) m[col][c] /= div;
    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let c = col; c < 5; c++) m[row][c] -= factor * m[col][c];
    }
  }
  return [m[0][4], m[1][4], m[2][4], m[3][4]];
}

/** Similaridade (escala, rotação, translação) que leva `src` em `dst`. */
export function estimateSimilarity(src: Point[], dst: Point[]): Similarity {
  const ata = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const atb = [0, 0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const x = src[i][0];
    const y = src[i][1];
    const u = dst[i][0];
    const v = dst[i][1];
    accumulate(ata, atb, [x, -y, 1, 0], u);
    accumulate(ata, atb, [y, x, 0, 1], v);
  }
  const [a, b, tx, ty] = solve4(ata, atb);
  return { a, b, tx, ty };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (denom === 0) return 0;
  return dot / denom;
}

export function l2Normalize(values: number[]): number[] {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return values.slice();
  return values.map((value) => value / norm);
}
