#pragma once

#if defined(WEB_ENABLED) && defined(THREADS_ENABLED)
#include <emscripten/threading.h>
#include <pthread.h>

extern "C" pthread_t emwgpuGetDeviceThread();
extern "C" void emwgpuOnDeviceThread(void (*run)(void *), void *data);

template <typename F>
inline void webgpu_on_device_thread(F p_run) {
	emwgpuOnDeviceThread([](void *p_data) { (*static_cast<F *>(p_data))(); }, &p_run);
}
#endif
