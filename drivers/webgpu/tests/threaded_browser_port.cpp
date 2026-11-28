#include <emscripten/emscripten.h>
#include <emscripten/threading.h>
#include <pthread.h>
#include <unistd.h>
#include <webgpu/webgpu.h>

#include <atomic>
#include <cassert>

static std::atomic_bool browser_polled = false;

extern "C" EMSCRIPTEN_KEEPALIVE void poll_on_browser(WGPUInstance instance) {
	wgpuInstanceProcessEvents(instance);
	browser_polled = true;
}

static void *churn_bind_groups(void *arg) {
	auto device = static_cast<WGPUDevice>(arg);
	for (int i = 0; i < 256; i++) {
		WGPUBindGroupLayoutDescriptor layout_desc = {};
		WGPUBindGroupLayout layout = wgpuDeviceCreateBindGroupLayout(device, &layout_desc);
		WGPUBindGroupDescriptor desc = {};
		desc.layout = layout;
		WGPUBindGroup group = wgpuDeviceCreateBindGroup(device, &desc);
		assert(group);
		wgpuBindGroupLayoutRelease(layout);
		wgpuBindGroupRelease(group);
	}
	return nullptr;
}

static void *test_device(void *) {
	assert(!emscripten_is_main_browser_thread());
	WGPUInstance instance = wgpuCreateInstance(nullptr);
	auto device = (WGPUDevice)MAIN_THREAD_EM_ASM_PTR({
		return WebGPU.importJsDevice(Module['preinitializedWebGPUDevice'], $0);
	}, instance);
	WGPUQueue queue = wgpuDeviceGetQueue(device);
	WGPUBufferDescriptor desc = {};
	desc.size = sizeof(uint32_t);
	desc.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
	WGPUBuffer buffer = wgpuDeviceCreateBuffer(device, &desc);
	assert(wgpuBufferGetSize(buffer) == desc.size && wgpuBufferGetUsage(buffer) == desc.usage);
	const uint32_t value = 0x12345678;
	wgpuQueueWriteBuffer(queue, buffer, 0, &value, sizeof(value));

	bool mapped = false;
	WGPUBufferMapCallbackInfo cb = {};
	cb.mode = WGPUCallbackMode_AllowProcessEvents;
	cb.userdata1 = &mapped;
	cb.callback = [](WGPUMapAsyncStatus status, WGPUStringView, void *result, void *) {
		assert(status == WGPUMapAsyncStatus_Success && !emscripten_is_main_browser_thread());
		*static_cast<bool *>(result) = true;
	};
	wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, desc.size, cb);
	MAIN_THREAD_EM_ASM({
		Module['preinitializedWebGPUDevice'].queue.onSubmittedWorkDone().then(() => Module['_poll_on_browser']($0));
	}, instance);
	const double deadline = emscripten_get_now() + 10000;
	while (!browser_polled && emscripten_get_now() < deadline) {
		usleep(1000);
	}
	assert(browser_polled && !mapped);
	wgpuInstanceProcessEvents(instance);
	assert(mapped && *static_cast<const uint32_t *>(wgpuBufferGetConstMappedRange(buffer, 0, desc.size)) == value);
	wgpuBufferUnmap(buffer);
	wgpuBufferRelease(buffer);
	pthread_t churn_worker;
	const int created = pthread_create(&churn_worker, nullptr, churn_bind_groups, device);
	assert(created == 0);
	churn_bind_groups(device);
	const int joined = pthread_join(churn_worker, nullptr);
	assert(joined == 0);
	wgpuQueueRelease(queue);
	wgpuDeviceRelease(device);
	wgpuInstanceRelease(instance);
	MAIN_THREAD_EM_ASM({ document.body.dataset.result = 'passed'; console.log('THREADED_WEBGPU_PORT_PASSED'); });
	return nullptr;
}

extern "C" EMSCRIPTEN_KEEPALIVE void start_probe() {
	pthread_t worker;
	const int err = pthread_create(&worker, nullptr, test_device, nullptr);
	assert(err == 0);
	pthread_detach(worker);
}

int main() {
	EM_ASM({
		(async () => {
			const adapter = await navigator.gpu?.requestAdapter();
			if (!adapter) {
				throw new Error("WebGPU adapter unavailable.");
			}
			const device = await adapter.requestDevice();
			Module['preinitializedWebGPUDevice'] = device;
			Module['_start_probe']();
		})().catch(error => {
			document.body.dataset.result = 'failed';
			console.error('THREADED_WEBGPU_PORT_FAILED', error);
		});
	});
}
