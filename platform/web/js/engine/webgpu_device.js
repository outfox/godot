function godotRequestWebGPUDevice(adapterOptions, deviceDescriptor) {
	if (typeof navigator === 'undefined' || !navigator.gpu) {
		return Promise.reject(new Error(
			'WebGPU is not supported in this browser.\n'
			+ 'Try using a recent version of Chrome, Edge, or Firefox.'
		));
	}
	return navigator.gpu.requestAdapter(adapterOptions || {
		powerPreference: 'high-performance',
	}).then(function (adapter) {
		if (!adapter) {
			return Promise.reject(new Error(
				'WebGPU adapter not found. Your GPU may not support WebGPU.'
			));
		}
		const desc = deviceDescriptor || {
			requiredFeatures: [],
		};
		// Keep in sync with the native list in rendering_context_driver_webgpu_native.cpp.
		// Without the compression features, compressed textures are decompressed to RGBA8 on the CPU.
		const optionalFeatures = [
			'depth32float-stencil8',
			'float32-filterable',
			'float32-blendable',
			'texture-formats-tier1',
			'texture-formats-tier2',
			'rg11b10ufloat-renderable',
			'clip-distances',
			'dual-source-blending',
			'indirect-first-instance',
			'texture-compression-bc',
			'texture-compression-etc2',
			'texture-compression-astc',
		];
		desc.requiredFeatures = (desc.requiredFeatures || []).concat(optionalFeatures.filter((feature) => adapter.features.has(feature)));
		// Like the native backend, request every limit the adapter supports.
		desc.requiredLimits ||= {};
		for (const key in adapter.limits) {
			if (adapter.limits[key] !== undefined) {
				desc.requiredLimits[key] = adapter.limits[key];
			}
		}
		return adapter.requestDevice(desc).then(function (device) {
			device['godotAdapterInfo'] = adapter.info || {};
			// Monitor device loss (non-blocking — just log).
			device.lost.then(function (info) {
				const reason = info.reason || 'unknown';
				const msg = info.message || '';
				console.error(`[Godot] WebGPU device lost (reason: ${reason}): ${msg}`); // eslint-disable-line no-console
			});
			device.addEventListener('uncapturederror', function (event) {
				// Include the full error message — `event.error` alone only
				// serializes to the constructor name ("GPUValidationError"),
				// hiding the detail. `.message` contains the Dawn error text.
				const err = event.error;
				const kind = (err && err.constructor && err.constructor.name) || 'UnknownError';
				const msg = (err && err.message) ? err.message : String(err);
				console.error(`[Godot] WebGPU uncaptured error: ${kind}: ${msg}`); // eslint-disable-line no-console
			});
			return device;
		});
	});
}
