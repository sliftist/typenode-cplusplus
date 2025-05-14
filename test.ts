import { getBinaryPath } from "clang-wasm";
import child_process from "child_process";
import fs from "fs";
import * as dwarfParser from "./src/dwarfParser";
import * as wasmCompiler from "./src/wasmWrapper";
import { compileCpp } from "./src/compileCPP";
import { createTypings } from "./src/createTypings";
import debugbreak from "debugbreak";
import { register } from "./index";
import { watchFilesAndTriggerHotReloading } from "socket-function/hot/HotReloadController";

register();

import { test, data, addStatic, exampleAdd, hotReloadTest } from "./test.cpp";

watchFilesAndTriggerHotReloading();

console.log(`Maybe = ${test()}`);
data[0] = 1;
console.log(`Maybe = ${test()}`);

console.log({ test });

let result = addStatic(1, 2);
console.log({ result });
data[0] = 1;
data[1] = 2;
data[2] = 3;
data[3] = 4;
data[4] = 5;
let addResult = exampleAdd(5);
console.log({ addResult });

setInterval(() => {
    console.log(`Test = ${hotReloadTest()}`);
}, 1000);


//  9) Update our clang version
//      - Find one where we can get binaries on all platforms
//  9.1) Get exceptions working (as apparently clang has added support for them
//      - We need to implement some functions.
/*
        clang++ -target wasm32 -nostdlib \
        -fwasm-exceptions \
        -mllvm -wasm-enable-eh \
        -exception-model=wasm \
        your_code.cpp -o your_output.wasm
*/
// Also, see old note  from 6 years ago...
// We should use __attribute((used)) instead of __attribute__((visibility("default"))). This will let us get rid of the
//  `-Wl,--export-dynamic` and `-fvisibility=hidden` flags.
//  - HOWEVER, this requires an update to clang 9, which changed exception handling in a way which appears to break it.
//      Once the -fwasm-exceptions change is released (https://reviews.llvm.org/D67208) it should be easier to
//      handle exceptions.

// 10) Try C++20, using "export", seeing if we can detect these (in DWARF, etc), and use them instead.


// 11) Update the clang deployment for linux AND osx
// 11) Test on linux, to make sure our clang deployments work


//  6) Test in video-player what happens if typenode-cplusplus
//          is used AND the older typenode is used. How typenode breaks when we have
//          incompatible dependencies.
//          - We should probably throw? And then test fixing it via a "resolutions" in
//              the package.json (which is the only viable production fix).
// For example:
// {
//   "overrides": {
//     "lodash": "4.17.21"
//   },
//   "resolutions": {
//     "**/lodash": "4.17.21"
//     }
// }



//  9) publish, and test in video-player
//  10) Ensure CPP runs clientside as well (I assume it will... it is just javascript)
//  11) Back to eac3, to get eac3 code working in NodeJS
//      - We need to remove all memory allocation, which... should be pretty easy, I think? We can just
//          use preallocated memory, indexing it, and resetting it at the start of every run. We can
//          even have this just take the form of malloc.