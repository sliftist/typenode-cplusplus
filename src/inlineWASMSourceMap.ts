import * as dwarfParser from "./dwarfParser";
import { replaceSourceMapURL } from "./dwarfParser";

/** NOTE: Creates the sourcemap from the DWARF information in the wasm binary.
 *      If it wasn't created in debug flag, this likely won't yield
 *      good sourcemaps (or no sourcemaps).
 */
export function inlineWASMSourceMap(wasm: Buffer) {
    let sourceMap = dwarfParser.generateSourceMap(wasm);
    if (!sourceMap) {
        return wasm;
    }
    let sourceMapUrl = "data:application/json;base64," + Buffer.from(JSON.stringify(sourceMap)).toString("base64");
    return replaceSourceMapURL(wasm, () => sourceMapUrl);
}
