import { getWasmMemoryExports, getWasmFunctionExports, getWasmImports, getTypedArrayCtorFromMemoryObj } from "./dwarfParser";

export function compileWasm(webAssembly: Buffer): {
    [key: string]: ((...args: any[]) => any) | Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray;
} {
    // An object where we put all the exports, once they are loaded
    let exportsObj = Object.create(null);

    let importList = getWasmImports(webAssembly);
    console.log({ importList });

    let instances = new WebAssembly.Instance(new WebAssembly.Module(webAssembly), {
        env: {},
    });
    let baseExports = instances.exports as {
        [key: string]: any;
        memory: WebAssembly.Memory;
    };
    Object.assign(exportsObj, baseExports);

    let rawMemory = baseExports.memory.buffer;

    let memoryExports = getWasmMemoryExports(webAssembly);
    for (let exportName in memoryExports) {
        let memoryObj = memoryExports[exportName];
        let { size, address } = memoryObj;
        let TypedArrayCtor = getTypedArrayCtorFromMemoryObj(memoryObj);
        exportsObj[exportName] = new TypedArrayCtor(rawMemory, address, Math.round(size / memoryObj.byteWidth));
    }

    let functionExports = getWasmFunctionExports(webAssembly);
    for (let fncExport of functionExports) {
        exportsObj[fncExport.demangledName] = baseExports[fncExport.name];
    }

    return exportsObj;
}