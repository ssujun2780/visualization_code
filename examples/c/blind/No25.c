#include <stdio.h>
typedef struct { int xvXkwVOdvB, rAqnFgzgWR; } RrBFMWeJCR;
int main(void) {
    RrBFMWeJCR ZRJHIKVgFs[5] = {{3, 0}, {1, 1}, {2, 2}, {1, 3}, {3, 4}};
    for (size_t lLMFySveKn = 1; lLMFySveKn < 5; ++lLMFySveKn) {
        RrBFMWeJCR CtbmMvJqQE = ZRJHIKVgFs[lLMFySveKn];
        size_t OmXaQdmKzG = lLMFySveKn;
        while (OmXaQdmKzG > 0 && ZRJHIKVgFs[OmXaQdmKzG - 1].xvXkwVOdvB > CtbmMvJqQE.xvXkwVOdvB) {
            ZRJHIKVgFs[OmXaQdmKzG] = ZRJHIKVgFs[OmXaQdmKzG - 1];
            --OmXaQdmKzG;
        }
        ZRJHIKVgFs[OmXaQdmKzG] = CtbmMvJqQE;
    }
    for (size_t lLMFySveKn = 0; lLMFySveKn < 5; ++lLMFySveKn)
        printf("%d:%d%c", ZRJHIKVgFs[lLMFySveKn].xvXkwVOdvB, ZRJHIKVgFs[lLMFySveKn].rAqnFgzgWR, lLMFySveKn == 4 ? '\n' : ' ');
    return 0;
}
