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

import { data, data2, addStatic, exampleAdd } from "./example.c";

//watchFilesAndTriggerHotReloading();
console.log("Here");

//console.log(`Maybe = ${test()}`);
// data[0] = 1;
// console.log(`Maybe = ${test()}`);

// console.log({ test });

let result = addStatic(1, 2);
console.log({ result });
data[0] = 1;
data[1] = 2;
data[2] = 3;
data[3] = 4;
data[4] = 5;
let addResult = exampleAdd(5);
console.log({ addResult });

console.log(Buffer.from(data2).toString());