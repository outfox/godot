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
	emit(library.godot_js_input_key_cb)((pressed, repeat, modifiers, timestamp) => {
		events.push([heap[0], !!pressed, !!repeat, modifiers, timestamp]);
	}, 0, 1);
	emit(library.godot_js_set_ime_cb)(() => {});
	return {
		window, ime, canvas, events,
		send(target, code, down, shift, repeat = false, timeStamp = 0) {
			const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
			Object.defineProperty(event, 'timeStamp', { value: timeStamp });
			Object.assign(event, { code, key: 'Shift', shiftKey: shift, altKey: false, ctrlKey: false, metaKey: false, repeat });
			target.dispatchEvent(event);
			assert.ok(event.defaultPrevented);
		},
	};
}

for (const [first, second] of [['ShiftLeft', 'ShiftRight'], ['ShiftRight', 'ShiftLeft']]) {
	test(`missing ${first} release is recovered on the last keyup`, () => {
		const { send, canvas, ime, events } = keyboard();
		send(canvas, first, true, true, false, 10.5);
		send(ime, second, true, true, true, 12.25); // Windows reports the other side as a repeat.
		send(ime, second, true, true, true, 15.0); // This one really is a repeat.
		send(canvas, second, false, false, false, 20.75);
		assert.deepEqual(events, [
			[first, true, false, 1, 10.5], [second, true, false, 1, 12.25], [second, true, true, 1, 15.0],
			[first, false, false, 0, 20.75], [second, false, false, 0, 20.75],
		]);
	});

	test(`normal ${first} and ${second} releases pass through independently`, () => {
		for (const [up, last] of [[first, second], [second, first]]) {
			const { send, canvas, events } = keyboard();
			send(canvas, first, true, true, false, 1.5);
			send(canvas, second, true, true, false, 2.5);
			send(canvas, up, false, true, false, 3.5);
			assert.deepEqual(events.slice(2), [[up, false, false, 1, 3.5]]);
			send(canvas, last, false, false, false, 4.5);
			assert.deepEqual(events.slice(3), [[last, false, false, 0, 4.5]]);
		}
	});
}

test('focus loss clears remembered Shift keys', () => {
	const { send, canvas, window, events } = keyboard();
	send(canvas, 'ShiftLeft', true, true, false, 1.0);
	window.dispatchEvent(new Event('blur'));
	send(canvas, 'ShiftRight', true, true, false, 2.0);
	send(canvas, 'ShiftRight', false, false, false, 3.0);
	assert.deepEqual(events.slice(1), [['ShiftRight', true, false, 1, 2.0], ['ShiftRight', false, false, 0, 3.0]]);
});

test('touch and mouse button callbacks forward DOM event timeStamp', () => {
	const library = {};
	const window = new EventTarget();
	const canvas = Object.assign(new EventTarget(), {
		width: 100, height: 100,
		focus() {},
		getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
	});
	const touchEvents = [];
	const mouseEvents = [];
	vm.runInNewContext(source, { autoAddDeps() {}, mergeInto: Object.assign, LibraryManager: { library } });
	const context = vm.createContext({
		window, Module: {}, GodotConfig: { canvas },
		GodotEventListeners: { add: (target, ...args) => target.addEventListener(...args) },
		GodotRuntime: { get_func: (callback) => callback, setHeapValue() {} },
	});
	const emit = (fn) => vm.runInContext(`(${fn})`, context);
	context.GodotInput = {
		computePosition: emit(library.$GodotInput.computePosition),
		getModifiers: emit(library.$GodotInput.getModifiers),
	};
	emit(library.godot_js_input_touch_cb)((type, count, ts) => touchEvents.push([type, count, ts]), 0, 0);
	emit(library.godot_js_input_mouse_button_cb)((pressed, btn, x, y, mod, ts) => {
		mouseEvents.push([pressed, btn, ts]);
		return 1;
	});

	for (const [name, ts] of [['touchstart', 100.25], ['touchend', 104.75]]) {
		const ev = new Event(name, { cancelable: true });
		Object.defineProperty(ev, 'timeStamp', { value: ts });
		ev.changedTouches = [{ identifier: 1, clientX: 10, clientY: 20 }];
		canvas.dispatchEvent(ev);
	}
	assert.deepEqual(touchEvents, [[0, 1, 100.25], [1, 1, 104.75]]);

	const down = new Event('mousedown', { cancelable: true });
	Object.defineProperty(down, 'timeStamp', { value: 200.5 });
	Object.assign(down, { button: 0, clientX: 10, clientY: 20 });
	canvas.dispatchEvent(down);
	const up = new Event('mouseup', { cancelable: true });
	Object.defineProperty(up, 'timeStamp', { value: 203.125 });
	Object.assign(up, { button: 0, clientX: 10, clientY: 20 });
	window.dispatchEvent(up);
	assert.deepEqual(mouseEvents, [[1, 0, 200.5], [0, 0, 203.125]]);
});
