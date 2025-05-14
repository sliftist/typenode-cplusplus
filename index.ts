// IMPORTANT!
//  - We DO NOT support returning objects. BUT, we DO support
//      exporting static arrays of primitives. THIS allows you to return
//      many values (as you set them in your exported arrays).
//      - We also support returning pointers.
//  - We also DO NOT support object arguments. Instead, export a buffer from C++,
//      and access and set it in javascript.

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

import { compileCpp } from "./src/compileCPP";
import { createTypings } from "./src/createTypings";
import fs from "fs";
import * as typenode from "typenode";
import { inlineWASMSourceMap } from "./src/inlineWASMSourceMap";

typenode.transformAdditionalExtensions([".cpp"]);

typenode.compileTransform2({
    early: true,
    matches: [/.cpp$/],
    transform: (code, inputPath, module) => {
        console.log(`Transforming ${inputPath}`);

        let wasm = compileCpp({ inputPath, debug: true });
        let typings = createTypings(wasm);
        fs.writeFileSync(inputPath + ".d.ts", typings);

        wasm = inlineWASMSourceMap(wasm);

        let wasmCompilerPath = require.resolve("./src/wasmWrapper");

        function runtimeShim(wasmBase64: string, wasmCompilerPath: string) {
            // It's a bit iffy to make these files hot reloadable. They can absolutely have state.
            //  But... hot reloading has to be turned on globally anyways (so this flag won't break production),
            //  and... considering we don't let wasm modules import anything, this is not so bad (and very useful).
            module.hotreload = true;

            let wasm = Buffer.from(wasmBase64, "base64");
            const wasmCompiler = require(wasmCompilerPath);
            let wasmModule = wasmCompiler.compileWasm(wasm);
            Object.assign(module.exports, wasmModule);
        }
        return `(${runtimeShim})(${JSON.stringify(wasm.toString("base64"))}, ${JSON.stringify(wasmCompilerPath)});`;
    },
});

export function register() {
    // We don't need to run anything, we register when this file is imported. However,
    //  having an export, makes importing this file easier.
}
