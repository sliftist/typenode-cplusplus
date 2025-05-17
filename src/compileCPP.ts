let thread = Date.now() + Math.random();
import { getBinaryPath } from "clang-wasm";
import child_process from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
export function compileCpp(config: {
    inputPath: string;
    debug?: boolean;
}): Buffer {
    const { inputPath, debug } = config;
    let tempOutputPath = os.tmpdir() + `/temp-${thread}.wasm`;
    let libPath = path.resolve(__dirname + "/../library.cpp");
    let parameters = [
        `--target=wasm32`,
        `-nostdlib`,
        // Apparently nostdlib makes the stack something stupidly small, as in,
        //  256KB, which breaks so many programs...
        `-Wl,--stack-size=8388608`,
        `-H`,
        `-Wl,--no-entry`,
        `-Wl,--export-dynamic`,
        `-fvisibility=hidden`,
        `-Wl,--allow-undefined`,
        `-fwasm-exceptions`,
        debug ? "-g" : `-Ofast`,
        //`-fmodules-ts`,
    ];
    // let version = child_process.execFileSync(getBinaryPath(), ["--version"]).toString();
    // console.log({ version });
    // clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all -o add2.wasm add2.cpp
    let result = child_process.execFileSync(getBinaryPath("clang"), parameters.concat([
        `-o`, tempOutputPath,
        inputPath,
        libPath
    ]));
    let buffer = fs.readFileSync(tempOutputPath);
    fs.unlinkSync(tempOutputPath);
    return buffer;
    // We can parse the files compiled from result? Maybe?
    //   - In order to handle dependencies for hot reloading.
    //console.log({ result: result.toString() });
}
