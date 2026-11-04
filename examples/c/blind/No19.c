#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>
typedef struct { unsigned int SaJqPAvWWm:3; unsigned int hykweIVeNV:5; unsigned int rWmnuumAgf:1; } RJoQEFrsBI;
int main(void) {
    RJoQEFrsBI uYZQiQuxup = {.SaJqPAvWWm = 3, .hykweIVeNV = 17, .rWmnuumAgf = 1};
    uYZQiQuxup.SaJqPAvWWm = 6;
    uYZQiQuxup.rWmnuumAgf = 0;
    printf("%u %u %u\n", (unsigned int)uYZQiQuxup.SaJqPAvWWm, (unsigned int)uYZQiQuxup.hykweIVeNV, (unsigned int)uYZQiQuxup.rWmnuumAgf);
    uint64_t pTOwevWRMe[2] = {0, 0};
    pTOwevWRMe[0] |= UINT64_C(1) << 3;
    pTOwevWRMe[1] |= UINT64_C(1) << 63;
    printf("%016" PRIx64 " %016" PRIx64 "\n", pTOwevWRMe[0], pTOwevWRMe[1]);
    pTOwevWRMe[0] &= ~(UINT64_C(1) << 3);
    printf("%d %d\n", pTOwevWRMe[0] == 0, (pTOwevWRMe[1] & (UINT64_C(1) << 63)) != 0);
    return 0;
}
