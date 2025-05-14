import { parseMappingsPart, encodeMappingsPart } from "./sourceMapParse";
import fs from "fs";

type Section = {
    sectionId: number;
    offset: number;
    contents: Buffer;
};

function isNode() {
    return typeof window === "undefined";
}

function readFilePromise(filePath: string) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
}

let curBuffer!: Buffer;
let curIndex!: number;
function createParseFixedLength(name: string, n: number) {
    return function () {
        curIndex += n;
        return name;
    };
}
function createParseNLeb128s(name: string, n: number) {
    return function () {
        let nums = [];
        for (let i = 0; i < n; i++) {
            nums.push(parseLeb128());
        }
        return `${name} ${nums.join(" ")}`;
    };
}
function logRemaining() {
    let endIndex = Math.min(curIndex + 64, curBuffer.length);
    //process.stdout.write(chalk.hsl(200, 100, 50)(String(curBuffer.length - curIndex) + " "));
    process.stdout.write(String(curBuffer.length - curIndex) + " ");
    for (let i = curIndex; i < endIndex; i++) {
        process.stdout.write(curBuffer[i].toString(16) + " ");
    }
    process.stdout.write("\n");
}
let fileLineCache: Record<string, string[]> = {};
function getLines(file: string) {
    if (!(file in fileLineCache)) {
        fileLineCache[file] = fs.readFileSync(file).toString().split("\n");
    }
    return fileLineCache[file];
}
function getLineAfter(dwarfInfo: { filePath: string; line: number }) {
    let lines = getLines(dwarfInfo.filePath);
    let line = dwarfInfo.line;
    if (line === 0) return "";
    return lines[line - 1];
}
type AbbrevInstance = {
    code: number;
    tag: string;
    hasChildren: boolean;
    attributes: {
        name: string;
        formValue: any;
        formName: string;
    }[];
    parsedAddress: number;
    children: AbbrevInstance[];
    filePaths: string[];
};

function logAbbrevInst(
    abbrev: AbbrevInstance,
    indent = "    ",
    curIndent = "",
    abbrevLookup = Object.create(null),
    childLimit = Number.MAX_SAFE_INTEGER
) {
    if (!process || !process.stdout) return;

    process.stdout.write(curIndent + abbrev.tag);
    if (abbrev.hasChildren) {
        process.stdout.write(" (has children)");
    }
    process.stdout.write(` (0x${abbrev.parsedAddress.toString(16)})`);
    let nameAtt = abbrev.attributes.filter((x) => x.name === "DW_AT_name")[0];
    if (nameAtt) {
        process.stdout.write(`(${nameAtt.formValue})`);
    }

    if (childLimit > 0) {
        process.stdout.write("\n");
        for (let att of abbrev.attributes) {
            let attAsStr = typeof att.formValue === "object" ? JSON.stringify(att.formValue) : String(att.formValue);
            if (att.formValue instanceof Buffer) {
                attAsStr = `Buffer([${Array.from(att.formValue)
                    .map((x) => x.toString(16))
                    .join(", ")}])`;
            }
            if (att.name === "DW_AT_decl_file") {
                attAsStr = abbrev.filePaths[att.formValue - 1] || attAsStr;
            }
            process.stdout.write(`${curIndent}| ${att.name} (${attAsStr}) [${att.formName}]\n`);

            if (att.formName.startsWith("DW_FORM_ref")) {
                let refAbbrev = abbrevLookup[att.formValue + 1];
                if (refAbbrev) {
                    logAbbrevInst(refAbbrev, indent, curIndent + indent, abbrevLookup, childLimit - 1);
                }
            }
        }
    }
    process.stdout.write("\n");

    if (childLimit > 0) {
        for (let childAbbrev of abbrev.children) {
            logAbbrevInst(childAbbrev, indent, curIndent + indent, abbrevLookup, childLimit - 1);
        }
    }
}
export function getDwarfAbbrevs(sections: Section[]) {
    let nameValueSections = getNameValueSections(sections);

    let requiredSectionNames = getRequiredSectionNames();
    for (let sectionName of requiredSectionNames) {
        if (!(sectionName in nameValueSections)) {
            return { instances: [{ children: [] }], lookup: Object.create(null) };
        }
    }

    let filePaths: string[] = [];
    {
        let codeSection = sections.filter((x) => x.sectionId === 10)[0];
        if (nameValueSections[".debug_line"]) {
            let dwarfSections = getDwarfSections(nameValueSections[".debug_line"], codeSection.offset);
            filePaths = dwarfSections[0].fullFilePaths;
        }
    }
    // #region Implementation
    let debugStrings: string[] = [];
    function parseCStringAt(offset: number) {
        let pos = offset;
        let buffer = nameValueSections[".debug_str"];
        if (!buffer) {
            return `(string at offset ${offset})`;
        }
        let str = "";
        while (pos < buffer.length) {
            let ch = buffer[pos++];
            if (ch === 0) break;
            str += String.fromCharCode(ch);
        }
        return str;
    }
    {
        curIndex = 0;
        curBuffer = nameValueSections[".debug_str"];
        while (curBuffer && curIndex < curBuffer.length) {
            debugStrings.push(parseCString());
        }
    }
    function getDwTagName(tag: number) {
        const tags: Record<number, string> = {
            [0x01]: "DW_TAG_array_type",
            [0x02]: "DW_TAG_class_type",
            [0x03]: "DW_TAG_entry_point",
            [0x04]: "DW_TAG_enumeration_type",
            [0x05]: "DW_TAG_formal_parameter",
            [0x08]: "DW_TAG_imported_declaration",
            [0x0a]: "DW_TAG_label",
            [0x0b]: "DW_TAG_lexical_block",
            [0x0d]: "DW_TAG_member",
            [0x0f]: "DW_TAG_pointer_type",
            [0x10]: "DW_TAG_reference_type",
            [0x11]: "DW_TAG_compile_unit",
            [0x12]: "DW_TAG_string_type",
            [0x13]: "DW_TAG_structure_type",
            [0x15]: "DW_TAG_subroutine_type",
            [0x16]: "DW_TAG_typedef",
            [0x17]: "DW_TAG_union_type",
            [0x18]: "DW_TAG_unspecified_parameters",
            [0x19]: "DW_TAG_variant",
            [0x1a]: "DW_TAG_common_block",
            [0x1b]: "DW_TAG_common_inclusion",
            [0x1c]: "DW_TAG_inheritance",
            [0x1d]: "DW_TAG_inlined_subroutine",
            [0x1e]: "DW_TAG_module",
            [0x1f]: "DW_TAG_ptr_to_member_type",
            [0x20]: "DW_TAG_set_type",
            [0x21]: "DW_TAG_subrange_type",
            [0x22]: "DW_TAG_with_stmt",
            [0x23]: "DW_TAG_access_declaration",
            [0x24]: "DW_TAG_base_type",
            [0x25]: "DW_TAG_catch_block",
            [0x26]: "DW_TAG_const_type",
            [0x27]: "DW_TAG_constant",
            [0x28]: "DW_TAG_enumerator",
            [0x29]: "DW_TAG_file_type",
            [0x2a]: "DW_TAG_friend",
            [0x2b]: "DW_TAG_namelist",
            [0x2c]: "DW_TAG_namelist_item",
            [0x2d]: "DW_TAG_packed_type",
            [0x2e]: "DW_TAG_subprogram",
            [0x2f]: "DW_TAG_template_type_parameter",
            [0x30]: "DW_TAG_template_value_parameter",
            [0x31]: "DW_TAG_thrown_type",
            [0x32]: "DW_TAG_try_block",
            [0x33]: "DW_TAG_variant_part",
            [0x34]: "DW_TAG_variable",
            [0x35]: "DW_TAG_volatile_type",
            [0x36]: "DW_TAG_dwarf_procedure",
            [0x37]: "DW_TAG_restrict_type",
            [0x38]: "DW_TAG_interface_type",
            [0x39]: "DW_TAG_namespace",
            [0x3a]: "DW_TAG_imported_module",
            [0x3b]: "DW_TAG_unspecified_type",
            [0x3c]: "DW_TAG_partial_unit",
            [0x3d]: "DW_TAG_imported_unit",
            [0x3f]: "DW_TAG_condition",
            [0x40]: "DW_TAG_shared_type",
            [0x41]: "DW_TAG_type_unit",
            [0x42]: "DW_TAG_rvalue_reference_type",
            [0x43]: "DW_TAG_template_alias",
        };
        if (tag in tags) {
            return tags[tag];
        }
        if (tag >= 0x4080 && tag <= 0xffff) {
            return `DW_TAG_user_${tag}`;
        }
        return `DW_TAG_invalid_${tag}`;
    }
    function getDwForm(form: number, tagName: string) {
        function parseBlock(sizeSize: number) {
            let size = parseNum(sizeSize, false, true);
            let buffer = curBuffer.slice(curIndex, curIndex + size);
            curIndex += size;
            return buffer;
        }
        function parseVarBlock() {
            let size = parseLeb128();
            let buffer = curBuffer.slice(curIndex, curIndex + size);
            curIndex += size;
            return buffer;
        }
        function parseBytes(size: number) {
            let buffer = curBuffer.slice(curIndex, curIndex + size);
            curIndex += size;
            return buffer;
        }
        let forms: Record<number, { name: string; parse: () => any }> = {
            [0x01]: { name: "DW_FORM_addr", parse: () => parseNum(4, false, true) },
            [0x03]: { name: "DW_FORM_block2", parse: () => parseBlock(2) },
            [0x04]: { name: "DW_FORM_block4", parse: () => parseBlock(4) },
            [0x05]: { name: "DW_FORM_data2", parse: () => parseNum(2, false, true) },
            [0x06]: { name: "DW_FORM_data4", parse: () => parseNum(4, false, true) },
            [0x07]: { name: "DW_FORM_data8", parse: () => parseBytes(8) },
            [0x08]: { name: "DW_FORM_string", parse: () => parseCString() },
            [0x09]: { name: "DW_FORM_block", parse: () => parseVarBlock() },
            [0x0a]: { name: "DW_FORM_block1", parse: () => parseBlock(1) },
            [0x0b]: { name: "DW_FORM_data1", parse: () => parseNum(1, false, true) },
            [0x0c]: { name: "DW_FORM_flag", parse: () => parseNum(1, false, true) },
            [0x0d]: { name: "DW_FORM_sdata", parse: () => parseVarBlock() },
            [0x0e]: { name: "DW_FORM_strp", parse: () => parseCStringAt(parseNum(4, false, true)) },
            [0x0f]: { name: "DW_FORM_udata", parse: () => parseLeb128() },
            [0x10]: { name: "DW_FORM_ref_addr", parse: () => parseNum(4, false, true) },
            [0x11]: { name: "DW_FORM_ref1", parse: () => parseNum(1, false, true) },
            [0x12]: { name: "DW_FORM_ref2", parse: () => parseNum(2, false, true) },
            [0x13]: { name: "DW_FORM_ref4", parse: () => parseNum(4, false, true) },
            [0x14]: { name: "DW_FORM_ref8", parse: () => parseBytes(8) },
            [0x15]: { name: "DW_FORM_ref_udata", parse: () => parseVarBlock() },
            [0x16]: { name: "DW_FORM_indirect", parse: () => getDwForm(parseLeb128(), tagName) },
            [0x17]: { name: "DW_FORM_sec_offset", parse: () => parseNum(4, false, true) },
            [0x18]: { name: "DW_FORM_exprloc", parse: () => parseVarBlock() },
            [0x19]: { name: "DW_FORM_flag_present", parse: () => true },
            [0x20]: { name: "DW_FORM_ref_sig8", parse: () => parseBytes(8) },
        };
        if (form in forms) {
            let formObj = forms[form];
            if (tagName === "DW_AT_type") {
                let baseParse = formObj.parse;
                formObj.parse = () => {
                    let result = baseParse();
                    return result;
                };
            }
            return formObj;
        }
        throw new Error(`Unsupported form type ${form}`);
    }
    const dwAttributeNameLookup: Record<number, string> = {
        [0x01]: "DW_AT_sibling",
        [0x02]: "DW_AT_location",
        [0x03]: "DW_AT_name",
        [0x09]: "DW_AT_ordering",
        [0x0b]: "DW_AT_byte_size",
        [0x0c]: "DW_AT_bit_offset",
        [0x0d]: "DW_AT_bit_size",
        [0x10]: "DW_AT_stmt_list",
        [0x11]: "DW_AT_low_pc",
        [0x12]: "DW_AT_high_pc",
        [0x13]: "DW_AT_language",
        [0x15]: "DW_AT_discr",
        [0x16]: "DW_AT_discr_value",
        [0x17]: "DW_AT_visibility",
        [0x18]: "DW_AT_import",
        [0x19]: "DW_AT_string_length",
        [0x1a]: "DW_AT_common_reference",
        [0x1b]: "DW_AT_comp_dir",
        [0x1c]: "DW_AT_const_value",
        [0x1d]: "DW_AT_containing_type",
        [0x1e]: "DW_AT_default_value",
        [0x20]: "DW_AT_inline",
        [0x21]: "DW_AT_is_optional",
        [0x22]: "DW_AT_lower_bound",
        [0x25]: "DW_AT_producer",
        [0x27]: "DW_AT_prototyped",
        [0x2a]: "DW_AT_return_addr",
        [0x2c]: "DW_AT_start_scope",
        [0x2e]: "DW_AT_stride_size",
        [0x2f]: "DW_AT_upper_bound",
        [0x31]: "DW_AT_abstract_origin",
        [0x32]: "DW_AT_accessibility",
        [0x33]: "DW_AT_address_class",
        [0x34]: "DW_AT_artificial",
        [0x35]: "DW_AT_base_types",
        [0x36]: "DW_AT_calling_convention",
        [0x37]: "DW_AT_count",
        [0x38]: "DW_AT_data_member_location",
        [0x39]: "DW_AT_decl_column",
        [0x3a]: "DW_AT_decl_file",
        [0x3b]: "DW_AT_decl_line",
        [0x3c]: "DW_AT_declaration",
        [0x3d]: "DW_AT_discr_list",
        [0x3e]: "DW_AT_encoding",
        [0x3f]: "DW_AT_external",
        [0x40]: "DW_AT_frame_base",
        [0x41]: "DW_AT_friend",
        [0x42]: "DW_AT_identifier_case",
        [0x44]: "DW_AT_namelist_item",
        [0x45]: "DW_AT_priority",
        [0x46]: "DW_AT_segment",
        [0x47]: "DW_AT_specification",
        [0x48]: "DW_AT_static_link",
        [0x49]: "DW_AT_type",
        [0x4a]: "DW_AT_use_location",
        [0x4b]: "DW_AT_variable_parameter",
        [0x4c]: "DW_AT_virtuality",
        [0x4d]: "DW_AT_vtable_elem_location",
        [0x4e]: "DW_AT_allocated",
        [0x4f]: "DW_AT_associated",
        [0x50]: "DW_AT_data_location",
        [0x51]: "DW_AT_byte_stride",
        [0x52]: "DW_AT_entry_pc",
        [0x53]: "DW_AT_use_UTF8",
        [0x54]: "DW_AT_extension",
        [0x55]: "DW_AT_ranges",
        [0x56]: "DW_AT_trampoline",
        [0x57]: "DW_AT_call_column",
        [0x58]: "DW_AT_call_file",
        [0x59]: "DW_AT_call_line",
        [0x5a]: "DW_AT_description",
        [0x5b]: "DW_AT_binary_scale",
        [0x5c]: "DW_AT_decimal_scale",
        [0x5d]: "DW_AT_small",
        [0x5e]: "DW_AT_decimal_sign",
        [0x5f]: "DW_AT_digit_count",
        [0x60]: "DW_AT_picture_string",
        [0x61]: "DW_AT_mutable",
        [0x62]: "DW_AT_threads_scaled",
        [0x63]: "DW_AT_explicit",
        [0x64]: "DW_AT_object_pointer",
        [0x65]: "DW_AT_endianity",
        [0x66]: "DW_AT_elemental",
        [0x67]: "DW_AT_pure",
        [0x68]: "DW_AT_recursive",
        [0x69]: "DW_AT_signature",
        [0x6a]: "DW_AT_main_subprogram",
        [0x6b]: "DW_AT_data_bit_offset",
        [0x6c]: "DW_AT_const_expr",
        [0x6d]: "DW_AT_enum_class",
        [0x6e]: "DW_AT_linkage_name",
        [0x6f]: "DW_AT_string_length_bit_size",
        [0x70]: "DW_AT_string_length_byte_size",
        [0x71]: "DW_AT_rank",
        [0x72]: "DW_AT_str_offsets_base",
        [0x73]: "DW_AT_addr_base",
        [0x74]: "DW_AT_rnglists_base",
        [0x76]: "DW_AT_dwo_name",
        [0x77]: "DW_AT_reference",
        [0x78]: "DW_AT_rvalue_reference",
        [0x79]: "DW_AT_macros",
        [0x7a]: "DW_AT_call_all_calls",
        [0x7b]: "DW_AT_call_all_source_calls",
        [0x7c]: "DW_AT_call_all_tail_calls",
        [0x7d]: "DW_AT_call_return_pc",
        [0x7e]: "DW_AT_call_value",
        [0x7f]: "DW_AT_call_origin",
        [0x80]: "DW_AT_call_parameter",
        [0x81]: "DW_AT_call_pc",
        [0x82]: "DW_AT_call_tail_call",
        [0x83]: "DW_AT_call_target",
        [0x84]: "DW_AT_call_target_clobbered",
        [0x85]: "DW_AT_call_data_location",
        [0x86]: "DW_AT_call_data_value",
        [0x87]: "DW_AT_noreturn",
        [0x88]: "DW_AT_alignment",
        [0x89]: "DW_AT_export_symbols",
        [0x8a]: "DW_AT_deleted",
        [0x8b]: "DW_AT_defaulted",
        [0x8c]: "DW_AT_loclists_base",
    };
    type Abbrev = {
        code: number;
        tag: string;
        hasChildren: boolean;
        attributes: {
            name: string;
            formType: number;
            form: { name: string; parse: () => any };
        }[];
    };
    let abbrevs = Object.create(null);
    {
        curIndex = 0;
        curBuffer = nameValueSections[".debug_abbrev"];
        while (true) {
            let code = parseLeb128();
            // After code is read, as the last code is 0
            if (curIndex === curBuffer.length) break;
            let tag = parseLeb128();
            let hasChildren = !!curBuffer[curIndex++];

            // When we find null we go back up to the parent.
            let abbrev: Abbrev = {
                code,
                tag: getDwTagName(tag),
                attributes: [],
                hasChildren
            };
            while (true) {
                let name = parseLeb128();
                let form = parseLeb128();
                if (name === 0 && form === 0) {
                    break;
                }
                if (!(name in dwAttributeNameLookup)) {
                    //throw new Error(`Unhandled attribute ${name.toString(16)}, for code ${code}`);
                }
                abbrev.attributes.push({
                    name: dwAttributeNameLookup[name] || "0x" + name.toString(16),
                    formType: form,
                    form: getDwForm(form, dwAttributeNameLookup[name] || String(name)),
                });
            }
            if (code in abbrevs) {
                throw new Error(`Duplicate codes? ${code}`);
            }
            abbrevs[code] = abbrev;
        }
    }
    function instantiateAbbrev(abbrev: Abbrev): AbbrevInstance {
        let parsedAddress = curIndex - 1;
        let attrs = [];
        for (let att of abbrev.attributes) {
            attrs.push({
                name: att.name,
                formName: att.form.name,
                formType: att.formType,
                formValue: att.form.parse(),
            });
        }
        return {
            parsedAddress: parsedAddress,
            tag: abbrev.tag,
            hasChildren: abbrev.hasChildren,
            attributes: attrs,
            filePaths: [],
            children: [],
            code: abbrev.code,
        };
    }
    // #endregion Implementation
    curIndex = 0;
    curBuffer = nameValueSections[".debug_info"];
    let unit_length = parseNum(4, false, true);
    let version = parseNum(2, false, true);
    let debug_abbrev_offset = parseNum(4, false, true);
    let addr_size = parseNum(1, false, true);
    //console.log({unit_length, version, debug_abbrev_offset, addr_size});
    //process.stdout.write("\n");

    let abbrevLookup = Object.create(null);

    function parseAbbrevList() {
        let abbrevInsts = [];
        while (curIndex < curBuffer.length) {
            let code = parseLeb128();
            // Done list of children
            if (code === 0) {
                break;
            }
            // Attribute values
            if (!(code in abbrevs)) {
                console.error(`Unknown code ${code.toString(16)}`);
                break;
            }
            let info = abbrevs[code];
            let abbrevPos = curIndex;
            let infoObj = instantiateAbbrev(info);
            abbrevLookup[abbrevPos] = infoObj;
            abbrevInsts.push(infoObj);
            if (infoObj.hasChildren) {
                infoObj.children = parseAbbrevList();
            } else {
                infoObj.children = [];
            }
        }
        return abbrevInsts;
    }

    let abbrevInsts: AbbrevInstance[] = [];
    while (curIndex < curBuffer.length) {
        abbrevInsts = abbrevInsts.concat(parseAbbrevList());
    }
    return { instances: abbrevInsts, lookup: abbrevLookup };
}
// https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
function colorize(color: string, text: string) {
    return `\x1b[${color}m${text}\x1b[0m`;
}
function getExportNames(sections: Section[], pickExportType = 0) {
    let exportSections = Object.values(sections).filter((x) => x.sectionId === 7);
    let exportedFunctions = Object.create(null);
    for (let exportSection of exportSections) {
        curIndex = 0;
        curBuffer = exportSection.contents;
        let functionCount = parseLeb128();
        while (curIndex < curBuffer.length) {
            let nameLength = parseLeb128();
            let nameBytes = curBuffer.slice(curIndex, curIndex + nameLength);
            curIndex += nameLength;
            let name = Array.from(nameBytes)
                .map((x) => String.fromCharCode(x))
                .join("");
            let exportType = parseLeb128();
            let exportValue = parseLeb128();
            if (exportType === pickExportType) {
                exportedFunctions[exportValue] = name;
            }
        }
    }
    return exportedFunctions;
}


type Wast = {
    wasmByteOffset: number;
    wast: string;
    functionName: string;
    functionIndex: number;
    instructionLength: number;
};
function parseExpression(exportedFunctions: Record<number, string>, fncIndex: number): Wast[] {
    let instructionLengths: Record<number, () => string> = {
        // unreachable
        [0x00]: createParseFixedLength("unreachable", 0),
        // noop
        //[0x01]: createParseFixedLength(0),
        // block start
        [0x02]: createParseFixedLength("block", 1),
        [0x03]: createParseFixedLength("loop", 1),
        [0x0b]: createParseFixedLength("end", 0),
        [0x0c]: createParseFixedLength("br", 1),
        [0x0d]: createParseFixedLength("br_if", 1),
        [0x0f]: createParseFixedLength("return", 0),
        [0x10]: createParseNLeb128s("call", 1),
        [0x11]: createParseNLeb128s("call_indirect", 2),
        [0x1a]: createParseFixedLength("drop", 0),
        [0x1b]: createParseFixedLength("select", 0),
        [0x20]: createParseNLeb128s("get_local", 1),
        [0x21]: createParseNLeb128s("set_local", 1),
        [0x22]: createParseNLeb128s("tee_local", 1),
        [0x23]: createParseNLeb128s("get_global", 1),
        [0x24]: createParseNLeb128s("set_global", 1),
        // (The first argument is 2^x, the alignment bytes. If it matches the instruction kind, it is
        //  omitted from the WAST (so 2 for i32 is the not shown in the wast, and 3 for i64 isn't shown.
        //  I'm not sure about load8_s, etc...))
        [0x28]: createParseNLeb128s("i32.load", 2),
        [0x29]: createParseNLeb128s("i64.load", 2),
        [0x2a]: createParseNLeb128s("f32.load", 2),
        [0x2b]: createParseNLeb128s("f64.load", 2),
        [0x2c]: createParseNLeb128s("i32.load8_s", 2),
        [0x2d]: createParseNLeb128s("i32.load8_u", 2),
        [0x2e]: createParseNLeb128s("i32.load16_s", 2),
        [0x2f]: createParseNLeb128s("i32.load16_u", 2),
        [0x30]: createParseNLeb128s("i64.load8_s", 2),
        [0x31]: createParseNLeb128s("i64.load8_u", 2),
        [0x32]: createParseNLeb128s("i64.load16_s", 2),
        [0x33]: createParseNLeb128s("i64.load16_u", 2),
        [0x34]: createParseNLeb128s("i64.load32_s", 2),
        [0x35]: createParseNLeb128s("i64.load32_u", 2),
        [0x36]: createParseNLeb128s("i32.store", 2),
        [0x37]: createParseNLeb128s("i64.store", 2),
        [0x38]: createParseNLeb128s("f32.store", 2),
        [0x39]: createParseNLeb128s("f64.store", 2),
        [0x3a]: createParseNLeb128s("i32.store8", 2),
        [0x3b]: createParseNLeb128s("i32.store16", 2),
        [0x3c]: createParseNLeb128s("i64.store8", 2),
        [0x3d]: createParseNLeb128s("i64.store16", 2),
        [0x3e]: createParseNLeb128s("i64.store32", 2),
        [0x41]: createParseNLeb128s("i32.const", 1),
        [0x42]: createParseNLeb128s("i64.const", 1),
        // Both directly in the 32 and 64 bit IEEE 754-2008 bit patterns
        [0x43]: createParseFixedLength("f32.const", 4),
        [0x44]: createParseFixedLength("f64.const", 8),
        [0x45]: createParseFixedLength("i32.eqz", 0),
        [0x46]: createParseFixedLength("i32.eq", 0),
        [0x47]: createParseFixedLength("i32.ne", 0),
        [0x48]: createParseFixedLength("i32.lt_s", 0),
        [0x49]: createParseFixedLength("i32.lt_u", 0),
        [0x4a]: createParseFixedLength("i32.gt_s", 0),
        [0x4b]: createParseFixedLength("i32.gt_u", 0),
        [0x4c]: createParseFixedLength("i32.le_s", 0),
        [0x4d]: createParseFixedLength("i32.le_u", 0),
        [0x4e]: createParseFixedLength("i32.ge_s", 0),
        [0x4f]: createParseFixedLength("i32.ge_u", 0),
        [0x50]: createParseFixedLength("i64.eqz", 0),
        [0x51]: createParseFixedLength("i64.eq", 0),
        [0x52]: createParseFixedLength("i64.ne", 0),
        [0x53]: createParseFixedLength("i64.lt_s", 0),
        [0x54]: createParseFixedLength("i64.lt_u", 0),
        [0x55]: createParseFixedLength("i64.gt_s", 0),
        [0x56]: createParseFixedLength("i64.gt_u", 0),
        [0x57]: createParseFixedLength("i64.le_s", 0),
        [0x58]: createParseFixedLength("i64.le_u", 0),
        [0x59]: createParseFixedLength("i64.ge_s", 0),
        [0x5a]: createParseFixedLength("i64.ge_u", 0),
        [0x5b]: createParseFixedLength("f32.eq", 0),
        [0x5c]: createParseFixedLength("f32.ne", 0),
        [0x5d]: createParseFixedLength("f32.lt", 0),
        [0x5e]: createParseFixedLength("f32.gt", 0),
        [0x5f]: createParseFixedLength("f32.le", 0),
        [0x60]: createParseFixedLength("f32.ge", 0),
        [0x61]: createParseFixedLength("f64.eq", 0),
        [0x62]: createParseFixedLength("f64.ne", 0),
        [0x63]: createParseFixedLength("f64.lt", 0),
        [0x64]: createParseFixedLength("f64.gt", 0),
        [0x65]: createParseFixedLength("f64.le", 0),
        [0x66]: createParseFixedLength("f64.ge", 0),
        [0x67]: createParseFixedLength("i32.clz", 0),
        [0x68]: createParseFixedLength("i32.ctz", 0),
        [0x69]: createParseFixedLength("i32.popcnt", 0),
        [0x6a]: createParseFixedLength("i32.add", 0),
        [0x6b]: createParseFixedLength("i32.sub", 0),
        [0x6c]: createParseFixedLength("i32.mul", 0),
        [0x6d]: createParseFixedLength("i32.div_s", 0),
        [0x6e]: createParseFixedLength("i32.div_u", 0),
        [0x6f]: createParseFixedLength("i32.rem_s", 0),
        [0x70]: createParseFixedLength("i32.rem_u", 0),
        [0x71]: createParseFixedLength("i32.and", 0),
        [0x72]: createParseFixedLength("i32.or", 0),
        [0x73]: createParseFixedLength("i32.xor", 0),
        [0x74]: createParseFixedLength("i32.shl", 0),
        [0x75]: createParseFixedLength("i32.shr_s", 0),
        [0x76]: createParseFixedLength("i32.shr_u", 0),
        [0x77]: createParseFixedLength("i32.rotl", 0),
        [0x78]: createParseFixedLength("i32.rotr", 0),
        [0x79]: createParseFixedLength("i64.clz", 0),
        [0x7a]: createParseFixedLength("i64.ctz", 0),
        [0x7b]: createParseFixedLength("i64.popcnt", 0),
        [0x7c]: createParseFixedLength("i64.add", 0),
        [0x7d]: createParseFixedLength("i64.sub", 0),
        [0x7e]: createParseFixedLength("i64.mul", 0),
        [0x7f]: createParseFixedLength("i64.div_s", 0),
        [0x80]: createParseFixedLength("i64.div_u", 0),
        [0x81]: createParseFixedLength("i64.rem_s", 0),
        [0x82]: createParseFixedLength("i64.rem_u", 0),
        [0x83]: createParseFixedLength("i64.and", 0),
        [0x84]: createParseFixedLength("i64.or", 0),
        [0x85]: createParseFixedLength("i64.xor", 0),
        [0x86]: createParseFixedLength("i64.shl", 0),
        [0x87]: createParseFixedLength("i64.shr_s", 0),
        [0x88]: createParseFixedLength("i64.shr_u", 0),
        [0x89]: createParseFixedLength("i64.rotl", 0),
        [0x8a]: createParseFixedLength("i64.rotr", 0),
        [0x8b]: createParseFixedLength("f32.abs", 0),
        [0x8c]: createParseFixedLength("f32.neg", 0),
        [0x8d]: createParseFixedLength("f32.ceil", 0),
        [0x8e]: createParseFixedLength("f32.floor", 0),
        [0x8f]: createParseFixedLength("f32.trunc", 0),
        [0x90]: createParseFixedLength("f32.nearest", 0),
        [0x91]: createParseFixedLength("f32.sqrt", 0),
        [0x92]: createParseFixedLength("f32.add", 0),
        [0x93]: createParseFixedLength("f32.sub", 0),
        [0x94]: createParseFixedLength("f32.mul", 0),
        [0x95]: createParseFixedLength("f32.div", 0),
        [0x96]: createParseFixedLength("f32.min", 0),
        [0x97]: createParseFixedLength("f32.max", 0),
        [0x98]: createParseFixedLength("f32.copysign", 0),
        [0x99]: createParseFixedLength("f64.abs", 0),
        [0x9a]: createParseFixedLength("f64.neg", 0),
        [0x9b]: createParseFixedLength("f64.ceil", 0),
        [0x9c]: createParseFixedLength("f64.floor", 0),
        [0x9d]: createParseFixedLength("f64.trunc", 0),
        [0x9e]: createParseFixedLength("f64.nearest", 0),
        [0x9f]: createParseFixedLength("f64.sqrt", 0),
        [0xa0]: createParseFixedLength("f64.add", 0),
        [0xa1]: createParseFixedLength("f64.sub", 0),
        [0xa2]: createParseFixedLength("f64.mul", 0),
        [0xa3]: createParseFixedLength("f64.div", 0),
        [0xa4]: createParseFixedLength("f64.min", 0),
        [0xa5]: createParseFixedLength("f64.max", 0),
        [0xa6]: createParseFixedLength("f64.copysign", 0),
        [0xa7]: createParseFixedLength("i32.wrap_i64", 0),
        [0xa8]: createParseFixedLength("i32.trunc_f32_s", 0),
        [0xa9]: createParseFixedLength("i32.trunc_f32_u", 0),
        [0xaa]: createParseFixedLength("i32.trunc_f64_s", 0),
        [0xab]: createParseFixedLength("i32.trunc_f64_u", 0),
        [0xac]: createParseFixedLength("i64.extend_i32_s", 0),
        [0xad]: createParseFixedLength("i64.extend_i32_u", 0),
        [0xae]: createParseFixedLength("i64.trunc_f32_s", 0),
        [0xaf]: createParseFixedLength("i64.trunc_f32_u", 0),
        [0xb0]: createParseFixedLength("i64.trunc_f64_s", 0),
        [0xb1]: createParseFixedLength("i64.trunc_f64_u", 0),
        [0xb2]: createParseFixedLength("f32.convert_i32_s", 0),
        [0xb3]: createParseFixedLength("f32.convert_i32_u", 0),
        [0xb4]: createParseFixedLength("f32.convert_i64_s", 0),
        [0xb5]: createParseFixedLength("f32.convert_i64_u", 0),
        [0xb6]: createParseFixedLength("f32.demote_f64", 0),
        [0xb7]: createParseFixedLength("f64.convert_i32_s", 0),
        [0xb8]: createParseFixedLength("f64.convert_i32_u", 0),
        [0xb9]: createParseFixedLength("f64.convert_i64_s", 0),
        [0xba]: createParseFixedLength("f64.convert_i64_u", 0),
        [0xbb]: createParseFixedLength("f64.promote_f32", 0),
        [0xbc]: createParseFixedLength("i32.reinterpret_f32", 0),
        [0xbd]: createParseFixedLength("i64.reinterpret_f64", 0),
        [0xbe]: createParseFixedLength("f32.reinterpret_i32", 0),
        [0xbf]: createParseFixedLength("f64.reinterpret_i64", 0),
    };

    let wasts = [];

    // Byte length of current expression
    let startIndex = curIndex;
    let len = parseLeb128();
    let endIndex = curIndex + len;
    let functionName = exportedFunctions[fncIndex] || "???";
    let declarationCount = parseLeb128();
    for (let i = 0; i < declarationCount; i++) {
        let countOfValue = parseLeb128();
        let valueType = parseLeb128();
    }
    // Parse instructions
    while (curIndex < endIndex) {
        let wasmByteOffset = curIndex;
        let code = curBuffer[curIndex++];
        if (code === undefined) {
            throw new Error(`Did not find return in function?`);
        }
        if (!(code in instructionLengths)) {
            console.error(`!!! Unhandled instruction ${code}`);
            curIndex--;
            logRemaining();
            break;
        }
        let wast = instructionLengths[code]();
        wasts.push({
            wasmByteOffset,
            wast,
            functionName,
            functionIndex: fncIndex - 1,
            instructionLength: curIndex - wasmByteOffset,
        });
    }

    if (curIndex !== endIndex) {
        console.error(`!!! Invalid read, read to ${curIndex}, should have read to ${endIndex}`);
    }
    curIndex = endIndex;

    return wasts;
}

function getWasts(wasmCodeBuffer: Buffer, exportedFunctions: Record<number, string>): Wast[] {
    curIndex = 0;
    curBuffer = wasmCodeBuffer;
    let functionCount = parseLeb128();
    let wasts: Wast[] = [];
    let fncIndex = 1;
    while (curIndex < curBuffer.length) {
        for (let wast of parseExpression(exportedFunctions, fncIndex++)) {
            wasts.push(wast);
        }
    }
    return wasts;
}

function getFunctionWasts(sections: Section[]): Wast[] {
    let exportedFunctions = getExportNames(sections);
    let wasts: Wast[] = [];
    let codeSections = Object.values(sections).filter((x) => x.sectionId === 10);
    for (let codeSection of codeSections) {
        wasts = wasts.concat(getWasts(codeSection.contents, exportedFunctions));
    }
    return wasts;
}
export function generateSourceMap(
    wasmFile: Buffer,
    /** Gets rid of multiple mappings for 1 line in a row. */
    uniqueLines = false
) {
    let sections = getSections(wasmFile);
    let nameValueSections = getNameValueSections(sections);
    let codeSection = Object.values(sections).filter((x) => x.sectionId === 10)[0];
    if (!(".debug_line" in nameValueSections)) {
        return undefined;
    }
    let dwarfSections = getDwarfSections(nameValueSections[".debug_line"], codeSection.offset);
    let fileNamesToInclude: Record<string, boolean> = {};
    dwarfSections.forEach((x) => {
        for (let fullFilePath of x.fullFilePaths) {
            fileNamesToInclude[fullFilePath] = true;
        }
    });
    let sourceMap = getSourceMap(dwarfSections, fileNamesToInclude, uniqueLines);
    let sourcesContent = sourceMap.sources.map(x => fs.readFileSync(x, "utf8"));
    return {
        ...sourceMap,
        sourcesContent,
    };
}
export function replaceSourceMapURL(wasmFile: Buffer, urlMapper: (oldUrl: string) => string) {
    let sections = getSections(wasmFile);
    let section = sections.filter((section) => getNameOfSection(section).name === "sourceMappingURL")[0];
    let oldUrl = "";
    if (!section) {
        section = {
            sectionId: 0,
            // Eh... offset isn't needed, so it should be fine to leave it invalid
            offset: -1,
            contents: Buffer.alloc(0),
        };
        sections.push(section);
    } else {
        let { value } = getNameOfSection(section);
        let valueLength = value.readUInt32BE(0);
        oldUrl = String.fromCharCode.apply(null, Array.from(value.slice(4, 4 + valueLength)));
    }
    let url = urlMapper(oldUrl);
    let urlLength = Buffer.alloc(4);
    urlLength.writeUInt32BE(urlLength.length, 0);
    let urlBytes = Buffer.from(url, "utf8");
    section.contents = createNameValueSectionContents(
        "sourceMappingURL",
        Buffer.concat([leb128Encode(urlBytes.length), urlBytes])
    );
    return joinSections(sections);
}

export function removeDwarfSection(wasmFile: Buffer) {
    let sections = getSections(wasmFile);
    sections = sections.filter((x) => getNameOfSection(x).name !== ".debug_line");
    return joinSections(sections);
}

function getRequiredSectionNames(): string[] {
    // debug_str is used to get the function names, which is fine.
    //  We aren't removing sections to reduce the size, we are doing it as the DWARF info is somewhat incorrect when mapped from a debug
    //  build to a release build, and we don't want to be generated wholly inaccurate files that will confuse people.
    return [".debug_info", ".debug_abbrev", ".debug_str"];
}

export function copyRequireDwarfSections(wasmFileWithDwarf: Buffer, wasmFileWithoutDwarf: Buffer) {
    let sectionsToMove = getRequiredSectionNames();
    let dwarfSections = getSections(wasmFileWithDwarf);
    dwarfSections = dwarfSections.filter((x) => sectionsToMove.includes(getNameOfSection(x).name));

    let sections = getSections(wasmFileWithoutDwarf);
    sections = sections.filter((x) => !sectionsToMove.includes(getNameOfSection(x).name));
    sections = sections.concat(dwarfSections);

    return joinSections(sections);
}

function pad(str: string, count: number, char = "0") {
    str = str + "";
    while (str.length < count) {
        str = char + str;
    }
    return str;
}
function leb128Parse(index: number, buffer: Buffer) {
    let bytes = [];
    while (index < buffer.length) {
        let byte = buffer[index++];
        bytes.push(byte);
        if (!(byte & 0x80)) {
            break;
        }
    }
    let value = Number.parseInt(
        bytes
            .reverse()
            .map((x) => pad(x.toString(2), 8).slice(1))
            .join(""),
        2
    );
    return {
        value,
        bytes,
    };
}
function leb128EncodeBase(n: number) {
    if (n < 0) {
        throw new Error(`Signed leb128 not implemented`);
    }
    // https://github.com/oasislabs/wasm-sourcemap/blob/master/index.js#L22
    let result = [];
    while (n > 127) {
        result.push(128 | (n & 127));
        n = n >> 7;
    }
    result.push(n);
    return result;
}
function leb128Encode(n: number) {
    return Buffer.from(leb128EncodeBase(n));
}
function isValidStart(i: number, file: Buffer) {
    var starts = [];
    let firstLength = 0;
    while (i < file.length) {
        if (i < 0) {
            console.log("wtf");
        }
        let { value, bytes } = leb128Parse(i, file);
        starts.push(i);
        if (!firstLength) {
            firstLength = bytes.length;
        }
        let num = value;
        //if(num == 0) return false;
        //console.log(`${num.toString(16)} at i=${i.toString(16)}, bytes ${bytes.length}`);
        i += num + bytes.length + 1;
        //let ch = String(file[i].toString(16)) + " ";
        //process.stdout.write(ch);
    }
    if (i === file.length + 1) {
        return { firstLength, starts };
    } else {
        return null;
    }
}
function getString(i: number, file: Buffer) {
    let text = "";
    while (i < file.length) {
        let byte = file[i++];
        if (!byte) break;
        text += String.fromCharCode(byte);
    }
    return text;
}
function getSections(file: Buffer): Section[] {
    let sections: Section[] = [];
    sections.push({
        sectionId: -1,
        offset: 0,
        contents: file.slice(0, 8),
    });
    let i = 8;
    while (i < file.length) {
        let sectionId = file[i];
        i++;
        let { value, bytes } = leb128Parse(i, file);
        let num = value;
        i += bytes.length;
        let baseOffsetStart = i;
        let contents = file.slice(i, i + num);
        sections.push({
            sectionId,
            offset: baseOffsetStart,
            contents,
        });
        i += num;
    }
    return sections;
}
function joinSections(sections: Section[]): Buffer {
    sections.sort((x, y) => {
        let a = x.sectionId;
        let b = y.sectionId;
        if (a === 0) a = Number.MAX_SAFE_INTEGER;
        if (b === 0) b = Number.MAX_SAFE_INTEGER;
        return a - b;
    });
    let buffers = [];
    for (let section of sections) {
        if (section.sectionId === -1) {
            buffers.push(section.contents);
        } else {
            buffers.push(
                Buffer.concat([
                    Buffer.from([section.sectionId]),
                    leb128Encode(section.contents.length),
                    section.contents,
                ])
            );
        }
    }
    return Buffer.concat(buffers);
}
function getNameValueSections(sections: Section[]) {
    let nameValueSections: Record<string, Buffer> = {};
    for (let section of sections) {
        let { sectionId, contents } = section;
        if (sectionId === 0) {
            let length = contents[0];
            let name = contents.slice(1, 1 + length).toString();
            let value = contents.slice(1 + length);
            nameValueSections[name] = value;
        }
    }
    return nameValueSections;
}
function getNameOfSection(section: Section) {
    if (section.sectionId !== 0) return { name: "", value: section.contents };
    let { contents } = section;
    let length = contents[0];
    let name = contents.slice(1, 1 + length).toString();
    let value = contents.slice(1 + length);
    return {
        name,
        value,
    };
}
function createNameValueSectionContents(name: string, value: Buffer) {
    return Buffer.concat([
        Buffer.from([name.length]),
        Buffer.from(Array.from(name).map((x) => x.charCodeAt(0))),
        value,
    ]);
}
/** Doesn't handle 64 bit (although it chould for for 64 bit values which require 53 or fewer bytes). */
function parseNum(size: number, isSigned = false, bigEndian = false) {
    let num = parseNumBase(curBuffer, curIndex, size, isSigned, bigEndian);
    curIndex += size;
    return num;
}
function parseNumBase(buffer: Buffer, index: number, size: number, isSigned: boolean, bigEndian: boolean) {
    let values = buffer.slice(index, index + size);
    if (!bigEndian) {
        values.reverse();
    }
    let value = 0;
    let magnitude = 1;
    for (let i = 0; i < values.length; i++) {
        let curValue = values[i] * magnitude;
        magnitude = magnitude << 8;
        let negative = false;
        if (i === values.length - 1 && isSigned) {
            negative = !!(curValue & 0x80);
        }
        value += curValue;
        if (negative) {
            value = -(magnitude - value);
        }
    }
    return value;
}
function parseCString() {
    let str = "";
    while (curIndex < curBuffer.length) {
        let byte = curBuffer[curIndex++];
        if (byte === 0) break;
        str += String.fromCharCode(byte);
    }
    return str;
}
function parseCSequence() {
    let cstrs = [];
    while (true) {
        let cstr = parseCString();
        if (cstr === "") break;
        cstrs.push(cstr);
    }
    return cstrs;
}
function parseLeb128(signed = false) {
    let obj = leb128Parse(curIndex, curBuffer);
    curIndex += obj.bytes.length;
    if (signed) {
        let negativePoint = 1 << (7 * obj.bytes.length - 1);
        if (obj.value >= negativePoint) {
            obj.value = obj.value - 2 * negativePoint;
        }
    }
    return obj.value;
}
function parseVector(elemParse: () => number) {
    let elements: number[] = [];
    let count = parseLeb128();
    for (let i = 0; i < count; i++) {
        elements.push(elemParse());
    }
    return elements;
}
/** Returns absolute mappings. */
function fullMappingStringToAbsoluteMappings(mappingStr: string, sources: string[]) {
    let curPart = {
        newColumn: 0,
        sourcesIndex: 0,
        originalLine: 0,
        originalColumn: 0,
        namesIndex: 0,
    };
    return mappingStr.split(";").map((lineMapping, line) => {
        let deltaMappings = lineMapping.split(",").map(parseMappingsPart);
        curPart.newColumn = 0;
        let mappings: {
            newColumn: number;
            sourcesIndex: number;
            originalLine: number;
            originalColumn: number;
            namesIndex: number;
        }[] = [];
        for (let i = 0; i < deltaMappings.length; i++) {
            let deltaMapping = deltaMappings[i];
            curPart.newColumn += deltaMapping.newColumn;
            curPart.sourcesIndex += deltaMapping.sourcesIndex;
            curPart.originalLine += deltaMapping.originalLine;
            curPart.originalColumn += deltaMapping.originalColumn;
            curPart.namesIndex += deltaMapping.namesIndex;
            let partToPush = { ...curPart, isAbs: true, source: sources[curPart.sourcesIndex] };
            //partToPush.newColumn++;
            //partToPush.originalColumn++;
            //partToPush.originalLine++;
            mappings.push(partToPush);
        }
        return mappings;
    });
}

function getSourceMap(
    dwarfSections: DwarfSection[],
    /** Because of nested things (like ptr.rs, and <::core::macros::panic macros>, etc) one line will have many mappings. I'm not sure
     *      how that works, but I don't think we want that.
     */
    fileNamesToInclude: Record<string, boolean>,
    /** Gets rid of multiple mappings for 1 line in a row. */
    uniqueLines = false
) {
    let sourcesLookup: Record<string, number> = {};
    function getSourceIndex(source: string) {
        if (!(source in sourcesLookup)) {
            sourcesLookup[source] = sources.length;
            sources.push(source);
        }
        return sourcesLookup[source];
    }
    let sources: string[] = [];
    let mappings = "";
    //let mappingsArray = mapObj.mappings.split(";");
    //console.log(mapObj.mappings);
    //console.log(mappingsArray.length);
    //console.log(mapObj.sources.length);
    //let correctMapping = mappingsArray[mapObj.sources.indexOf(filePath)];
    // kkBAm8FA,6BAC0B,OAAnB,OACH,UAAA,EA9LJ,6BACyB,OAAlB,OACH,UAAA,EA9EJ,6BACiC,OAAR,OAAlB,cACH,UAAA,EAYJ,6BACO,OACH,GAAA,EA8HJ,6BACkC,OAAR,OAAnB,cACH,UAAA,GAKJ,qCACW,iBAAD,WAAH,oBACoC,OAAR,OAAnB,cAA
    let lineMappings = [];
    dwarfSections = dwarfSections.filter((x) => x.fullFilePaths.some((y) => fileNamesToInclude[y]));
    for (let section of dwarfSections) {
        let addressOffset = section.offsetInSource;
        let infos = parseDwarfSection(section);
        infos = infos.filter((x) => fileNamesToInclude[x.filePath]);
        let lastLineNumber = undefined;
        for (let i = 0; i < infos.length; i++) {
            let info = infos[i];
            if (info.line === 0) continue;
            if (uniqueLines && info.line === lastLineNumber) {
                continue;
            }
            lastLineNumber = info.line;
            let column = info.column;
            // The DWARF spec says: `column An unsigned integer indicating a column number within a source line. Columns are numbered beginning at 1. The value 0 is reserved to indicate that a statement begins at the "left edge" of the line.`
            // Which we will interpret as 0 being mapped to 1, even though we have the line, and so could find the actual start of the text (which I think
            //  is the intention, to skip whitespace), but mapping it to 1 fits the test case I found online... so I'm doing that.
            let newAddress = info.address + addressOffset;
            // TODO:
            // So... in the example, if we are a duplicate line, and the next line has a column number of 0, then our address is reduced by 1...
            //  Except I can't figure out why... Perhaps it is an artifact of the llvm-dwarfdump they used? Should I use a more recent dwarfdump?
            //  My parsing matches exactly the llvm-dwarfdump in LVM version 8.0.0, so it must be a parsing issue, or I am not reading
            //  the example source mapping code correctly and they have some sort of bug here...
            //  (they DO skip columns == 0, and yet I still see entries for those columns... so it is likely I am not understanding
            //  https://chromium.googlesource.com/external/github.com/kripken/emscripten/+/1.38.11/tools/wasm-sourcemap.py correctly.)
            // Yep, it has been updated: https://github.com/emscripten-core/emscripten/blob/872cc3e06c6f7fc0829e0ae1c6f57536ba40588d/tools/wasm-sourcemap.py
            // For now I'll just duplicate it... and then play around with it after I write some C code to verify this is correct.
            //  (Or maybe the rule is simply if the next has a column of 0...)
            // I'm pretty sure it is wrong now, I just can't track down the source that created it, and I think the current emscripten source is correct...
            if ((i + 1 < infos.length && infos[i + 1].column === 0) || i + 1 === infos.length) {
                //newAddress--;
            }
            if (column === 0) {
                column = 1;
            }
            /*
            newColumn: values[0],
            sourcesIndex: values.length > 1 ? values[1] : 0,
            originalLine: values.length > 2 ? values[2] : 0,
            originalColumn: values.length > 3 ? values[3] : 0,
            namesIndex: values.length > 4 ? values[4] : 0,
            */
            lineMappings.push({
                isAbs: true,
                source: info.filePath,
                newColumn: newAddress,
                sourcesIndex: getSourceIndex(info.filePath),
                // Go from DWARF base 1 to source map base 0
                originalLine: info.line - 1,
                originalColumn: column - 1,
                namesIndex: 0,
            });
            info.address;
        }
    }
    //lineMappings.slice(0, 20).forEach(x => debugLogMapping(x, sources));
    // Not needed, but our test file sorts by address, so this makes tests easier.
    lineMappings.sort((a, b) => a.newColumn - b.newColumn);
    let relativeLineMappings = [];
    let lastMapping = {
        source: "invalid",
        isAbs: true,
        newColumn: 0,
        originalColumn: 0,
        originalLine: 0,
        sourcesIndex: 0,
        namesIndex: 0,
    };
    for (let lineMapping of lineMappings) {
        let curDelta = {
            namesIndex: lineMapping.namesIndex - lastMapping.namesIndex,
            newColumn: lineMapping.newColumn - lastMapping.newColumn,
            originalColumn: lineMapping.originalColumn - lastMapping.originalColumn,
            originalLine: lineMapping.originalLine - lastMapping.originalLine,
            sourcesIndex: lineMapping.sourcesIndex - lastMapping.sourcesIndex,
        };
        relativeLineMappings.push(curDelta);
        lastMapping = lineMapping;
    }
    // Only 1 line for binary files
    mappings = relativeLineMappings.map((x, i) => encodeMappingsPart(x, i === 0, false)).join(",");
    return {
        version: 3,
        names: [],
        sources,
        mappings,
    };
}

// offsetInSource: offsetInSource,
// version,
// mininum_instruction_length,
// maximum_operations_per_instruction,
// default_is_stmt,
// line_base,
// line_range,
// opcode_base,
// standard_opcode_lengths,
// include_directories,
// file_names,
// fullFilePaths: file_names.map((x) => {
//     let dir;
//     if (x.directory_index === 0) {
//         // "The index is 0 if the file was found in the current directory of the compilation"
//         dir = "./";
//     } else {
//         dir = include_directories[x.directory_index - 1] + "/";
//     }
//     return dir + x.file_name;
// }),
// instructions,
type DwarfSection = {
    offsetInSource: number;
    version: number;
    mininum_instruction_length: number;
    maximum_operations_per_instruction: number;
    default_is_stmt: number;
    line_base: number;
    line_range: number;
    opcode_base: number;
    standard_opcode_lengths: number[];
    include_directories: string[];
    file_names: {
        file_name: string;
        directory_index: number;
        last_modified_time: number;
        file_length: number;
    }[];
    instructions: Buffer;
    fullFilePaths: string[];
};
function getDwarfSections(file: Buffer, baseOffsetInSource: number): DwarfSection[] {
    curBuffer = file;
    curIndex = 0;
    let sections: DwarfSection[] = [];
    while (curIndex < curBuffer.length) {
        let offsetInSource = baseOffsetInSource;
        let sectionLength = parseNum(4, undefined, true);
        let currentEnd = curIndex + sectionLength;
        let version = parseNum(2, undefined, true);
        let header_length = parseNum(4, undefined, true);
        let mininum_instruction_length = parseNum(1);
        let maximum_operations_per_instruction = parseNum(1);
        let default_is_stmt = parseNum(1);
        if (mininum_instruction_length !== 1) {
            throw new Error(`mininum_instruction_lengths !== 1 are not supported ${mininum_instruction_length}`);
        }
        let line_base = parseNum(1, true);
        let line_range = parseNum(1);
        let opcode_base = parseNum(1);
        let standard_opcode_lengths = [];
        for (let i = 0; i < opcode_base - 1; i++) {
            standard_opcode_lengths.push(parseNum(1));
        }
        let include_directories = parseCSequence();
        let file_names = [];
        while (true) {
            let file_name = parseCString();
            if (file_name === "") break;
            let directory_index = parseLeb128();
            let last_modified_time = parseLeb128();
            let file_length = parseLeb128();
            file_names.push({
                file_name,
                directory_index,
                last_modified_time,
                file_length,
            });
        }
        let instructions = curBuffer.slice(curIndex, currentEnd);
        curIndex = currentEnd;
        let section: DwarfSection = {
            offsetInSource: offsetInSource,
            version,
            mininum_instruction_length,
            maximum_operations_per_instruction,
            default_is_stmt,
            line_base,
            line_range,
            opcode_base,
            standard_opcode_lengths,
            include_directories,
            file_names,
            fullFilePaths: file_names.map((x) => {
                let dir;
                if (x.directory_index === 0) {
                    // "The index is 0 if the file was found in the current directory of the compilation"
                    dir = "./";
                } else {
                    dir = include_directories[x.directory_index - 1] + "/";
                }
                return dir + x.file_name;
            }),
            instructions,
        };
        sections.push(section);
        curIndex = currentEnd;
    }
    return sections;
}

type ParsedSection = {
    filePath: string;
    line: number;
    column: number;
    address: number;
};
function parseDwarfSection(dwarfSection: DwarfSection) {
    let {
        default_is_stmt,
        opcode_base,
        line_base,
        line_range,
        maximum_operations_per_instruction,
        mininum_instruction_length,
        standard_opcode_lengths,
    } = dwarfSection;
    var defaultRegisters = {
        address: 0,
        op_index: 0,
        file: 1,
        line: 1,
        column: 0,
        is_stmt: default_is_stmt,
        basic_block: false,
        end_sequence: false,
        prologue_end: false,
        epilogue_begin: false,
        isa: 0,
        discriminator: 0,
    };
    let matrix: ParsedSection[] = [];
    let curRegisters = { ...defaultRegisters };
    function applySpecialOpcode(opCode: number, noLineChange = false) {
        var adjusted_opcode = opCode - opcode_base;
        if (adjusted_opcode < 0) {
            throw new Error(`Special opcode is invalid, tried to use ${opCode}`);
        }
        var operation_advance = Math.floor(adjusted_opcode / line_range);
        var address_change =
            mininum_instruction_length *
            Math.floor((curRegisters.op_index + operation_advance) / maximum_operations_per_instruction);
        //console.log({address_change, operation_advance});
        curRegisters.address += address_change;
        curRegisters.op_index = (curRegisters.op_index + operation_advance) % maximum_operations_per_instruction;
        if (!noLineChange) {
            curRegisters.line += line_base + (adjusted_opcode % line_range);
            //curRegisters.line = curRegisters.line % line_range;
            pushMatrix(opCode);
            curRegisters.basic_block = false;
            curRegisters.prologue_end = false;
            curRegisters.epilogue_begin = false;
            curRegisters.discriminator = 0;
        }
    }
    function pushMatrix(opCode: number) {
        //logEntry(curRegisters, opCode);
        let { file, ...remaining } = curRegisters;
        matrix.push({
            ...remaining,
            filePath: dwarfSection.fullFilePaths[file - 1],
        });
    }
    curIndex = 0;
    curBuffer = dwarfSection.instructions;
    // Starts with a byte? That is 0, and I'm not sure what it does...
    //parseNum(1);
    while (curIndex < curBuffer.length) {
        let opCode = parseNum(1);
        //console.log("before", {opCode, address: curRegisters.address});
        if (opCode == 0) {
            //console.log(`Unhandled extended opcode ${opCode}`);
            //return;
            // extended opcode
            let opCodeLength = parseLeb128();
            let opCodeBytes = curBuffer.slice(curIndex, curIndex + opCodeLength);
            if (opCodeBytes.length === 0) {
                console.log(`done, or broken? Read ${curIndex}`);
                // Done... or broken?
                return matrix;
            }
            curIndex += opCodeLength;
            opCode = opCodeBytes[0];
            if (opCode === 1) {
                curRegisters.end_sequence = true;
                pushMatrix(opCode);
                curRegisters = { ...defaultRegisters };
            } else if (opCode === 2) {
                //console.log({opCode, opCodeBytes});
                curRegisters.address = parseNumBase(opCodeBytes, 1, 4, false, true);
            } else if (opCode === 4) {
                curRegisters.discriminator = leb128Parse(1, opCodeBytes).value;
            } else {
                console.log({ opCode, opCodeBytes });
                console.log(`Unhandled extended opcode ${opCode}`);
                return matrix;
            }
            /*
            opCode = parseNum(opCodeLength);
            if(opCode == -1) {

            } else {
                console.log(`Unhandled extended opcode ${opCode}, length ${opCodeLength}`);
                return;
            }
            */
        } else if (opCode < standard_opcode_lengths.length) {
            let opCodeLength = standard_opcode_lengths[opCode - 1];
            if (opCodeLength === 0) {
                //throw new Error(`Length invalid? For opCode ${opCode}`);
            }
            if (opCode === 1) {
                pushMatrix(opCode);
                curRegisters.basic_block = false;
                curRegisters.prologue_end = false;
                curRegisters.epilogue_begin = false;
                curRegisters.discriminator = 0;
            } else if (opCode === 2) {
                let opCode = parseLeb128();
                applySpecialOpcode(opCode * line_range + opcode_base, true);
            } else if (opCode === 3) {
                curRegisters.line += parseLeb128(true);
            } else if (opCode === 4) {
                // DW_LNS_set_file
                curRegisters.file = parseLeb128();
            } else if (opCode === 5) {
                curRegisters.column = parseLeb128();
            } else if (opCode === 6) {
                curRegisters.is_stmt = curRegisters.is_stmt ? 0 : 1;
            } else if (opCode === 7) {
                curRegisters.basic_block = true;
            } else if (opCode === 8) {
                applySpecialOpcode(255, true);
            } else if (opCode === 9) {
                curRegisters.address += parseNum(2, undefined, true);
                curRegisters.op_index = 0;
            } else if (opCode === 10) {
                curRegisters.prologue_end = true;
            } else if (opCode === 11) {
                curRegisters.epilogue_begin = true;
            } else if (opCode === 12) {
                curRegisters.isa = parseLeb128();
            } else {
                console.log(`Unhandled opcode ${opCode}, length ${opCodeLength}`);
                return matrix;
            }
        } else {
            applySpecialOpcode(opCode);
        }
        //console.log("after", {opCode, address: curRegisters.address});
    }
    return matrix;
}

export function getWasmMemoryExports(wasmFile: Buffer) {
    let sections = getSections(wasmFile);

    let memoryLayout = Object.create(null);

    let dataSections = sections.filter((x) => x.sectionId === 11);
    for (let dataSection of dataSections) {
        curIndex = 0;
        curBuffer = dataSection.contents;

        let count = parseLeb128();
        while (curIndex < curBuffer.length) {
            let memidx = parseLeb128();

            let expressionType = curBuffer[curIndex++];
            // Only expect i32.const values here, as this is the location in memory of the export.
            if (expressionType !== 0x41) {
                throw new Error(`Unexpected expression in globals ${expressionType.toString(16)}`);
            }
            let memoryLocation = parseLeb128();
            let endOpcode = parseLeb128();
            if (endOpcode !== 0x0b) {
                throw new Error(
                    `Globals has an expression longer than expected. I haven't seen this before, and this will require more complicated parsed to get the memory location of the global exports`
                );
            }

            let memorySize = parseLeb128();
            curIndex += memorySize;

            memoryLayout[memoryLocation] = "data";
        }
    }

    let globalSections = sections.filter((x) => x.sectionId === 6);
    for (let globalSection of globalSections) {
        curIndex = 0;
        curBuffer = globalSection.contents;

        let globalIndex = 0;

        let globalCount = parseLeb128();
        while (curIndex < curBuffer.length) {
            let valueType = curBuffer[curIndex++];
            if (valueType !== 0x7f) {
                // I've only seen 0x7f, i32. 0x7e is 64 bit, and 0x7d and 0x7c are floats.
                //  It looks like the type here is independent of the types used in the program, so we can't use this type for anything.
                //  (I got i32 for floats, doubles and ints)
            }
            let mutability = curBuffer[curIndex++];

            let expressionType = curBuffer[curIndex++];
            // Only expect i32.const values here, as this is the location in memory of the export.
            if (expressionType !== 0x41) {
                throw new Error(`Unexpected expression in globals ${expressionType.toString(16)}`);
            }
            let memoryLocation = parseLeb128();
            let endOpcode = parseLeb128();
            if (endOpcode !== 0x0b) {
                throw new Error(
                    `Globals has an expression longer than expected. I haven't seen this before, and this will require more complicated parsed to get the memory location of the global exports`
                );
            }

            memoryLayout[memoryLocation] = globalIndex;

            globalIndex++;
        }
    }

    let { instances, lookup } = getDwarfAbbrevs(sections);

    let varAbbrevs = instances[0].children.filter((x) => x.tag === "DW_TAG_variable");
    let abbrevLookup = Object.create(null);

    for (var varAbbrev of varAbbrevs) {
        let name = getAttValue(varAbbrev, "DW_AT_name");
        abbrevLookup[name] = varAbbrev;
    }

    let layoutSizes = [];
    let memorySorted = Object.keys(memoryLayout).map((x) => +x);
    memorySorted.sort((a, b) => a - b);
    for (let i = 0; i < memorySorted.length - 1; i++) {
        let address = memorySorted[i];
        let globalIndex = memoryLayout[address];
        if (typeof globalIndex !== "number") continue;
        let size = memorySorted[i + 1] - address;

        layoutSizes.push({
            size,
            address,
            globalIndex,
        });
    }

    let memoryLookup = Object.create(null);

    let exportNames = getExportNames(sections, 3);
    for (let sizeObj of layoutSizes) {
        let name = exportNames[sizeObj.globalIndex];
        if (name === undefined) continue;
        //if(name.startsWith("__")) continue;
        //if(name.startsWith("SHIM__")) continue;

        let memoryObj = {
            size: sizeObj.size,
            address: sizeObj.address,
            count: 0,
            typeName: "",
        };

        let abbrev = abbrevLookup[name];
        if (abbrev) {
            let abbrevObj = getAbbrevType(abbrev, lookup);
            if (abbrevObj) {
                if (abbrevObj.count) {
                    memoryObj.size = abbrevObj.size;

                    memoryObj.count = abbrevObj.count;
                }
                if (!abbrevObj.typeName) {
                    console.log(abbrevObj);
                }
                if (!abbrevObj.object) {
                    Object.assign(memoryObj, typeNameToSize(abbrevObj.typeName));
                }
                memoryObj.typeName = abbrevObj.typeName;
            }
        }

        if (memoryObj.size < 0) {
            debugger;
            console.log(sizeObj, abbrev);
        }

        memoryLookup[name] = memoryObj;
    }

    return memoryLookup;
}

function getAttValue(abbrev: AbbrevInstance, attName: string) {
    let att = abbrev.attributes.filter((x) => x.name === attName)[0];
    if (!att) return undefined;
    return att.formValue;
}

function typeNameToSize(typeName: string) {
    let signed = true;
    let float = false;
    let byteWidth = 1;

    typeName = typeName.split("*")[0];

    if (typeName.includes("unsigned ")) {
        signed = false;
        typeName = typeName.split("unsigned ").join("");
    }

    if (typeName === "char") {
        byteWidth = 1;
    } else if (typeName === "short") {
        byteWidth = 2;
    } else if (typeName === "int") {
        byteWidth = 4;
    } else if (typeName === "long int") {
        byteWidth = 4;
    } else if (typeName === "long long int") {
        byteWidth = 8;
    } else if (typeName === "float") {
        byteWidth = 4;
        float = true;
    } else if (typeName === "double") {
        byteWidth = 8;
        float = true;
    } else if (typeName === "long double") {
        byteWidth = 16;
        float = true;
    } else if (typeName === "bool" || typeName === "NO_TYPE_FOUND") {
        byteWidth = 1;
        signed = false;
    } else {
        console.log(`Unhandled type ${typeName}, assuming width is 4 bytes`);
        byteWidth = 4;
    }

    return { signed, float, byteWidth };
}

type AbbrevType = any;
function getAbbrevType(abbrev: AbbrevInstance, lookup: Record<string, AbbrevInstance>): AbbrevType {
    function unwrapAtType(abbrev: AbbrevInstance) {
        return lookup[getAttValue(abbrev, "DW_AT_type") + 1];
    }

    let baseType = unwrapAtType(abbrev);

    if (!baseType) {
        return {
            type: "void",
            typeName: getAttValue(abbrev, "DW_AT_name"),
        };
    }

    let typeName = getAttValue(baseType, "DW_AT_name");

    if (baseType.tag === "DW_TAG_const_type") {
        return getAbbrevType(baseType, lookup);
    }
    if (baseType.tag === "DW_TAG_typedef") {
        let result = getAbbrevType(baseType, lookup);
        result.typeName = result.typeName || typeName;
        return result;
    }

    if (baseType.tag === "DW_TAG_structure_type" || baseType.tag === "DW_TAG_class_type") {
        // TODO: Calculate the size of the structure, and return a typed array large enough to hold it.
        //  And we could also encode the structure information here, allowing our javascript code to
        //  decode the object into a javascript object.

        return {
            object: true,
            typeName: typeName || "",
            type: "number",
        };
    }

    if (baseType.tag === "DW_TAG_pointer_type" || baseType.tag === "DW_TAG_array_type") {
        let result = getAbbrevType(baseType, lookup);
        if (!result) {
            // I am seeing this in cases like __cxa_allocate_exception. Not entire sure how to handle this.
            return {
                type: "any",
                typeName,
            };
        }
        if (result.subFunction) {
            // Functions are pointers, but that doesn't mean they should really be pointers, it is just an irrelevant detail.
            return result;
        }

        if (result.object) {
            result.typeName = result.typeName + "*";
            return result;
        }

        typeName = typeName || result.typeName;

        /*
        if(!typeName) {
            console.error("Invalid abbrev with no typeName");
            logAbbrevInst(baseType, undefined, undefined, lookup);
        }
        //*/

        typeName = typeName || "NO_TYPE_FOUND";

        let subrangeAbbrev = baseType.children.filter((x) => x.tag === "DW_TAG_subrange_type")[0];
        if (subrangeAbbrev) {
            let countValue = getAttValue(subrangeAbbrev, "DW_AT_count");
            if (countValue) {
                result.count = countValue;
            }
        }

        let { signed, float, byteWidth } = typeNameToSize(typeName);

        if (result.count) {
            result.size = byteWidth * result.count;
        }

        result.byteWidth = byteWidth;
        result.signed = signed;
        result.float = float;

        result.pointer = true;
        result.typeName = typeName + "*";
        let typedArray = getTypedArrayCtorFromMemoryObj(result);
        result.type = typedArray ? typedArray.name : "Buffer";

        return result;
    }
    if (baseType.tag === "DW_TAG_subroutine_type") {
        let returnType = getAbbrevType(baseType, lookup);

        let parameters = baseType.children
            .filter((x) => x.tag === "DW_TAG_formal_parameter")
            .map((x) => getAbbrevType(x, lookup));

        return {
            type: `(${parameters.map((x) => `${x.typeName}: ${x.type}`).join(", ")}) => ${returnType.type}`,
            typeName,
            subFunction: true,
        };
    }

    typeName = getAttValue(baseType, "DW_AT_name");

    let encoding = getAttValue(baseType, "DW_AT_encoding");
    let type = "any";
    if (encoding === 0x01) type = "number";
    if (encoding === 0x02) type = "boolean";
    if (encoding === 0x03) type = "number";
    if (encoding === 0x04) type = "number";
    if (encoding === 0x05) type = "number";
    if (encoding === 0x06) type = "number";
    if (encoding === 0x07) type = "number";
    if (encoding === 0x08) type = "number";
    if (encoding === 0x09) type = "number";
    if (encoding === 0x0a) type = "number";
    if (encoding === 0x0b) type = "number";
    if (encoding === 0x0c) type = "number";
    if (encoding === 0x0d) type = "number";
    if (encoding === 0x0e) type = "number";
    if (encoding === 0x0f) type = "number";

    if (type === "any") {
        console.log("Can't get type for abbrev", { type, typeName });
        logAbbrevInst(baseType, undefined, undefined, lookup);
        logAbbrevInst(abbrev, undefined, undefined, lookup);
    }

    return { type, typeName };
}

export type FunctionExport = {
    name: string;
    demangledName: string;
    javascriptTypeNames: { name: string; type: AbbrevType }[];
    returnType: AbbrevType;
    fncId: number;
    elemId: number | undefined;
}
export function getWasmFunctionExports(wasmFile: Buffer): FunctionExport[] {
    // TODO: Actually just use getExportNames, and then augment it with DWARF info if it exists, that way
    //  this code will mostly work with just a WASM file.

    let sections = getSections(wasmFile);

    let { instances, lookup } = getDwarfAbbrevs(sections);

    let elemEntries = getElemEntries(wasmFile);
    let elemInvertLookup = Object.create(null);
    for (let elemId in elemEntries) {
        let fncId = elemEntries[elemId];
        elemInvertLookup[fncId] = elemId;
    }

    let fncExportsInverted = getExportNames(sections);
    let fncExports = Object.create(null);
    for (let fncId in fncExportsInverted) {
        let fncName = fncExportsInverted[fncId];
        fncExports[fncName] = +fncId;
    }

    let functionExportsLookup: {
        name: string;
        demangledName: string;
        javascriptTypeNames: { name: string; type: AbbrevType }[];
        returnType: AbbrevType;
        fncId: number;
        elemId: number | undefined;
    }[] = [];

    let externalAbbrevs = instances[0].children.filter((x) => x.attributes.some((y) => y.name === "DW_AT_external"));
    for (let abbrev of externalAbbrevs) {
        let name = getAttValue(abbrev, "DW_AT_name");

        if (abbrev.tag === "DW_TAG_subprogram") {
            let abbrevParams = abbrev.children.filter((x) => x.tag === "DW_TAG_formal_parameter");

            let javascriptTypeNames = abbrevParams.map((x) => {
                let name = getAttValue(x, "DW_AT_name");
                let type = getAbbrevType(x, lookup);
                return { name, type };
            });

            let returnType = getAbbrevType(abbrev, lookup) || { type: "void", typeName: undefined };

            let mangledName = getAttValue(abbrev, "DW_AT_linkage_name") || name;

            if (mangledName in fncExports) {
                //line = `export declare function ${name}(${javascriptTypeNames}): ${returnType};`;
                let fncId = fncExports[mangledName];
                let fncObj = {
                    name: mangledName, demangledName: name, javascriptTypeNames, returnType, fncId,
                    elemId: undefined,
                };

                if (fncId in elemInvertLookup) {
                    fncObj.elemId = elemInvertLookup[fncId];
                }
                functionExportsLookup[mangledName] = fncObj;

                //functionExports.push(fncObj);
            }
        }
        // TODO: Do something like this in getWasmMemoryExports, to add better type information (to get the actual array type, at least for commenting purposes)
        /* else if(abbrev.tag === "DW_TAG_variable") {

            let typeString = "any";

            line = `export declare const ${name}: ${typeString};`;
        }*/
    }

    return Object.values(functionExportsLookup);
}

function getElemEntries(wasmFile: Buffer) {
    let sections = getSections(wasmFile);

    let elementLookup = Object.create(null);

    let elementSections = sections.filter((x) => x.sectionId === 9);
    for (let elemSection of elementSections) {
        curIndex = 0;
        curBuffer = elemSection.contents;

        let count = parseLeb128();
        while (curIndex < curBuffer.length) {
            let tableidx = parseLeb128();

            let expressionType = curBuffer[curIndex++];
            // Only expect i32.const values here, as this is the location in memory of the export.
            if (expressionType !== 0x41) {
                throw new Error(`Unexpected expression in globals ${expressionType.toString(16)}`);
            }
            let tableOffset = parseLeb128();
            let endOpcode = parseLeb128();
            if (endOpcode !== 0x0b) {
                throw new Error(
                    `Globals has an expression longer than expected. I haven't seen this before, and this will require more complicated parsed to get the memory location of the global exports`
                );
            }

            let fncCount = parseLeb128();

            for (let i = 0; i < fncCount; i++) {
                let tableIndex = tableOffset + i;
                let fncidx = parseLeb128();
                elementLookup[tableIndex] = fncidx;
            }
        }
    }

    return elementLookup;
}

function setElemEntries(wasmFile: Buffer, entries: Record<number, number>) {
    let sections = getSections(wasmFile);

    let oldEntries = getElemEntries(wasmFile);
    //entries = oldEntries;

    sections = sections.filter((x) => x.sectionId !== 9);

    let elemKVPs = [];
    for (let elemId in entries) {
        elemKVPs.push({ elemId: +elemId, fncId: entries[elemId] });
    }
    // These need to be sorted
    elemKVPs.sort((a, b) => a.elemId - b.elemId);

    if (elemKVPs.length === 0) {
        return wasmFile;
    }

    //elemKVPs = elemKVPs.slice(0, 3);

    let entryBuffers = [];
    /*
    for(let { elemId, fncId } of elemKVPs) {
        entryBuffers.push(Buffer.concat([
            leb128Encode(0),
            Buffer.from([0x41]),
            leb128Encode(elemId),
            Buffer.from([0x0b]),
            leb128Encode(1),
            leb128Encode(fncId)
        ]));
    }
    //*/

    // We could also emit it using the list style that elem supports, but... why?
    //*
    entryBuffers.push(
        Buffer.concat([
            leb128Encode(0),
            Buffer.from([0x41]),
            leb128Encode(elemKVPs[0].elemId),
            Buffer.from([0x0b]),
            leb128Encode(elemKVPs.length),
            ...elemKVPs.map((x) => leb128Encode(x.fncId)),
        ])
    );
    //*/

    let elemSection = Buffer.concat([leb128Encode(entryBuffers.length), ...entryBuffers]);

    sections.push({ sectionId: 9, contents: elemSection, offset: 0 });

    // There should be exactly one table, one one table section
    let table = sections.filter((x) => x.sectionId === 4)[0];
    {
        curIndex = 0;
        curBuffer = table.contents;

        if (curBuffer[curIndex] !== 1) {
            throw new Error(`More tables than expected. Expected 1, found ${curBuffer[curIndex]}`);
        }
        curIndex++;
        // Constant here
        curIndex++;

        let deltaTableSize = elemKVPs.length - Object.keys(oldEntries).length;

        let limitsType = curBuffer[curIndex++];
        if (limitsType === 0) {
            let min = curBuffer[curIndex++];
            min += deltaTableSize;
            table.contents = Buffer.concat([Buffer.from([0x00, 0x70, 0x01]), leb128Encode(min)]);
        } else if (limitsType === 1) {
            let min = curBuffer[curIndex++];
            let max = curBuffer[curIndex++];
            min += deltaTableSize;
            max += deltaTableSize;
            table.contents = Buffer.concat([Buffer.from([0x01, 0x70, 0x01]), leb128Encode(min), leb128Encode(max)]);
        }
    }

    return joinSections(sections);
}

export function elemAllFunctions(wasmFile: Buffer) {
    let fncExports = getWasmFunctionExports(wasmFile);
    let elemEntries = getElemEntries(wasmFile);

    let nextElemIndex =
        Object.keys(elemEntries)
            .map((x) => +x)
            .reduce((x, y) => Math.max(x, y), 0) + 1;

    let elemInvertLookup = Object.create(null);
    for (let elemId in elemEntries) {
        let fncId = elemEntries[elemId];
        elemInvertLookup[fncId] = elemId;
    }

    for (let fncObj of fncExports) {
        if (fncObj.fncId in elemInvertLookup) continue;
        elemEntries[nextElemIndex++] = fncObj.fncId;
    }

    //return wasmFile;
    return setElemEntries(wasmFile, elemEntries);
}

function getImportsRaw(wasmFile: Buffer, testImportDesc = 0) {
    let sections = getSections(wasmFile);

    let importLookup = Object.create(null);

    let importSections = sections.filter((x) => x.sectionId === 2);
    for (let importSection of importSections) {
        curIndex = 0;
        curBuffer = importSection.contents;

        let count = parseLeb128();
        while (curIndex < curBuffer.length) {
            let modName = parseVector(() => curBuffer[curIndex++])
                .map((x) => String.fromCharCode(x))
                .join("");
            let importName = parseVector(() => curBuffer[curIndex++])
                .map((x) => String.fromCharCode(x))
                .join("");

            let importDesc = curBuffer[curIndex++];
            let importId = parseLeb128();

            if (importDesc === testImportDesc && modName === "env") {
                importLookup[importName] = importId;
            }
        }
    }

    return importLookup;
}

function parseTypesSection(wasmFile: Buffer) {
    let types = [];

    let sections = getSections(wasmFile);
    let typesSections = sections.filter((x) => x.sectionId === 1);
    for (let typesSection of typesSections) {
        curIndex = 0;
        curBuffer = typesSection.contents;

        let count = parseLeb128();
        while (curIndex < curBuffer.length) {
            let specialValue = curBuffer[curIndex++];
            if (specialValue !== 0x60) {
                throw new Error(`Expected 0x60 before function type, found ${specialValue}`);
            }

            let parameters = parseVector(() => curBuffer[curIndex++]);
            let results = parseVector(() => curBuffer[curIndex++]);

            types.push({
                parameters,
                results,
            });
        }
    }

    return types;
}

type ImportEntry = {
    name: string;
    javascriptTypeNames: { name: string; type: AbbrevType }[];
    returnType: AbbrevType;
}
export function getWasmImports(wasmFile: Buffer): ImportEntry[] {
    // TODO: Add argument names.
    //  It doesn't appear as if the DWARF file has information on imports (they don't appear in the executable,
    //      as they are externs, so there is not binary code to annotate? Or something?).
    //  But, we can always run clang-query, and then... probably add our DWARF annotations (it is a flexible format,
    //      I'm sure we can figure out some way to add it), and parse that ourself. It wouldn't be great,
    //      but it would work.

    let importsList = [];

    let imports = getImportsRaw(wasmFile);
    let types = parseTypesSection(wasmFile);

    function formatTypeNum(typeNum: number, index: number, prefix: string) {
        return {
            name: prefix + index,
            type: {
                type: "number",
                typeName:
                    typeNum === 0x7f
                        ? "i32"
                        : typeNum === 0x7e
                            ? "i64"
                            : typeNum === 0x7d
                                ? "f32"
                                : typeNum === 0x7c
                                    ? "f64"
                                    : `type_${typeNum}`,
            },
        };
    }

    for (let importName in imports) {
        if (importName.startsWith("SHIM__")) continue;

        let type = types[imports[importName]];

        // return { type, typeName };
        // { name, type }

        if (type.results.length > 1) {
            throw new Error(
                `Import requires a function with multiple return types, but javascript does not support multiple return statements, so we can't satisify this import. ${importName}`
            );
        }

        let returnType =
            type.results.length === 0
                ? { type: "void", typeName: undefined }
                : formatTypeNum(type.results[0], 0, "return").type;

        importsList.push({
            name: importName,
            javascriptTypeNames: type.parameters.map((x, index) => formatTypeNum(x, index, "arg")),
            returnType,
        });
    }

    return importsList;
}

export function getTypedArrayCtorFromMemoryObj(memoryObj: {
    float: boolean;
    byteWidth: number;
    signed: boolean;
}): {
    new(buffer: ArrayBuffer, byteOffset: number, length: number): (
        Float32Array |
        Float64Array |
        Uint8Array |
        Uint16Array |
        Uint32Array |
        BigUint64Array |
        Int8Array |
        Int16Array |
        Int32Array |
        BigInt64Array
    );
} {
    if (memoryObj.float) {
        if (memoryObj.byteWidth === 4) {
            return Float32Array;
        } else if (memoryObj.byteWidth === 8) {
            return Float64Array;
        }
    } else if (!memoryObj.signed) {
        if (memoryObj.byteWidth === 1) {
            return Uint8Array;
        } else if (memoryObj.byteWidth === 2) {
            return Uint16Array;
        } else if (memoryObj.byteWidth === 4) {
            return Uint32Array;
        } else if (memoryObj.byteWidth === 8) {
            return BigUint64Array;
        }
    } else {
        if (memoryObj.byteWidth === 1) {
            return Int8Array;
        } else if (memoryObj.byteWidth === 2) {
            return Int16Array;
        } else if (memoryObj.byteWidth === 4) {
            return Int32Array;
        } else if (memoryObj.byteWidth === 8) {
            return BigInt64Array;
        }
    }
    throw new Error(`Unhandled typed array type ${memoryObj.float}, ${memoryObj.byteWidth}, ${memoryObj.signed}`);
}