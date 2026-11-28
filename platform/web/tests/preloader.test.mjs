import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/engine/preloader.js', import.meta.url), 'utf8');

// files maps a URL to its body, or to [body, headers].
function load(files) {
	const requested = [];
	const context = vm.createContext({
		Response, ReadableStream, DecompressionStream, setTimeout, requestAnimationFrame() {},
		fetch(url) {
			requested.push(url);
			const [body, headers] = [files[url]].flat();
			return Promise.resolve(body ? new Response(body, { headers }) : new Response(null, { status: 404 }));
		},
	});
	vm.runInContext(`${source}\nthis.preloader = new Preloader();`, context);
	return { preloader: context.preloader, requested };
}

function settle(promise) {
	return Promise.race([promise, new Promise((_, reject) => {
		setTimeout(() => reject(new Error('hung')), 3000).unref();
	})]);
}

for (const raw of [false, true]) {
	test(`a precompressed response the browser already inflated is used as it is (raw=${raw})`, async () => {
		const { preloader, requested } = load({
			'game.wasm.gz': [Uint8Array.of(5, 6, 7), { 'Content-Encoding': 'gzip' }],
		});
		const result = await settle(preloader.loadPromise('game.wasm', 3, raw, '.gz'));
		const buffer = raw ? await result.arrayBuffer() : result;
		assert.deepEqual([...new Uint8Array(buffer)], [5, 6, 7]);
		assert.deepEqual(requested, ['game.wasm.gz']);
	});
}

test('a buffered load falls back to the plain file when the precompressed body does not inflate', async () => {
	const { preloader, requested } = load({
		'game.pck.gz': Uint8Array.of(1, 2, 3, 4),
		'game.pck': Uint8Array.of(5, 6, 7),
	});
	const result = await settle(preloader.loadPromise('game.pck', 3, false, '.gz'));
	assert.deepEqual([...new Uint8Array(result)], [5, 6, 7]);
	assert.deepEqual(requested, ['game.pck.gz', 'game.pck']);
});

test('a streamed load reports a precompressed body that does not inflate instead of hanging', async () => {
	const { preloader } = load({ 'game.wasm.gz': Uint8Array.of(1, 2, 3, 4) });
	const response = await settle(preloader.loadPromise('game.wasm', 3, true, '.gz'));
	await assert.rejects(settle(response.arrayBuffer()), (error) => error.message !== 'hung');
});

test('a valid precompressed response is inflated and no plain file is requested', async () => {
	const { preloader, requested } = load({ 'game.wasm.gz': gzipSync(Uint8Array.of(5, 6, 7)) });
	const result = await preloader.loadPromise('game.wasm', 3, false, '.gz');
	assert.deepEqual([...new Uint8Array(result)], [5, 6, 7]);
	assert.deepEqual(requested, ['game.wasm.gz']);
});
