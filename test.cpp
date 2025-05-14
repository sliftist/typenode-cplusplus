struct Example {
    int a;
    int b;
};

#define EXPORT __attribute__((visibility("default")))

EXPORT int data[1000] = { 99 };
EXPORT int test() {
    return data[0];
}
EXPORT int exampleAdd(int count) {
    int result = 0;
    for (int i = 0; i < count; i++) {
        result += data[i];
    }
    return result;
}

EXPORT int addStatic(int a, int b) {
    return a + b;
}


EXPORT int hotReloadTest() {
    return 13;
}