#include <stdio.h>
typedef struct { int zSRgcXawOc; } YrfIFupfNJ;
typedef struct { YrfIFupfNJ RDrtxWodFk; int *xFnanFNwrO; } dqZHEzAAjF;
static dqZHEzAAjF SLdBjKvvTQ(dqZHEzAAjF zSRgcXawOc) {
    zSRgcXawOc.RDrtxWodFk.zSRgcXawOc += 10;
    *zSRgcXawOc.xFnanFNwrO += 5;
    return zSRgcXawOc;
}
int main(void) {
    int LstVpKEekl = 100;
    dqZHEzAAjF YuUIaVYKnR = {.RDrtxWodFk = {.zSRgcXawOc = 3}, .xFnanFNwrO = &LstVpKEekl};
    dqZHEzAAjF HovMjLHkSj = SLdBjKvvTQ(YuUIaVYKnR);
    HovMjLHkSj.RDrtxWodFk.zSRgcXawOc += 1;
    *HovMjLHkSj.xFnanFNwrO += 2;
    printf("%d %d %d\n", YuUIaVYKnR.RDrtxWodFk.zSRgcXawOc, HovMjLHkSj.RDrtxWodFk.zSRgcXawOc, LstVpKEekl);
    printf("%d %d\n", YuUIaVYKnR.xFnanFNwrO == HovMjLHkSj.xFnanFNwrO, *YuUIaVYKnR.xFnanFNwrO);
    return 0;
}
