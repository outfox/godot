import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../../../platform/web/js/engine/config.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../../../platform/web/js/engine/engine.js', import.meta.url), 'utf8');
const featuresSource = readFileSync(new URL('../../../platform/web/js/engine/features.js', import.meta.url), 'utf8');
const deviceSource = readFileSync(new URL('../../../platform/web/js/engine/webgpu_device.js', import.meta.url), 'utf8');

test('surface resize measures the selected canvas after transfer', () => {
    const library = {};
    const game = { width: 320, height: 240 };
    const other = { width: 64, height: 48 };
    const heap = [];
    const context = {
        LibraryManager: { library }, autoAddDeps() {}, mergeInto: Object.assign,
        GodotConfig: { canvas: game }, Module: {},
        GodotRuntime: { parseString: value => value, setHeapValue: (index, value) => { heap[index] = value; } },
        findCanvasEventTarget: selector => ({ '#embedded-game': game, '#preview': other })[selector],
    };
    vm.runInNewContext(readFileSync(new URL('../../../platform/web/js/libs/library_godot_display.js', import.meta.url), 'utf8'), context);
    const size = library.godot_js_display_canvas_size_get;
    assert.equal(size('#embedded-game', 0, 1), 1);
    assert.deepEqual(heap, [320, 240]);
    context.Module.godotWebGPUSize = { width: 800, height: 600 };
    context.Module.godotWebGPUCanvasSelector = '[data-godot-webgpu="test"]';
    assert.equal(size(context.Module.godotWebGPUCanvasSelector, 0, 1), 1);
    assert.deepEqual(heap, [800, 600]);
    assert.equal(size('#embedded-game', 0, 1), 1);
    assert.deepEqual(heap, [800, 600]);
    assert.equal(size('#preview', 0, 1), 1);
    assert.deepEqual(heap, [64, 48]);
    assert.equal(size('#missing', 0, 1), 0);
    assert.deepEqual(heap, [64, 48]);
});

function harness(gpu, unavailableReason = '', { webgl = true, defaultDriver = '', prepareWorker } = {}) {
    const modules = [];
    const calls = [];
    const warnings = [];
    const infos = [];
    const contexts = [];
    class HTMLCanvasElement {}
    const canvas = new HTMLCanvasElement();
    const context = vm.createContext({
        Response, console: { ...console, warn: (...args) => warnings.push(args), info: (...args) => infos.push(args) },
        window: { fetch() {}, Response, isSecureContext: true, crossOriginIsolated: true, SharedArrayBuffer },
        navigator: { gpu, language: 'en-US' },
        HTMLCanvasElement, document: {
            getElementsByTagName: () => [canvas],
            createElement: () => ({ getContext(type) { contexts.push(type); return webgl ? {} : null; } }),
        },
        requestAnimationFrame() {},
        Preloader: class {
            preloadedFiles = [];
            loadPromise() { return Promise.resolve(new Response(new Uint8Array())); }
            preload() { return Promise.resolve(); }
            setProgressFunc() {}
        },
        Godot(moduleConfig) {
            modules.push(moduleConfig);
            return Promise.resolve({
                initFS: () => Promise.resolve(),
                initConfig() {},
                callMain(args) { calls.push([...args]); },
            });
        },
    });
    context.Godot.prepareWorkerWebGPU = prepareWorker;
    vm.runInContext(configSource.replace("renderingDriver: '',", `renderingDriver: '${defaultDriver}',`)
        + '\n' + featuresSource + '\n' + deviceSource + '\n'
        + engineSource.replaceAll('___GODOT_THREADS_ENABLED', String(!!prepareWorker))
            .replace('___GODOT_WEBGPU_UNAVAILABLE_REASON___', JSON.stringify(unavailableReason)), context);
    return { Engine: context.window.Engine, modules, calls, warnings, infos, contexts, window: context.window };
}

test('the threaded shell starts WebGPU on the rendering worker', async () => {
    let workerCanvas;
    const { Engine, modules, calls } = harness(undefined, '', { prepareWorker: (_, canvas) => { workerCanvas = canvas; } });
    await new Engine({ executable: 'godot', renderingDriver: 'webgpu' }).startGame();
    assert.ok(workerCanvas);
    assert.equal(modules[0].preinitializedWebGPUDevice, undefined);
    assert.equal(calls.length, 1);
});

test('worker device failure falls back before canvas transfer and propagates after transfer', async () => {
    for (const transferred of [false, true]) {
        const { Engine, calls } = harness(undefined, '', { prepareWorker: module => {
            if (transferred) module.godotWebGPUSize = { width: 128, height: 128 };
            throw Error('Worker failed');
        } });
        const start = new Engine({ executable: 'godot', renderingDriver: 'webgpu' }).startGame();
        if (transferred) {
            await assert.rejects(start, /Worker failed/);
            assert.equal(calls.length, 0);
        } else {
            await start;
            assert.deepEqual(calls[0].slice(0, 4), ['--rendering-driver', 'opengl3', '--rendering-method', 'gl_compatibility']);
        }
    }
});

test('WebGPU preflight does not create or require a WebGL context', () => {
    const { Engine, contexts } = harness({}, '', { webgl: false });
    assert.deepEqual([...Engine.getMissingFeatures({ threads: false, renderingDriver: 'webgpu' })], []);
    assert.deepEqual(contexts, []);
});

test('preflight uses the renderer default patched by browser-wasm publish and honors shell overrides', () => {
    const { Engine } = harness({}, '', { webgl: false, defaultDriver: 'webgpu' });
    assert.deepEqual([...Engine.getMissingFeatures({ threads: false })], []);
    assert.match(Engine.getMissingFeatures({ threads: false, renderingDriver: 'opengl3' })[0], /^WebGL2/);
});

test('Compatibility preflight still requires WebGL2 even when WebGPU is available', () => {
    const { Engine } = harness({}, '', { webgl: false });
    assert.match(Engine.getMissingFeatures({ threads: false })[0], /^WebGL2/);
});

test('WebGPU preflight permits WebGL fallback and reports when neither API is available', () => {
    const options = { threads: false, renderingDriver: 'webgpu' };
    assert.deepEqual([...harness(undefined).Engine.getMissingFeatures(options)], []);
    const { Engine } = harness(undefined, '', { webgl: false });
    assert.match(Engine.getMissingFeatures(options)[0], /^WebGPU or WebGL2/);
});

test('WebGPU preflight preserves fetch, HTTPS and threading requirements', () => {
    const { Engine, window } = harness({}, '', { webgl: false });
    delete window.fetch;
    window.isSecureContext = false;
    window.crossOriginIsolated = false;
    delete window.SharedArrayBuffer;
    const missing = [...Engine.getMissingFeatures({ renderingDriver: 'webgpu' })];
    assert.equal(missing.length, 4);
    for (const prefix of ['Fetch', 'Secure Context', 'Cross-Origin Isolation', 'SharedArrayBuffer']) {
        assert.ok(missing.some(feature => feature.startsWith(prefix)));
    }
});

test('existing WebGL init works without navigator.gpu', async () => {
    const { Engine, modules } = harness(undefined);
    await new Engine({ renderingDriver: 'opengl3' }).init('godot');
    assert.equal(modules.length, 1);
    assert.equal('preinitializedWebGPUDevice' in modules[0], false);
});

test('direct init waits for the WebGPU device and requests adapter storage limits', async () => {
    let requestCount = 0;
    const device = { lost: new Promise(() => {}), addEventListener() {} };
    const { Engine, modules, calls, warnings } = harness({
        async requestAdapter() {
            return {
                features: new Set(),
                limits: { maxStorageBuffersPerShaderStage: 16 },
                async requestDevice(descriptor) {
                    requestCount++;
                    assert.equal(modules.length, 0);
                    assert.equal(descriptor.requiredLimits.maxStorageBuffersPerShaderStage, 16);
                    return device;
                },
            };
        },
    });
    const engine = new Engine({ renderingDriver: 'webgpu' });
    await Promise.all([engine.init('godot'), engine.init('godot')]);
    assert.equal(requestCount, 1);
    assert.equal(modules.length, 1);
    assert.equal(modules[0].preinitializedWebGPUDevice, device);
    const args = ['--rendering-driver', 'webgpu', '--rendering-method', 'mobile'];
    await engine.start({ args });
    assert.deepEqual(calls, [args]);
    assert.equal(warnings.length, 0);
});

test('a caller-supplied GPUDevice is passed through without requesting another', async () => {
    const device = {};
    const { Engine, modules } = harness({ requestAdapter() { throw new Error('Unexpected device request'); } });
    await new Engine({ renderingDriver: 'webgpu', preinitializedWebGPUDevice: device }).init('godot');
    assert.equal(modules[0].preinitializedWebGPUDevice, device);
});

for (const [name, gpu] of [
    ['no navigator.gpu', undefined],
    ['no adapter', { async requestAdapter() { return null; } }],
    ['adapter request rejected', { async requestAdapter() { throw new Error('Adapter denied'); } }],
    ['device request rejected', { async requestAdapter() {
        return { features: new Set(), limits: {}, async requestDevice() { throw new Error('Device denied'); } };
    } }],
]) {
    test(name + ' starts WebGL Compatibility with the same runtime and pack', async () => {
        const { Engine, modules, calls, warnings } = harness(gpu);
        const args = ['--verbose', '--rendering-driver', 'webgpu', '--rendering-method', 'mobile'];
        await new Engine({ executable: 'godot', renderingDriver: 'webgpu', args }).startGame();
        assert.equal(modules.length, 1);
        assert.equal('preinitializedWebGPUDevice' in modules[0], false);
        assert.deepEqual(calls, [[
            '--rendering-driver', 'opengl3', '--rendering-method', 'gl_compatibility',
            '--main-pack', 'godot.pck', '--verbose',
        ]]);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0][0], /falling back to WebGL 2 Compatibility/);
        assert.deepEqual(args, ['--verbose', '--rendering-driver', 'webgpu', '--rendering-method', 'mobile']);
    });
}

for (const separator of ['--', '++']) {
    test('fallback survives separate init and start overrides, preserving user arguments after ' + separator, async () => {
        const { Engine, calls } = harness(undefined);
        const engine = new Engine({ renderingDriver: 'webgpu' });
        await engine.init('godot');
        await engine.start({ args: [
            '--main-pack', 'custom.pck', '--rendering-method', 'mobile', '--rendering-driver', 'webgpu',
            '--rendering-driver', 'webgpu', separator, '--rendering-driver', 'user-value', '--rendering-method', 'user-value',
        ] });
        assert.deepEqual(calls, [[
            '--rendering-driver', 'opengl3', '--rendering-method', 'gl_compatibility', '--main-pack', 'custom.pck',
            separator, '--rendering-driver', 'user-value', '--rendering-method', 'user-value',
        ]]);
    });

    test('user arguments after ' + separator + ' do not select WebGPU', async () => {
        const { Engine, calls, warnings } = harness(undefined);
        const args = [separator, '--rendering-driver', 'webgpu'];
        const engine = new Engine({ renderingDriver: 'opengl3', args });
        await engine.init('godot');
        await engine.start();
        assert.deepEqual(calls, [args]);
        assert.equal(warnings.length, 0);
    });
}

test('native startup errors remain visible instead of triggering device fallback', async () => {
    const { Engine, warnings } = harness(undefined);
    const engine = new Engine({ renderingDriver: 'webgpu', preinitializedWebGPUDevice: {} });
    await engine.init('godot');
    engine.rtenv.callMain = () => { throw new Error('Native startup failed'); };
    await assert.rejects(engine.start(), /Native startup failed/);
    assert.equal(warnings.length, 0);
});

test('the browser requests the same optional features and all limits as the native backend', async () => {
    let descriptor = null;
    const device = { lost: new Promise(() => {}), addEventListener() {} };
    const { Engine, infos } = harness({
        async requestAdapter() {
            return {
                features: new Set(['indirect-first-instance', 'timestamp-query', 'depth32float-stencil8']),
                info: { vendor: 'intel', architecture: 'xe', device: 'GPU test adapter' },
                limits: { maxComputeWorkgroupSizeX: 256 },
                async requestDevice(value) {
                    descriptor = value;
                    return device;
                },
            };
        },
    });
    await new Engine({ renderingDriver: 'webgpu' }).init('godot');
    assert.deepEqual([...descriptor.requiredFeatures].sort(), ['depth32float-stencil8', 'indirect-first-instance']);
    assert.equal(descriptor.requiredLimits.maxComputeWorkgroupSizeX, 256);
    assert.equal(device.godotAdapterInfo.device, 'GPU test adapter');
    assert.equal(infos[0][0], '[Godot] WebGPU adapter: intel / xe / GPU test adapter');
});

for (const reason of [
    'WebGPU is unavailable in double-precision runtimes.',
    'WebGPU is not included in this runtime.',
]) {
    test(reason + ' rejects before adapter requests or runtime creation', async () => {
        const { Engine, modules } = harness({ requestAdapter() { throw new Error('Unexpected adapter request'); } }, reason);
        await assert.rejects(Engine.requestWebGPUDevice(), { message: reason });
        await assert.rejects(new Engine({ renderingDriver: 'webgpu', preinitializedWebGPUDevice: {} }).init('godot'), { message: reason });
        await assert.rejects(new Engine({ args: ['--rendering-driver', 'webgpu'] }).init('godot'), { message: reason });
        assert.equal(modules.length, 0);
        await new Engine({ renderingDriver: 'opengl3' }).init('godot');
        assert.equal(modules.length, 1);
    });
}

test('an argv-only WebGPU request initializes the device', async () => {
    const device = { lost: new Promise(() => {}), addEventListener() {} };
    const { Engine, modules } = harness({ async requestAdapter() {
        return { features: new Set(), limits: {}, async requestDevice() { return device; } };
    } });
    await new Engine({ args: ['--rendering-driver', 'opengl3', '--rendering-driver', 'webgpu'] }).init('godot');
    assert.equal(modules[0].preinitializedWebGPUDevice, device);
});

test('a WebGPU override after a separate init is rejected instead of starting without a device', async () => {
    for (const override of [{ args: ['--rendering-driver', 'webgpu'] }, { renderingDriver: 'webgpu' }]) {
        const { Engine, calls } = harness({ requestAdapter() { throw new Error('Unexpected adapter request'); } });
        const engine = new Engine({ renderingDriver: 'opengl3' });
        await engine.init('godot');
        await assert.rejects(engine.start(override), /before init/);
        assert.equal(calls.length, 0);
    }
});
