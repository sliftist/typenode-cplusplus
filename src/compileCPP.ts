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
        `-H`,
        `-Wl,--no-entry`,
        // We REALLY want to set the stack size, but there is no option for this: https://lld.llvm.org/WebAssembly.html
        //   We COULD set initial-memory, but... even if we pick a high value it MIGHT still be smaller than the static
        //      data... So... we're just fucked. The user better not put too much on the stack, because if they
        //      do, they will get weird errors. Ugh...
        //`-Wl,--initial-memory=${65536 * 1100}`,
        //`-Wl,--max-memory=${65536 * 10000}`,
        // This might help us fail faster if we run out of stack space? Although it shouldn't,
        //  one would think it would cause us to fail later, and we should have the stack at the
        //  end of the memory? But... with the stack at the end, we still don't always fail
        //  when we exceed it, so... I don't know.
        `-Wl,--stack-first`,

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
