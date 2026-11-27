import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/engine/preloader.js', import.meta.url), 'utf8');

function load(files) {
	const requested = [];
	const context = vm.createContext({
		Response, ReadableStream, DecompressionStream, setTimeout, requestAnimationFrame() {},
		fetch(url) {
			requested.push(url);
			const body = files[url];
			return Promise.resolve(body ? new Response(body) : new Response(null, { status: 404 }));
		},
	});
	vm.runInContext(source + '\nthis.preloader = new Preloader();', context);
	return { preloader: context.preloader, requested };
}

for (const raw of [false, true]) {
	test(`an already decoded precompressed response falls back to the plain file (raw=${raw})`, async () => {
		const { preloader, requested } = load({
			'game.wasm.gz': new Uint8Array([1, 2, 3, 4]),
			'game.wasm': new Uint8Array([5, 6, 7]),
		});
		const result = await Promise.race([
			preloader.loadPromise('game.wasm', 3, raw, '.gz'),
			new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 3000).unref()),
		]);
		const buffer = raw ? await result.arrayBuffer() : result;
		assert.deepEqual([...new Uint8Array(buffer)], [5, 6, 7]);
		assert.deepEqual(requested, ['game.wasm.gz', 'game.wasm']);
	});
}

test('a valid precompressed response is inflated and no plain file is requested', async () => {
	const { preloader, requested } = load({ 'game.wasm.gz': gzipSync(Uint8Array.of(5, 6, 7)) });
	const result = await preloader.loadPromise('game.wasm', 3, false, '.gz');
	assert.deepEqual([...new Uint8Array(result)], [5, 6, 7]);
	assert.deepEqual(requested, ['game.wasm.gz']);
});
