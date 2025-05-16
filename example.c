#define EXPORT __attribute__((visibility("default")))

// EXPORT int test() {
//     throw "Test error3";
//     //return data[0];
// }

EXPORT char data2[50] = "Hello world 2";

EXPORT int data[1000] = { 998 };
EXPORT int exampleAdd(int count) {
    int result = 0;
    for (int i = 0; i < count; i++) {
        result += data[i];
    }
    return result;
}

typedef struct TestStruct {
    int a;
    int b;
} TestStruct;

EXPORT int addStatic(int a, int b) {
    TestStruct test;
    TestStruct* testPtr = &test;
    void* testPtrVoid = testPtr;
    TestStruct* testPtr2 = testPtrVoid;

    return a + b;
}

EXPORT int hotReloadTest3() {
    return 13;
}

