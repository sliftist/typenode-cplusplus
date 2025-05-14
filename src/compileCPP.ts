import { getBinaryPath } from "clang-wasm";
import child_process from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
let thread = Date.now() + Math.random();
export function compileCpp(config: {
    inputPath: string;
    debug?: boolean;
}): Buffer {
    const { inputPath, debug } = config;
    let tempOutputPath = path.join(os.tmpdir(), `temp-${thread}.wasm`);
    let parameters = [
        `--target=wasm32`,
        `-nostdlib`,
        `-H`,
        `-Wl,--no-entry`,
        `-Wl,--export-dynamic`,
        `-fvisibility=hidden`,
        `-Wl,--allow-undefined`,
        debug ? "-g" : `-Ofast`,
    ];
    // clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all -o add2.wasm add2.cpp
    let result = child_process.execFileSync(getBinaryPath(), parameters.concat([
        `-o`,
        tempOutputPath,
        inputPath
    ]));
    let buffer = fs.readFileSync(tempOutputPath);
    fs.unlinkSync(tempOutputPath);
    return buffer;
    // We can parse the files compiled from result? Maybe?
    //   - In order to handle dependencies for hot reloading.
    //console.log({ result: result.toString() });
}