// IMPORTANT!
//  - We DO NOT support returning objects. BUT, we DO support
//      exporting static arrays of primitives. THIS allows you to return
//      many values (as you set them in your exported arrays).
//      - We also support returning pointers.
//  - We also DO NOT support object arguments. Instead, export a buffer from C++,
//      and access and set it in javascript.

import type { FunctionExport } from "./src/dwarfParser";

// TODO: Support some way to get flags, to compile NOT in debug mode.
//  - For now it's fine. This project is 99% to allow usage of some very large
//      C++ projects in the browser. If we wanted speed, we would probably offload
//      the code to a server.

// IMPORTANT! #includes ARE NOT SUPPORTED! They will break the cache, so you just shouldn't use them!
//      TODO: If we do want imports, and multiple .cpp files... we can do it by using a regex
//          to check for #include, and then look for corresponding .cpp files.
//          - BUT, we also need to add a function to compileTransform2 to do this
//               to give us file dependencies, so we can create the cache key
//          - AND, we should store the file dependencies in the module, and update
//              hot reloading to use them as well!

//  TODO: If we need callbacks, we can expose a lot (~100) of functions to the WASM module
//      when creating it, and then per function call we could assign callback functions to
//      each, recording the mapping. This way, for the duration of the function call,
//      callbacks will work. We can't store them though, as then we could exhaust our
//      count of functions...
//      - Or really, the function shells will just be
/*
    function createShell() {
        let obj = { callback: () => undefined };
        function fnc(...args) { return obj.callback(...args); }
        return {
            fnc,
            obj,
        };
    }

    let shells = list(100).map(() => createShell());

    // Later, when replacing the arguments

    let shell = shells[0];
    shell.obj.callback = fncArg;
    fncArg = shell.fnc;
*/

export function register() {
    // We don't need to run anything, we register when this file is imported. However,
    //  having an export, makes importing this file easier.
}
if (typeof document === "undefined") {
    const { compileCpp } = require("./src/compileCPP");
    const { createTypings } = require("./src/createTypings");
    const fs = require("fs");
    const typenode = require("typenode");
    const { inlineWASMSourceMap } = require("./src/inlineWASMSourceMap");
    const { getWasmMemoryExports, getWasmFunctionExports, getWasmImports, getTypedArrayCtorFromMemoryObj } = require("./src/dwarfParser");

    typenode.transformAdditionalExtensions([".cpp", ".c"]);

    typenode.compileTransform2({
        early: true,
        matches: [/.cpp$/, /.c$/],
        transform: (code: string, inputPath: string, module: any) => {
            let wasm = compileCpp({ inputPath, debug: true });
            // Very useful for debugging
            fs.writeFileSync(inputPath + ".wasm", wasm);
            let typings = createTypings(wasm);
            fs.writeFileSync(inputPath + ".d.ts", typings);

            wasm = inlineWASMSourceMap(wasm);

            let memoryExports = getWasmMemoryExports(wasm);
            let functionExports = getWasmFunctionExports(wasm);

            let memoryList: {
                exportName: string;
                address: number;
                size: number;
                byteWidth: number;
                TypeArrayCtorName: string;
            }[] = [];
            for (let exportName in memoryExports) {
                let memoryObj = memoryExports[exportName];
                let TypedArrayCtor = getTypedArrayCtorFromMemoryObj(memoryObj);
                memoryList.push({
                    exportName,
                    address: memoryObj.address,
                    size: memoryObj.size,
                    byteWidth: memoryObj.byteWidth,
                    TypeArrayCtorName: TypedArrayCtor.name,
                });
            }

            function runtimeShim(config: {
                wasmBase64: string;
                memoryList: {
                    exportName: string;
                    address: number;
                    size: number;
                    byteWidth: number;
                    TypeArrayCtorName: string;
                }[];
                functionExports: FunctionExport[];
            }) {
                // It's a bit iffy to make these files hot reloadable. They can absolutely have state.
                //  But... hot reloading has to be turned on globally anyways (so this flag won't break production),
                //  and... considering we don't let wasm modules import anything, this is not so bad (and very useful).
                module.hotreload = true;
                const { wasmBase64, memoryList, functionExports } = config;

                let wasm = Buffer.from(wasmBase64, "base64");
                // An object where we put all the exports, once they are loaded
                let exportsObj = Object.create(null);

                let instances = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
                    env: {
                        __throwLastError: () => {
                            doThrowIfThrown();
                        }
                    },
                });
                let baseExports = instances.exports as {
                    [key: string]: any;
                    memory: WebAssembly.Memory;
                };

                function doThrowIfThrown() {
                    let lastError = exportsObj.__internal__lastError as Buffer;
                    if (!lastError[0]) return;
                    let error = "";
                    for (let i = 0; i < lastError.length; i++) {
                        if (lastError[i] === 0) break;
                        error += String.fromCharCode(lastError[i]);
                    }
                    lastError[0] = 0;
                    throw new Error(error);
                }

                let rawMemory = baseExports.memory.buffer;
                for (let memory of memoryList) {
                    let { exportName, address, size, byteWidth, TypeArrayCtorName } = memory;
                    let TypedArrayCtor = globalThis[TypeArrayCtorName as "Float32Array"];
                    exportsObj[exportName] = new TypedArrayCtor(rawMemory, address, Math.round(size / byteWidth));
                }

                for (let fncExport of functionExports) {
                    let baseFnc = baseExports[fncExport.name];
                    exportsObj[fncExport.demangledName] = baseFnc;
                }

                Object.assign(module.exports, exportsObj);
            }
            return `(${runtimeShim})(
                ${JSON.stringify({
                wasmBase64: wasm.toString("base64"),
                functionExports,
                memoryList,
            })}
            );`;
        },
    });
}