// SPDX-License-Identifier: MIT
// 2dog: this file is part of https://2dog.dev

// 2dog: escape URL delimiters such as # in .NET resource names before fetch interprets them.
const encodeDotnetResourceUrl = (defaultUri, name) => {
	const uriName = encodeURI(name);
	const matchedName = defaultUri.includes(name) ? name : uriName;
	const nameIndex = defaultUri.lastIndexOf(matchedName);
	if (nameIndex < 0) {
		return defaultUri;
	}
	const encodedName = name.split('/').map(encodeURIComponent).join('/');
	return `${defaultUri.slice(0, nameIndex)}${encodedName}${defaultUri.slice(nameIndex + matchedName.length)}`;
};

// 2dog: wrap the .NET runtime module as Godot's Emscripten module.
const Godot = async (moduleConfig) => { // eslint-disable-line no-unused-vars
	// 2dog: let .NET configure wasm instantiation for JS imports, exports, and threads.
	delete moduleConfig['instantiateWasm'];

	// Depends on "dotnet.native.wasm" being in place of "godot.wasm".
	const loadPath = moduleConfig['locateFile']('dotnet.native.wasm');
	// Get preloaded wasm.
	let preloadedWasm = moduleConfig['getPreloadedWasm']();

	const perfMark = (name) => {
		if (typeof performance !== 'undefined') {
			performance.mark(name);
		}
	};

	// 2dog: inflate precompressed binary resources and report _framework download progress.
	// 2dog: leave script resources as URLs for the runtime's import().
	const gzSuffix = moduleConfig['godotPrecompressedSuffix'] || '';
	const onDotnetBytes = moduleConfig['godotOnDotnetProgress'];
	let dotnetLoaded = 0;
	const countedResponse = (response) => {
		if (!onDotnetBytes || !response.body) {
			return response;
		}
		return new Response(response.body.pipeThrough(new TransformStream({
			transform(chunk, controller) {
				dotnetLoaded += chunk.byteLength;
				onDotnetBytes(dotnetLoaded);
				controller.enqueue(chunk);
			},
		})), { 'headers': response.headers });
	};
	const loadBinaryResource = (url) => {
		const plain = () => fetch(url).then(countedResponse);
		if (!gzSuffix || typeof DecompressionStream === 'undefined') {
			return plain();
		}
		return fetch(url + gzSuffix).then((response) => {
			if (!response.ok || !response.body) {
				return plain();
			}
			return countedResponse(new Response(response.body.pipeThrough(new DecompressionStream('gzip'))));
		}, plain);
	};

	// dynamic module import.
	perfMark('2dog:dotnet-import');
	const dotnetjs = await import('./_framework/dotnet.js');
	const dotnet = dotnetjs.dotnet;

	dotnet
		// Pass emscripten config.
		.withModuleConfig(moduleConfig)
		.withConfig({
			// 2dog: let .NET configure the initial thread-pool size.
			pthreadPoolInitialSize: moduleConfig['emscriptenPoolSize'] || 8,
			// 2dog: enable synchronous JS import and export calls with threads.
			jsThreadBlockingMode: 'ThrowWhenBlockingWait',
		})
		.withResourceLoader((_type, name, _defaultUri, _integrity, _behavior) => {
			if (name === 'dotnet.native.wasm') {
				if (preloadedWasm) {
					// 2dog: pass the preloaded wasm response to the Godot loader.
					const promise = Promise.resolve(preloadedWasm);
					preloadedWasm = null;
					return promise;
				}
				// 2dog: fall back to the resolved wasm path.
				return loadPath;
			}
			const resourceUrl = encodeDotnetResourceUrl(_defaultUri, name);
			if ((gzSuffix || onDotnetBytes) && /\.(wasm|dat|pdb)$/.test(name)) {
				return loadBinaryResource(resourceUrl);
			}
			// 2dog: preserve default resource URLs unless their names need escaping.
			return resourceUrl === _defaultUri ? null : resourceUrl;
		});

	await dotnet.download();
	perfMark('2dog:dotnet-downloaded');
	const { setModuleImports, getAssemblyExports, getConfig, runMain, Module } = await dotnet.create();
	perfMark('2dog:dotnet-created');

	const dotnetConfig = getConfig();

	if (moduleConfig['godotSharpImports']) {
		const moduleImports = moduleConfig['godotSharpImports'];
		for (const moduleName of Object.keys(moduleImports)) {
			setModuleImports(moduleName, moduleImports[moduleName]);
		}
	}
	Module['getGodotSharpExports'] = getAssemblyExports.bind(null, dotnetConfig.mainAssemblyName);

	// 2dog: provide callMain for Godot when Emscripten omits it.
	Module.callMain = (args) => runMain(dotnetConfig.mainAssemblyName, args);
	return Module;
};

Godot['prepareWorkerWebGPU'] = async (module, canvas) => {
	const worker = Object.values(module['PThread']['pthreads']).find((thread) => thread['info']?.['isDeputy']);
	if (!worker || !canvas.transferControlToOffscreen) {
		throw new Error('The rendering worker or OffscreenCanvas is unavailable.');
	}
	const { port1, port2 } = new MessageChannel();
	const reply = () => new Promise((resolve, reject) => {
		port1.onmessage = ({ data }) => data === true ? resolve() : reject(new Error(data));
		port1.onmessageerror = () => reject(new Error('The WebGPU worker reply could not be read.'));
	});
	let workerFailed;
	const failed = new Promise((resolve, reject) => { workerFailed = () => reject(new Error('The WebGPU worker failed.')); });
	worker.addEventListener('error', workerFailed);
	try {
		const ready = reply();
		worker.postMessage({ 'godotWebGPU': port2 }, [port2]);
		await Promise.race([ready, failed]);
		const offscreen = canvas.transferControlToOffscreen();
		module['godotWebGPUSize'] = { width: offscreen.width, height: offscreen.height };
		const attached = reply();
		port1.postMessage(offscreen, [offscreen]);
		await Promise.race([attached, failed]);
	} catch (err) {
		port1.postMessage(null);
		throw err;
	} finally {
		worker.removeEventListener('error', workerFailed);
		port1.close();
	}
};
