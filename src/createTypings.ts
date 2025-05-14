import { FunctionExport, getTypedArrayCtorFromMemoryObj, getWasmFunctionExports } from "./dwarfParser";

import { getWasmMemoryExports } from "./dwarfParser";

import { getWasmImports } from "./dwarfParser";

/** NOTE: The input must be from a debug build. */
export function createTypings(wasmFile: Buffer): string {
    let newTypingsFile = "";

    let memoryExports = getWasmMemoryExports(wasmFile);
    let functionExports = getWasmFunctionExports(wasmFile);

    newTypingsFile += `// AUTO GENERATED FILE, DO NOT EDIT DIRECTLY.\n`;
    newTypingsFile += "\n";


    newTypingsFile += getDefinitions(functionExports);

    return newTypingsFile;


    function getDefinitions(functions: FunctionExport[], indent = "", forObject?: boolean, noPromises?: boolean, noDefinitions?: boolean) {
        let definitions = "";

        let varPrefix = forObject ? "" : "export declare const ";
        let fncPrefix = forObject ? "" : "export declare function ";

        if (!noDefinitions) {

            for (let exportName in memoryExports) {
                let memoryObj = memoryExports[exportName];
                if (!memoryObj.typeName) continue;
                if (exportName.startsWith("SHIM__")) continue;
                let baseType = memoryObj.typeName.split("*")[0];

                let buffer = "";
                let typedArrayCtor = getTypedArrayCtorFromMemoryObj(memoryObj);
                if (typedArrayCtor) {
                    buffer = typedArrayCtor.name;
                }
                if (buffer === "") {
                    buffer = "Uint8Array";
                    console.error(`Value size does not correspond to a native typed array, ${memoryObj.float ? "float" : ""} ${memoryObj.signed ? "signed" : "unsigned"} byteWidth=${memoryObj.byteWidth}. Setting to Uint8Array`);
                }

                definitions += `${indent}/** ${baseType}[${memoryObj.count || 1}] */\n${indent}${varPrefix}${exportName}: ${buffer};\n`;
            }

            definitions += "\n";
        }

        if (functions.length === 0) {
            definitions += `// No exports found. The visiblity attribute is required on functions and variables to export them. Try adding __attribute__((visibility("default"))) to functions you wish to export.\n`;
        }

        for (let i = 0; i < functions.length; i++) {
            let functionObj = functions[i];
            let { name, demangledName, javascriptTypeNames, returnType } = functionObj;
            name = demangledName || name;
            let typeNamesStr = javascriptTypeNames.map(x => `${x.name}: ${x.type.type}`).join(", ");

            let docCommentLines = javascriptTypeNames.map(x => `@param {${x.type.type}} ${x.name} ${x.type.typeName}`);
            if (returnType.type !== "void") {
                if (noPromises) {
                    docCommentLines.push(`@returns {${returnType.type}} ${returnType.typeName}`);
                } else {
                    docCommentLines.push(`@returns {${returnType.type} | Promise<${returnType.type}>} ${returnType.typeName}`);
                }
            }

            if (noPromises) {
                definitions += `${indent}${fncPrefix}${name}(${typeNamesStr}): ${returnType.type};\n`;
            } else {
                definitions += `${indent}${fncPrefix}${name}(${typeNamesStr}): ${returnType.type} | Promise<${returnType.type}>;\n`;
            }
        }

        return definitions;
    }
}