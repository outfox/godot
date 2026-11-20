import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const librarySource = readFileSync(new URL('../js/libs/library_godot_audio.js', import.meta.url), 'utf8');

function loadLibrary() {
	const library = {};
	const context = { autoAddDeps() {}, mergeInto: Object.assign, LibraryManager: { library } };
	vm.runInNewContext(librarySource, context);
	context.GodotAudio = library.$GodotAudio;
	return library;
}

test('sample start proxy matches the native argument types', () => {
	const header = readFileSync(new URL('../godot_audio.h', import.meta.url), 'utf8');
	const [, args] = header.match(/void godot_audio_sample_start\(([^)]*)\)/);
	const types = args.split(',').map((arg) => /^float\s+\w+$/.test(arg.trim()) ? 'f' : 'i');
	assert.equal(loadLibrary().godot_audio_sample_start__sig, 'v' + types.join(''));
});

function startWithPendingWorklet() {
	const audio = loadLibrary().$GodotAudio;
	const starts = [];
	audio.ctx = {
		currentTime: 0,
		createBufferSource: () => ({
			playbackRate: {}, addEventListener() {}, removeEventListener() {}, connect() {}, disconnect() {},
			start(_, offset) { starts.push(offset); },
		}),
	};
	audio.samples = new Map([['music', { loopMode: 'disabled', getAudioBuffer: () => ({}) }]]);
	audio.sampleNodes = new Map();
	audio.Bus = { getBus: () => ({}) };
	audio.SampleNodeBus = { create: () => ({ setVolume() {}, getInputNode: () => ({}), clear() {} }) };
	audio.audioPositionWorkletNodes = [{ port: {}, parameters: new Map([['reset', { setValueAtTime() {} }]]) }];
	let resolveWorklet;
	audio.audioPositionWorkletPromise = new Promise((resolve) => { resolveWorklet = resolve; });

	audio.start_sample('playback', 'music', 0, { start: true, offset: 0.625 });
	return {
		starts,
		pause: (paused) => audio.sample_set_pause('playback', paused),
		stop: () => audio.stop_sample('playback'),
		async ready() {
			resolveWorklet();
			await new Promise((resolve) => setImmediate(resolve));
		},
	};
}

test('a paused sample waits for resume after the worklet attaches', async () => {
	const sample = startWithPendingWorklet();
	sample.pause(true);
	await sample.ready();
	assert.deepEqual(sample.starts, []);
	sample.pause(false);
	sample.pause(false);
	assert.deepEqual(sample.starts, [0.625]);
});

test('resume before the worklet attaches starts the sample once', async () => {
	const sample = startWithPendingWorklet();
	sample.pause(true);
	sample.pause(false);
	assert.deepEqual(sample.starts, []);
	await sample.ready();
	assert.deepEqual(sample.starts, [0.625]);
});

test('cancel before the worklet attaches leaves the sample stopped', async () => {
	const sample = startWithPendingWorklet();
	sample.stop();
	await sample.ready();
	assert.deepEqual(sample.starts, []);
});
