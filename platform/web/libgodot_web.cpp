// SPDX-License-Identifier: MIT
// 2dog: this file is part of https://2dog.dev

#include "display_server_web.h"
#include "godot_js.h"
#include "os_web.h"

#include "core/core_globals.h"
#include "core/profiling/profiling.h"

#include "core/config/engine.h"
#include "core/extension/godot_instance.h"
#include "core/extension/libgodot.h"
#include "core/io/resource_loader.h"
#include "core/os/os.h"
#include "core/string/print_string.h"
#include "core/variant/variant.h"
#include "main/main.h"
#include "servers/rendering/rendering_device.h"
#include "servers/rendering/rendering_server_globals.h"

#include <emscripten/emscripten.h>

#include <cstdlib>

static OS_Web *os = nullptr;

static GodotInstance *instance = nullptr;
static int reported_frames = 0;
static bool waiting_for_pipelines = false;
static uint64_t last_frame_usec = 0;
static uint32_t gpu_queue_skips = 0;
#ifndef PROXY_TO_PTHREAD_ENABLED
uint64_t target_ticks = 0;
#endif

static void print_web_header() {
	char *emscripten_version_char = godot_js_emscripten_get_version();
	String emscripten_version = vformat("Emscripten %s", emscripten_version_char);
	// 2dog: this value is allocated outside Godot's memory API.
	free(emscripten_version_char);

	String thread_support = OS::get_singleton()->has_feature("threads")
			? "multi-threaded"
			: "single-threaded";
	String extensions_support = OS::get_singleton()->has_feature("web_extensions")
			? "GDExtension support"
			: "no GDExtension support";

	Vector<String> build_configuration = { emscripten_version, thread_support, extensions_support };
	print_line(vformat("Build configuration: %s.", String(", ").join(build_configuration)));
}

GDExtensionObjectPtr libgodot_create_godot_instance(int p_argc, char *p_argv[], GDExtensionInitializationFunction p_init_func) {
	ERR_FAIL_COND_V_MSG(instance != nullptr, nullptr, "Only one Godot instance may be created at a time.");

	godot_init_profiler();

	// 2dog: retain process metadata across restarts; each engine lifetime needs a fresh canvas.
	CoreGlobals::global_init_func_libgodot = p_init_func;
	CoreGlobals::engine_reinit_enabled = true;
	CoreGlobals::libgodot_host_instance = true;
	reported_frames = 0;
	waiting_for_pipelines = false;
	last_frame_usec = 0;
	gpu_queue_skips = 0;
#ifndef PROXY_TO_PTHREAD_ENABLED
	target_ticks = 0;
#endif

	os = new OS_Web();

	Error err = Main::setup(p_argv[0], p_argc - 1, &p_argv[1], false);
	if (err != OK) {
		delete os;
		os = nullptr;
		godot_cleanup_profiler();
		return nullptr;
	}

	instance = memnew(GodotInstance);
	if (!instance->initialize()) {
		memdelete(instance);
		instance = nullptr;
		Main::cleanup();
		delete os;
		os = nullptr;
		godot_cleanup_profiler();
		return nullptr;
	}

	print_web_header();

	// 2dog: embedded web hosts may provide resources outside the project pack.
	ResourceLoader::set_abort_on_missing_resources(false);

	return static_cast<GDExtensionObjectPtr>(instance);
}

void libgodot_destroy_godot_instance(GDExtensionObjectPtr p_godot_instance) {
	GodotInstance *godot_instance = static_cast<GodotInstance *>(p_godot_instance);
	if (instance == godot_instance) {
		godot_instance->stop();
		memdelete(godot_instance);
		instance = nullptr;
		Main::cleanup();
		delete os;
		os = nullptr;
		CoreGlobals::global_init_func_libgodot = nullptr;
		CoreGlobals::libgodot_host_instance = false;
		godot_cleanup_profiler();
#ifndef PROXY_TO_PTHREAD_ENABLED
		target_ticks = 0;
#endif
	}
}

// 2dog: entry point used by the managed browser main loop.
extern "C" LIBGODOT_API GDExtensionBool libgodot_web_iteration() {
	ERR_FAIL_NULL_V(instance, true);
	ERR_FAIL_NULL_V(os, true);
	ERR_FAIL_NULL_V(DisplayServerWeb::get_singleton(), true);
#ifndef PROXY_TO_PTHREAD_ENABLED
	uint64_t current_ticks = os->get_ticks_usec();
#endif

	bool force_draw = DisplayServerWeb::get_singleton()->check_size_force_redraw();
	if (force_draw) {
		Main::force_redraw();
#ifndef PROXY_TO_PTHREAD_ENABLED
	} else if (current_ticks < target_ticks) {
		return false;
#endif
	}

#ifndef PROXY_TO_PTHREAD_ENABLED
	int max_fps = Engine::get_singleton()->get_max_fps();
	if (max_fps > 0) {
		if (current_ticks - target_ticks > 1000000) {
			// 2dog: reset accumulated delay after focus loss.
			target_ticks = current_ticks;
		}
		target_ticks += (uint64_t)(1000000 / max_fps);
	}
#endif

#ifdef RD_ENABLED // 2dog: builds without WebGPU (double precision) have no RenderingDevice to link against.
	// 2dog: avoid re-rendering and flooding the GPU queue while async pipelines finish compiling.
	if (waiting_for_pipelines) {
		RenderingDevice *rd = RenderingDevice::get_singleton();
		if (rd && rd->has_pending_pipelines()) {
			return false;
		}
		waiting_for_pipelines = false;
	}

	// 2dog: cap in-flight GPU frames so input and simulation stay in sync with what is on screen.
	if (RenderingDevice *rd = RenderingDevice::get_singleton(); rd && rd->is_gpu_queue_full()) {
		gpu_queue_skips++;
		return false;
	}
#endif

	const uint64_t iter_start = is_print_verbose_enabled() ? os->get_ticks_usec() : 0;
	const uint64_t phys_before = is_print_verbose_enabled() ? Engine::get_singleton()->get_physics_frames() : 0;
	const uint64_t skipped_draws = RSG::pipeline_skipped_draws;
	const bool exit = os->main_loop_iterate();

	if (is_print_verbose_enabled()) {
		const uint64_t iter_end = os->get_ticks_usec();
		if (reported_frames >= 8 && last_frame_usec > 0) {
			const uint64_t wall_usec = iter_end - last_frame_usec;
			const uint64_t cpu_usec = iter_end - iter_start;
			const uint64_t phys_steps = Engine::get_singleton()->get_physics_frames() - phys_before;
			const uint64_t pipe_skips = RSG::pipeline_skipped_draws - skipped_draws;
			if (wall_usec >= 40000 || cpu_usec >= 25000 || pipe_skips > 0) {
				const Main::FrameTimings &t = Main::last_frame_timings;
				print_line(vformat("WebGPU: slow frame #%d: wall=%.1fms cpu=%.1fms (phys=%d: script=%.1fms jolt=%.1fms, proc=%.1fms, render=%.1fms, tail=%.1fms) gpu_waits=%d pipe_skips=%d",
						(int)Engine::get_singleton()->get_process_frames(), wall_usec / 1000.0, cpu_usec / 1000.0,
						(int)phys_steps, t.phys_script_usec / 1000.0, t.phys_jolt_usec / 1000.0,
						t.process_usec / 1000.0, t.render_usec / 1000.0, t.tail_usec / 1000.0,
						(int)gpu_queue_skips, (int)pipe_skips));
			}
		}
		last_frame_usec = iter_end;
		gpu_queue_skips = 0;
	}

#ifdef RD_ENABLED
	// Only pause the loop during boot under the splash screen; mid-game async compiles run in the background.
	if (reported_frames < 8 && skipped_draws != RSG::pipeline_skipped_draws) {
		RenderingDevice *rd = RenderingDevice::get_singleton();
		waiting_for_pipelines = rd && rd->has_pending_pipelines();
	}
#endif

	// 2dog: the page's loading screen stays over the first complete frames, which still stall on shader compilation.
	if (reported_frames < 8 && skipped_draws == RSG::pipeline_skipped_draws) {
		MAIN_THREAD_ASYNC_EM_ASM({ dispatchEvent(new CustomEvent('2dog:frame', { detail : $0 })); }, ++reported_frames);
	}
	return exit;
}
