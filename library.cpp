#define EXPORT __attribute__((visibility("default")))


EXPORT char __internal__lastError[1024] = { 63, 62, 12, 5, 2, 5, 2 };

// External function to notify JS about errors
extern "C" void __throwLastError();

char __thrownMemory[1024];

// Minimal exception support - only for string messages
EXPORT extern "C" void* __cxa_allocate_exception(unsigned long thrown_size) {
    __internal__lastError[10]++;
    // We only support throwing string messages
    return __thrownMemory;
}

EXPORT extern "C" void __cxa_throw(void* thrown_exception, void* tinfo, void (*dest)(void*)) {
    // __internal__lastError[0] = 1;
    // __internal__lastError[1] = 2;
    char* error = *(char**)thrown_exception;
    int pos = 0;
    while (error[pos] && pos < sizeof(__internal__lastError) - 1) {
        __internal__lastError[pos] = error[pos];
        pos++;
    }
    __internal__lastError[pos] = '\0';
    
    __throwLastError();
}