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

TEST_CASE("[SceneTree][Button] Mouse and touch respect the visible part of a scaled button") {
	Button *button = memnew(Button);
	SceneTree::get_singleton()->get_root()->add_child(button);
	const Vector2 viewport_size = button->get_viewport_rect().size;
	button->set_size(viewport_size);
	button->set_position(viewport_size * 0.25);
	button->set_scale(Vector2(2, 2));
	button->set_toggle_mode(true);
	const Vector2 inside = viewport_size * 0.25;
	const Vector2 clipped = viewport_size * 0.5;
	SEND_GUI_MOUSE_MOTION_EVENT(Point2i(button->get_global_transform_with_canvas().xform(inside)), MouseButtonMask::NONE, Key::NONE);
	CHECK(button->is_hovered());

	Vector2 start = inside;
	Vector2 end = inside;
	bool drag_outside = false;
	SUBCASE("Click inside") {}
	SUBCASE("Press while the mouse hovers over another part of the button") {
		start = clipped;
	}
	SUBCASE("Release outside without an intervening motion") {
		end = clipped;
	}
	SUBCASE("Drag and release outside") {
		drag_outside = true;
		end = clipped;
	}
	SUBCASE("Release back inside after dragging outside") {
		drag_outside = true;
	}

	for (bool mouse : { false, true }) {
		for (BaseButton::ActionMode mode : { BaseButton::ACTION_MODE_BUTTON_PRESS, BaseButton::ACTION_MODE_BUTTON_RELEASE }) {
			CAPTURE(mouse);
			CAPTURE(mode);
			button->set_action_mode(mode);
			button->set_pressed(false);
			Control *control = button;
			auto send_button = [&](const Vector2 &p_point, bool p_pressed) {
				if (mouse) {
					Ref<InputEventMouseButton> click;
					click.instantiate();
					click->set_button_index(MouseButton::LEFT);
					click->set_position(p_point);
					click->set_pressed(p_pressed);
					control->gui_input(click);
				} else {
					Ref<InputEventScreenTouch> touch;
					touch.instantiate();
					touch->set_position(p_point);
					touch->set_pressed(p_pressed);
					control->gui_input(touch);
				}
			};

			send_button(start, true);
			const bool pressed_on_down = start == inside && mode == BaseButton::ACTION_MODE_BUTTON_PRESS;
			CHECK(button->is_pressed() == pressed_on_down);
			if (drag_outside) {
				if (mouse) {
					Ref<InputEventMouseMotion> motion;
					motion.instantiate();
					motion->set_position(clipped);
					control->gui_input(motion);
				} else {
					Ref<InputEventScreenDrag> drag;
					drag.instantiate();
					drag->set_position(clipped);
					control->gui_input(drag);
				}
				if (mode == BaseButton::ACTION_MODE_BUTTON_RELEASE) {
					CHECK(button->get_draw_mode() == BaseButton::DRAW_NORMAL);
				}
			}
			send_button(end, false);
			CHECK(button->is_pressed() == (pressed_on_down || (start == inside && end == inside)));
		}
	}
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
