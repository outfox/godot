/**************************************************************************/
/*  test_image_font_import.cpp                                            */
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

TEST_FORCE_LINK(test_image_font_import)

#ifdef TOOLS_ENABLED

#include "core/io/resource_loader.h"
#include "editor/import/resource_importer_imagefont.h"
#include "scene/resources/font.h"
#include "tests/test_utils.h"

TEST_CASE("[ImageFontImport] Invalid ranges consume no atlas cells") {
	const String source_path = TestUtils::get_data_path("images/icon.png");
	const String save_path = TestUtils::get_temp_path("range_validation");
	Ref<ResourceImporterImageFont> importer;
	importer.instantiate();
	List<ResourceImporter::ImportOption> defaults;
	importer->get_import_options(source_path, &defaults);
	HashMap<StringName, Variant> options;
	for (const ResourceImporter::ImportOption &option : defaults) {
		options[option.option.name] = option.default_value;
	}
	options["columns"] = 4;
	options["character_ranges"] = PackedStringArray{ "U+110000,U+0041", "U+100000042", "U+0043-U+110000", "U+0042", "U+10FFFF" };

	ERR_PRINT_OFF
	Error err = importer->import(ResourceUID::INVALID_ID, source_path, save_path, options, nullptr);
	ERR_PRINT_ON
	REQUIRE(err == OK);
	Ref<FontFile> font = ResourceLoader::load(save_path + ".fontdata");
	REQUIRE(font.is_valid());
	const Vector2i size(font->get_fixed_size(), 0);
	const PackedInt32Array glyphs = font->get_glyph_list(0, size);
	CHECK(glyphs.size() == 2);
	CHECK(glyphs.has(0x42));
	CHECK(glyphs.has(0x10FFFF));
	CHECK(font->get_glyph_uv_rect(0, size, 0x42).position == Vector2());
}

#endif // TOOLS_ENABLED
