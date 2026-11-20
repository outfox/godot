/**************************************************************************/
/*  test_virtual_joystick.cpp                                             */
/**************************************************************************/
/*                         This file is part of:                          */
/*                             GODOT ENGINE                               */
/*                        https://godotengine.org                         */
/**************************************************************************/
/* Copyright (c) 2014-present Godot Engine contributors (see AUTHORS.md). */
/* Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.                  */
/*                                                                        */
/* Permission is hereby granted, free of charge, to any person obtaining  */
/* a copy of this software and associated documentation files (the        */
/* "Software"), to deal in the Software without restriction, including    */
/* without limitation the rights to use, copy, modify, merge, publish,    */
/* distribute, sublicense, and/or sell copies of the Software, and to     */
/* permit persons to whom the Software is furnished to do so, subject to  */
/* the following conditions:                                              */
/*                                                                        */
/* The above copyright notice and this permission notice shall be         */
/* included in all copies or substantial portions of the Software.        */
/*                                                                        */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,        */
/* EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF     */
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. */
/* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY   */
/* CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,   */
/* TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE      */
/* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.                 */
/**************************************************************************/

#include "tests/test_macros.h"

TEST_FORCE_LINK(test_virtual_joystick)

#ifndef ADVANCED_GUI_DISABLED

#include "scene/gui/virtual_joystick.h"
#include "scene/main/scene_tree.h"
#include "scene/main/window.h"
#include "tests/signal_watcher.h"

namespace TestVirtualJoystick {

TEST_CASE("[SceneTree][VirtualJoystick] Only the active pointer can move or release a gesture") {
	VirtualJoystick *joystick = memnew(VirtualJoystick);
	SceneTree::get_singleton()->get_root()->add_child(joystick);
	joystick->set_size(Size2(200, 200));
	Control *control = joystick;
	SIGNAL_WATCH(joystick, "tapped");
	SIGNAL_WATCH(joystick, "released");
	Array no_args;
	no_args.push_back(Array());
	Array zero_vector = { { Vector2() } };

	Ref<InputEventMouseButton> mouse;
	mouse.instantiate();
	mouse->set_button_index(MouseButton::LEFT);
	mouse->set_position(Vector2(5, 5));
	mouse->set_pressed(true);
	control->gui_input(mouse);
	mouse->set_pressed(false);
	control->gui_input(mouse);
	SIGNAL_CHECK_FALSE("released");
	SIGNAL_CHECK_FALSE("tapped");

	Ref<InputEventScreenTouch> touch;
	touch.instantiate();
	touch->set_position(Vector2(100, 100));
	touch->set_pressed(true);
	control->gui_input(touch);
	Ref<InputEventMouseMotion> motion;
	motion.instantiate();
	motion->set_position(Vector2(140, 100));
	control->gui_input(motion);
	control->gui_input(mouse);
	SIGNAL_CHECK_FALSE("released");
	SIGNAL_CHECK_FALSE("tapped");
	touch->set_pressed(false);
	control->gui_input(touch);
	SIGNAL_CHECK("released", zero_vector);
	SIGNAL_CHECK("tapped", no_args);

	mouse->set_position(Vector2(100, 100));
	mouse->set_pressed(true);
	control->gui_input(mouse);
	mouse->set_pressed(false);
	control->gui_input(mouse);
	SIGNAL_CHECK("released", zero_vector);
	SIGNAL_CHECK("tapped", no_args);
	memdelete(joystick);
}

} // namespace TestVirtualJoystick

#endif // ADVANCED_GUI_DISABLED
