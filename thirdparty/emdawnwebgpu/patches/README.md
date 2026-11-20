# Emscripten 3.x compatibility

The pinned Dawn release is downloaded by `drivers/webgpu/dependencies.py`.
Preparation derives `library_webgpu_legacy.js` from the patched JavaScript by
changing the `$stackSave` and `$stackRestore` dependency names to their 3.x
spellings. `0001-select-legacy-stack-dependencies.patch` selects this copy for
Emscripten 3.x. Newer Emscripten versions use the upstream stack helper names.

`0002-proxy-threaded-webgpu.patch` keeps the JS object table on the browser
main thread in pthread builds. The worker receives Wasm handles and numeric results.

`0003-thread-affine-event-delivery.patch` delivers polled callbacks on the
requesting pthread and releases the event mutex before running shutdown callbacks.

`0004-unmap-handles-before-deallocation.patch` removes the JS handle after
destruction and before the allocator can hand its address to another thread.

`0005-route-to-device-owner.patch` routes calls to the pthread that owns the
device and resolves its transferred canvas. Calls on that pthread are direct.
The .NET host drains the device queue while it waits for other threads.
