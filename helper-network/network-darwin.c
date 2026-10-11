/* App-owned, unprivileged SystemConfiguration notification adapter. */
#include <CoreFoundation/CoreFoundation.h>
#include <SystemConfiguration/SystemConfiguration.h>
#include <stdio.h>

static void changed(SCDynamicStoreRef store, CFArrayRef keys, void *context) {
    (void)store;
    (void)context;
    if (CFArrayGetCount(keys) > 0) {
        puts("NETWORK_CHANGED");
        fflush(stdout);
    }
}

int main(void) {
    SCDynamicStoreRef store = SCDynamicStoreCreate(NULL, CFSTR("ShadowVPNNetworkEvents"), changed, NULL);
    if (!store) return 1;
    const void *pattern = CFSTR("State:/Network/(Global|Service/[^/]+)/(IPv4|IPv6)");
    CFArrayRef patterns = CFArrayCreate(NULL, &pattern, 1, &kCFTypeArrayCallBacks);
    Boolean ready = SCDynamicStoreSetNotificationKeys(store, NULL, patterns);
    CFRelease(patterns);
    if (!ready) { CFRelease(store); return 2; }
    CFRunLoopSourceRef source = SCDynamicStoreCreateRunLoopSource(NULL, store, 0);
    if (!source) { CFRelease(store); return 3; }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
    puts("NETWORK_READY");
    fflush(stdout);
    CFRunLoopRun();
    CFRelease(source);
    CFRelease(store);
    return 0;
}
