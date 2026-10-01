import { existsSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import {
  estimateSimilarity,
  l2Normalize,
  type Point,
  type Similarity,
} from './face-geometry.util';

const STRIDES = [8, 16, 32] as const;
const SCORE_THRESHOLD = 0.6;
const SCORE_RETRY = 0.3;
const NMS_IOU = 0.3;
/** O YuNet 2023mar deste pacote entra fixo em 640×640. */
const DETECT_SIZE = 640;
const ALIGNED = 112;

/** Olho direito, olho esquerdo, nariz, canto direito da boca, canto esquerdo. */
const SFACE_TEMPLATE: Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

type Ort = typeof import('onnxruntime-node');
type OrtSession = import('onnxruntime-node').InferenceSession;
type OrtTensor = import('onnxruntime-node').Tensor;

type Sessions = {
  ort: Ort;
  detect: OrtSession;
  recognize: OrtSession;
};

type BoxFace = {
  score: number;
  landmarks: Point[];
  x: number;
  y: number;
  w: number;
  h: number;
};

let sessionsPromise: Promise<Sessions> | null = null;

function modelPath(fileName: string): string {
  const candidates = [
    join(__dirname, 'models', fileName),
    join(process.cwd(), 'dist', 'face-match', 'models', fileName),
    join(process.cwd(), 'src', 'face-match', 'models', fileName),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`Modelo facial ausente: ${fileName}`);
  }
  return found;
}

async function openSessions(): Promise<Sessions> {
  process.env.ORT_LOG_SEVERITY_LEVEL ??= '3';
  const ort = await import('onnxruntime-node');
  ort.env.logSeverityLevel = 3;
  const sessionOptions = { logSeverityLevel: 3 as const };
  const [detect, recognize] = await Promise.all([
    ort.InferenceSession.create(
      modelPath('face_detection_yunet_2023mar.onnx'),
      sessionOptions,
    ),
    ort.InferenceSession.create(
      modelPath('face_recognition_sface_2021dec.onnx'),
      sessionOptions,
    ),
  ]);
  return { ort, detect, recognize };
}

function sessions(): Promise<Sessions> {
  sessionsPromise ??= openSessions().catch((error: unknown) => {
    sessionsPromise = null;
    throw error;
  });
  return sessionsPromise;
}

function floats(tensor: OrtTensor): Float32Array {
  const data = tensor.data;
  if (data instanceof Float32Array) return data;
  return Float32Array.from(data as ArrayLike<number>);
}

function channelAt(
  data: Float32Array,
  dims: readonly number[],
  index: number,
  channel: number,
  channels: number,
  cells: number,
): number {
  if (dims[dims.length - 1] === channels) {
    return data[index * channels + channel];
  }
  if (dims[1] === channels) {
    return data[channel * cells + index];
  }
  return data[index * channels + channel];
}

function decodeStride(
  stride: number,
  cls: OrtTensor,
  obj: OrtTensor,
  bbox: OrtTensor,
  kps: OrtTensor,
  padW: number,
  padH: number,
  scoreThreshold: number,
): BoxFace[] {
  const cols = Math.floor(padW / stride);
  const rows = Math.floor(padH / stride);
  const cells = rows * cols;
  const clsData = floats(cls);
  const objData = floats(obj);
  const bboxData = floats(bbox);
  const kpsData = floats(kps);
  const faces: BoxFace[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const clsScore = Math.min(1, Math.max(0, clsData[index] ?? 0));
      const objScore = Math.min(1, Math.max(0, objData[index] ?? 0));
      const score = Math.sqrt(clsScore * objScore);
      if (score < scoreThreshold) continue;

      const box = (channel: number) =>
        channelAt(bboxData, bbox.dims, index, channel, 4, cells);
      const cx = (col + box(0)) * stride;
      const cy = (row + box(1)) * stride;
      const w = Math.exp(box(2)) * stride;
      const h = Math.exp(box(3)) * stride;
      const landmarks: Point[] = [];
      for (let n = 0; n < 5; n++) {
        const lx =
          (channelAt(kpsData, kps.dims, index, n * 2, 10, cells) + col) *
          stride;
        const ly =
          (channelAt(kpsData, kps.dims, index, n * 2 + 1, 10, cells) + row) *
          stride;
        landmarks.push([lx, ly]);
      }
      faces.push({
        score,
        landmarks,
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
      });
    }
  }
  return faces;
}

function intersectionOverUnion(left: BoxFace, right: BoxFace): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.w, right.x + right.w);
  const y2 = Math.min(left.y + left.h, right.y + right.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.w * left.h + right.w * right.h - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function nonMaxSuppression(faces: BoxFace[]): BoxFace[] {
  const ordered = [...faces].sort((a, b) => b.score - a.score);
  const kept: BoxFace[] = [];
  for (const face of ordered) {
    if (kept.every((other) => intersectionOverUnion(face, other) < NMS_IOU)) {
      kept.push(face);
    }
  }
  return kept;
}

function detectFaces(
  outputs: Record<string, OrtTensor>,
  padW: number,
  padH: number,
  scoreThreshold: number,
): BoxFace[] {
  const faces: BoxFace[] = [];
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) {
      throw new Error(`Saída YuNet ausente para stride ${stride}.`);
    }
    faces.push(
      ...decodeStride(stride, cls, obj, bbox, kps, padW, padH, scoreThreshold),
    );
  }
  return nonMaxSuppression(faces);
}

function inverseMap(sim: Similarity, x: number, y: number): Point {
  const dx = x - sim.tx;
  const dy = y - sim.ty;
  const det = sim.a * sim.a + sim.b * sim.b;
  if (det < 1e-8) return [0, 0];
  return [(sim.a * dx + sim.b * dy) / det, (-sim.b * dx + sim.a * dy) / det];
}

function sampleRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  const clampedX = Math.min(width - 1, Math.max(0, x));
  const clampedY = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.min(width - 1, Math.floor(clampedX));
  const y0 = Math.min(height - 1, Math.floor(clampedY));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const wx = clampedX - x0;
  const wy = clampedY - y0;
  const at = (px: number, py: number, channel: number) =>
    rgb[(py * width + px) * 3 + channel] ?? 0;
  const mix = (channel: number) =>
    at(x0, y0, channel) * (1 - wx) * (1 - wy) +
    at(x1, y0, channel) * wx * (1 - wy) +
    at(x0, y1, channel) * (1 - wx) * wy +
    at(x1, y1, channel) * wx * wy;
  return [mix(0), mix(1), mix(2)];
}

function alignToSface(
  rgb: Uint8Array,
  width: number,
  height: number,
  landmarks: Point[],
): Float32Array {
  const sim = estimateSimilarity(landmarks, SFACE_TEMPLATE);
  const tensor = new Float32Array(3 * ALIGNED * ALIGNED);
  const plane = ALIGNED * ALIGNED;
  for (let y = 0; y < ALIGNED; y++) {
    for (let x = 0; x < ALIGNED; x++) {
      const [sx, sy] = inverseMap(sim, x + 0.5, y + 0.5);
      const [r, g, b] = sampleRgb(rgb, width, height, sx, sy);
      const dst = y * ALIGNED + x;
      tensor[dst] = r;
      tensor[plane + dst] = g;
      tensor[plane * 2 + dst] = b;
    }
  }
  return tensor;
}

/** Vetor L2 da maior face da foto. `null` quando não há rosto. */
export async function embedJpeg(jpeg: Buffer): Promise<number[] | null> {
  const { ort, detect, recognize } = await sessions();
  const oriented = await sharp(jpeg, { failOn: 'none' }).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 16 || height < 16) return null;

  const scale = DETECT_SIZE / Math.max(width, height);
  const resizedW = Math.min(
    DETECT_SIZE,
    Math.max(1, Math.round(width * scale)),
  );
  const resizedH = Math.min(
    DETECT_SIZE,
    Math.max(1, Math.round(height * scale)),
  );
  const resized = await sharp(oriented)
    .resize(resizedW, resizedH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const padW = DETECT_SIZE;
  const padH = DETECT_SIZE;
  const plane = padW * padH;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < resized.info.height; y++) {
    for (let x = 0; x < resized.info.width; x++) {
      const src = (y * resized.info.width + x) * resized.info.channels;
      const dst = y * padW + x;
      input[dst] = resized.data[src + 2] ?? 0;
      input[plane + dst] = resized.data[src + 1] ?? 0;
      input[plane * 2 + dst] = resized.data[src] ?? 0;
    }
  }

  const detected = await detect.run({
    [detect.inputNames[0]]: new ort.Tensor('float32', input, [
      1,
      3,
      padH,
      padW,
    ]),
  });
  const backX = width / resized.info.width;
  const backY = height / resized.info.height;
  let faces = detectFaces(detected, padW, padH, SCORE_THRESHOLD);
  if (faces.length === 0) {
    faces = detectFaces(detected, padW, padH, SCORE_RETRY);
  }
  const face = faces[0];
  if (!face) return null;

  const full = await sharp(oriented)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const landmarks = face.landmarks.map(([x, y]): Point => [
    x * backX,
    y * backY,
  ]);
  const aligned = alignToSface(
    full.data,
    full.info.width,
    full.info.height,
    landmarks,
  );
  const recognized = await recognize.run({
    [recognize.inputNames[0]]: new ort.Tensor('float32', aligned, [
      1,
      3,
      ALIGNED,
      ALIGNED,
    ]),
  });
  const outputName = recognize.outputNames[0];
  const output = outputName ? recognized[outputName] : undefined;
  if (!output) return null;
  return l2Normalize(Array.from(floats(output)));
}
