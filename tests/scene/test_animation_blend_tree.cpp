/**************************************************************************/
/*  test_animation_blend_tree.cpp                                         */
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

TEST_FORCE_LINK(test_animation_blend_tree)

#include "scene/2d/node_2d.h"
#include "scene/animation/animation_blend_tree.h"
#include "scene/main/scene_tree.h"
#include "scene/main/window.h"

namespace TestAnimationBlendTree {

class RepeatedInput : public AnimationNode {
protected:
	NodeTimeInfo _process(ProcessState &p_state, AnimationNodeInstance &p_instance, const AnimationMixer::PlaybackInfo &p_info, bool p_test_only) override {
		AnimationMixer::PlaybackInfo info = p_info;
		info.weight = 1.0;
		const NodeTimeInfo result = blend_input(p_state, p_instance, 0, info, FILTER_IGNORE, true, p_test_only);
		info.weight = 0.0;
		blend_input(p_state, p_instance, 0, info, FILTER_IGNORE, true, p_test_only);
		return result;
	}

public:
	RepeatedInput() { add_input("clip"); }
};

TEST_CASE("[SceneTree][AnimationBlendTree] A queued blend retains its track weights when the input is revisited") {
	Node2D *target = memnew(Node2D);
	SceneTree::get_singleton()->get_root()->add_child(target);
	AnimationTree *tree = memnew(AnimationTree);
	target->add_child(tree);

	const Ref<Animation> clip = memnew(Animation);
	const int track = clip->add_track(Animation::TYPE_VALUE);
	clip->track_set_path(track, NodePath(".:position"));
	clip->track_insert_key(track, 0.0, Vector2(24, 0));
	const Ref<AnimationLibrary> library = memnew(AnimationLibrary);
	library->add_animation("clip", clip);
	tree->add_animation_library("", library);

	const Ref<AnimationNodeAnimation> source = memnew(AnimationNodeAnimation);
	source->set_animation("clip");
	const Ref<AnimationNodeBlendTree> blend = memnew(AnimationNodeBlendTree);
	blend->add_node("clip", source);
	blend->add_node("twice", Ref<AnimationNode>(memnew(RepeatedInput)));
	blend->connect_node("twice", 0, "clip");
	blend->connect_node("output", 0, "twice");
	tree->set_root_animation_node(blend);
	tree->advance(0.016);
	CHECK(target->get_position() == Vector2(24, 0));
	memdelete(target);
}

TEST_CASE("[SceneTree][AnimationBlendTree] Create AnimationBlendTree and add AnimationNode") {
	Ref<AnimationNodeBlendTree> blend_tree;
	blend_tree.instantiate();

	// Test initial state.
	CHECK(blend_tree->has_node("output"));
	CHECK_EQ(blend_tree->get_graph_offset(), Vector2(0, 0));
	CHECK_EQ(blend_tree->get_node_list().size(), 1);

	// Test adding animation node.
	Ref<AnimationNodeAnimation> anim_node;
	anim_node.instantiate();
	anim_node->set_animation(StringName("test_animation"));
	Vector2 position(100, 100);
	blend_tree->add_node("test_node", anim_node, position);

	// Test node existence.
	CHECK(blend_tree->has_node("test_node"));
	CHECK_EQ(blend_tree->get_node("test_node"), anim_node);
	CHECK_EQ(blend_tree->get_node_position("test_node"), position);

	// Test node connection on port 0.
	CHECK_EQ(blend_tree->can_connect_node("output", 0, "test_node"), AnimationNodeBlendTree::CONNECTION_OK);
	blend_tree->connect_node("output", 0, "test_node");

	const LocalVector<StringName> *connections = blend_tree->get_node_connection_array("output");
	CHECK_EQ(connections->size(), 1);
	CHECK_EQ(connections->operator[](0), StringName("test_node"));

	// Test node rename.
	blend_tree->rename_node("test_node", "renamed_node");
	CHECK_FALSE(blend_tree->has_node("test_node"));
	CHECK(blend_tree->has_node("renamed_node"));

	connections = blend_tree->get_node_connection_array("output");
	CHECK_EQ(connections->operator[](0), StringName("renamed_node"));

	// Test node removal.
	blend_tree->remove_node("renamed_node");
	CHECK_FALSE(blend_tree->has_node("renamed_node"));

	connections = blend_tree->get_node_connection_array("output");
	CHECK_EQ(connections->operator[](0), StringName());
}

} // namespace TestAnimationBlendTree
