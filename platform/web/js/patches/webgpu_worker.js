if (typeof DedicatedWorkerGlobalScope !== 'undefined' && self instanceof DedicatedWorkerGlobalScope) {
	self.addEventListener('message', async function (event) {
		const port = event.data?.['godotWebGPU'];
		if (!port) {
			return;
		}
		event.stopImmediatePropagation();
		try {
			const device = await godotRequestWebGPUDevice();
			port.onmessage = ({ data: canvas }) => {
				try {
					if (canvas) {
						Module['_emwgpuSetDeviceThread']();
						Module['preinitializedWebGPUDevice'] = device;
						Module['godotWebGPUCanvas'] = canvas;
						Module['godotWebGPUCanvasSelector'] = event.data['canvasSelector'];
						port.postMessage(true);
					} else {
						device.destroy();
					}
				} catch (err) {
					device.destroy();
					port.postMessage(String(err));
				}
				port.close();
			};
			port.postMessage(true);
		} catch (err) {
			port.postMessage(String(err));
			port.close();
		}
	}, true);
}
