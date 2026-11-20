/**************************************************************************/
/*  test_button.cpp                                                       */
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

TEST_FORCE_LINK(test_button)

#include "scene/gui/button.h"
#include "scene/main/scene_tree.h"
#include "scene/main/window.h"
#include "tests/display_server_mock.h"

namespace TestButton {

TEST_CASE("[SceneTree][Button] Local touch and drag respect the visible part of a scaled button") {
	Button *button = memnew(Button);
	SceneTree::get_singleton()->get_root()->add_child(button);
	const Vector2 viewport_size = button->get_viewport_rect().size;
	button->set_size(viewport_size);
	button->set_position(viewport_size * 0.25);
	button->set_scale(Vector2(2, 2));
	button->set_toggle_mode(true);
	const Vector2 inside = viewport_size * 0.25;
	const Vector2 clipped = viewport_size * 0.5;
	Vector2 start = inside;
	Vector2 end = inside;
	bool expect_pressed = true;
	SUBCASE("Inside the viewport") {}
	SUBCASE("Press on the clipped part of the button") {
		start = clipped;
		end = clipped;
		expect_pressed = false;
	}
	SUBCASE("Drag from the visible part to the clipped part") {
		end = clipped;
		expect_pressed = false;
	}
	Ref<InputEventScreenTouch> touch;
	touch.instantiate();
	touch->set_position(start);
	touch->set_pressed(true);
	static_cast<Control *>(button)->gui_input(touch);
	if (end != start) {
		Ref<InputEventScreenDrag> drag;
		drag.instantiate();
		drag->set_position(end);
		static_cast<Control *>(button)->gui_input(drag);
	}
	touch->set_position(end);
	touch->set_pressed(false);
	static_cast<Control *>(button)->gui_input(touch);
	CHECK(button->is_pressed() == expect_pressed);
	memdelete(button);
}

TEST_CASE("[SceneTree][Button] is_hovered()") {
	// Create new button instance.
	Button *button = memnew(Button);
	CHECK(button != nullptr);
	Window *root = SceneTree::get_singleton()->get_root();
	root->add_child(button);

	// Set up button's size and position.
	button->set_size(Size2i(50, 50));
	button->set_position(Size2i(10, 10));

	// Button should initially be not hovered.
	CHECK(button->is_hovered() == false);

	// Simulate mouse entering the button.
	SEND_GUI_MOUSE_MOTION_EVENT(Point2i(25, 25), MouseButtonMask::NONE, Key::NONE);
	CHECK(button->is_hovered() == true);

	// Simulate mouse exiting the button.
	SEND_GUI_MOUSE_MOTION_EVENT(Point2i(150, 150), MouseButtonMask::NONE, Key::NONE);
	CHECK(button->is_hovered() == false);

	memdelete(button);
}

} // namespace TestButton
