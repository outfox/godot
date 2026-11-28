import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/libs/library_godot_input.js', import.meta.url), 'utf8');

function keyboard() {
	const library = {};
	const window = new EventTarget();
	const ime = Object.assign(new EventTarget(), { style: {} });
	const canvas = Object.assign(new EventTarget(), { parentElement: { appendChild() {} } });
	const heap = [];
	const events = [];
	vm.runInNewContext(source, { autoAddDeps() {}, mergeInto: Object.assign, LibraryManager: { library } });
	const context = vm.createContext({
		window, document: { createElement: () => ime }, GodotConfig: { canvas },
		GodotEventListeners: { add: (target, ...args) => target.addEventListener(...args) },
		GodotRuntime: { get_func: (callback) => callback, stringToHeap: (text, ptr) => { heap[ptr] = text; } },
	});
	// Emscripten emits library functions in the runtime scope with the $-prefixed helpers as globals.
	const emit = (fn) => vm.runInContext(`(${fn})`, context);
	context.GodotInput = { onKeyEvent: emit(library.$GodotInput.onKeyEvent), getModifiers: emit(library.$GodotInput.getModifiers) };
	context.GodotIME = { init: emit(library.$GodotIME.init) };
	emit(library.godot_js_input_key_cb)((pressed, repeat, modifiers) => {
		events.push([heap[0], !!pressed, !!repeat, modifiers]);
	}, 0, 1);
	emit(library.godot_js_set_ime_cb)(() => {});
	return {
		window, ime, canvas, events,
		send(target, code, down, shift, repeat = false) {
			const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
			Object.assign(event, { code, key: 'Shift', shiftKey: shift, altKey: false, ctrlKey: false, metaKey: false, repeat });
			target.dispatchEvent(event);
			assert.ok(event.defaultPrevented);
		},
	};
}

for (const [first, second] of [['ShiftLeft', 'ShiftRight'], ['ShiftRight', 'ShiftLeft']]) {
	test(`missing ${first} release is recovered on the last keyup`, () => {
		const { send, canvas, ime, events } = keyboard();
		send(canvas, first, true, true);
		send(ime, second, true, true, true); // Windows reports the other side as a repeat.
		send(ime, second, true, true, true); // This one really is a repeat.
		send(canvas, second, false, false);
		assert.deepEqual(events, [
			[first, true, false, 1], [second, true, false, 1], [second, true, true, 1],
			[first, false, false, 0], [second, false, false, 0],
		]);
	});

	test(`normal ${first} and ${second} releases pass through independently`, () => {
		for (const [up, last] of [[first, second], [second, first]]) {
			const { send, canvas, events } = keyboard();
			send(canvas, first, true, true);
			send(canvas, second, true, true);
			send(canvas, up, false, true);
			assert.deepEqual(events.slice(2), [[up, false, false, 1]]);
			send(canvas, last, false, false);
			assert.deepEqual(events.slice(3), [[last, false, false, 0]]);
		}
	});
}

test('focus loss clears remembered Shift keys', () => {
	const { send, canvas, window, events } = keyboard();
	send(canvas, 'ShiftLeft', true, true);
	window.dispatchEvent(new Event('blur'));
	send(canvas, 'ShiftRight', true, true);
	send(canvas, 'ShiftRight', false, false);
	assert.deepEqual(events.slice(1), [['ShiftRight', true, false, 1], ['ShiftRight', false, false, 0]]);
});
