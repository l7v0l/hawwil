import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/imgcore.js', import.meta.url));
const { processImage } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function fakeEnv(sizeFor) {
  return {
    canvas(width, height) {
      return {
        width,
        height,
        getContext() {
          return {
            fillRect() {},
            drawImage() {},
            getImageData() {
              return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
            }
          };
        }
      };
    },
    async toBlob(canvas, type, quality) {
      return { type, quality, size: sizeFor(canvas, quality) };
    }
  };
}

const options = target => ({
  maxDim: 0,
  type: 'image/jpeg',
  quality: 0.9,
  origType: 'image/jpeg',
  bg: '#fff',
  target
});

test('raises quality to use room below an image size target', async () => {
  const env = fakeEnv((canvas, quality) =>
    Math.round(77 + ((quality - 0.9) / 0.1) * 23));
  const result = await processImage({}, 100, 100, options(100), env);

  assert.equal(result.blob.size, 100);
  assert.ok(result.blob.size <= 100);
  assert.ok(result.blob.quality > 0.99);
});

test('lowers quality when the initial image exceeds the target', async () => {
  const env = fakeEnv((canvas, quality) => Math.round(quality * 200));
  const result = await processImage({}, 100, 100, options(100), env);

  assert.equal(result.blob.size, 100);
  assert.ok(result.blob.quality < 0.9);
});

test('reduces dimensions when minimum quality still exceeds the target', async () => {
  const env = fakeEnv((canvas, quality) =>
    Math.round(quality * 200 * (canvas.width * canvas.height) / 10000));
  const result = await processImage({}, 100, 100, options(40), env);

  assert.ok(result.blob.size <= 40);
  assert.ok(result.blob.size >= 39);
  assert.ok(result.w < 100);
  assert.ok(result.h < 100);
});
