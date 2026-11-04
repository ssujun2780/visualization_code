#include <stdio.h>
#include <stdlib.h>
typedef struct HfAUxRQPqK HfAUxRQPqK;
struct HfAUxRQPqK { int uCCLrMjAOr; HfAUxRQPqK *GAreQBpnFU, *zsgJhMcyZU; };
static int nnvPzvKRqy(HfAUxRQPqK **mBdfTwtEiJ, int uCCLrMjAOr) {
    if (!*mBdfTwtEiJ) {
        HfAUxRQPqK *oTvYnbdNPD = malloc(sizeof *oTvYnbdNPD);
        if (!oTvYnbdNPD) return 0;
        *oTvYnbdNPD = (HfAUxRQPqK){.uCCLrMjAOr = uCCLrMjAOr, .GAreQBpnFU = NULL, .zsgJhMcyZU = NULL};
        *mBdfTwtEiJ = oTvYnbdNPD;
        return 1;
    }
    if (uCCLrMjAOr < (*mBdfTwtEiJ)->uCCLrMjAOr) return nnvPzvKRqy(&(*mBdfTwtEiJ)->GAreQBpnFU, uCCLrMjAOr);
    if (uCCLrMjAOr > (*mBdfTwtEiJ)->uCCLrMjAOr) return nnvPzvKRqy(&(*mBdfTwtEiJ)->zsgJhMcyZU, uCCLrMjAOr);
    return 1;
}
static void AyRrTjDHXG(HfAUxRQPqK **mBdfTwtEiJ, int uCCLrMjAOr) {
    HfAUxRQPqK *oTvYnbdNPD = *mBdfTwtEiJ;
    if (!oTvYnbdNPD) return;
    if (uCCLrMjAOr < oTvYnbdNPD->uCCLrMjAOr) AyRrTjDHXG(&oTvYnbdNPD->GAreQBpnFU, uCCLrMjAOr);
    else if (uCCLrMjAOr > oTvYnbdNPD->uCCLrMjAOr) AyRrTjDHXG(&oTvYnbdNPD->zsgJhMcyZU, uCCLrMjAOr);
    else if (oTvYnbdNPD->GAreQBpnFU && oTvYnbdNPD->zsgJhMcyZU) {
        HfAUxRQPqK *IIdSeKjErv = oTvYnbdNPD->zsgJhMcyZU;
        while (IIdSeKjErv->GAreQBpnFU) IIdSeKjErv = IIdSeKjErv->GAreQBpnFU;
        oTvYnbdNPD->uCCLrMjAOr = IIdSeKjErv->uCCLrMjAOr;
        AyRrTjDHXG(&oTvYnbdNPD->zsgJhMcyZU, IIdSeKjErv->uCCLrMjAOr);
    } else {
        *mBdfTwtEiJ = oTvYnbdNPD->GAreQBpnFU ? oTvYnbdNPD->GAreQBpnFU : oTvYnbdNPD->zsgJhMcyZU;
        free(oTvYnbdNPD);
    }
}
static void SNxJFdOIGH(const HfAUxRQPqK *oTvYnbdNPD) {
    if (!oTvYnbdNPD) return;
    SNxJFdOIGH(oTvYnbdNPD->GAreQBpnFU);
    printf("%d", oTvYnbdNPD->uCCLrMjAOr);
    SNxJFdOIGH(oTvYnbdNPD->zsgJhMcyZU);
}
static void XbkKjsFxtf(HfAUxRQPqK *oTvYnbdNPD) {
    if (!oTvYnbdNPD) return;
    XbkKjsFxtf(oTvYnbdNPD->GAreQBpnFU); XbkKjsFxtf(oTvYnbdNPD->zsgJhMcyZU); free(oTvYnbdNPD);
}
int main(void) {
    HfAUxRQPqK *mSgZuyLzMN = NULL;
    int mrrYVdtuyu[7] = {4, 2, 6, 1, 3, 5, 7};
    for (size_t qqLitHKOGd = 0; qqLitHKOGd < 7; ++qqLitHKOGd) {
        if (!nnvPzvKRqy(&mSgZuyLzMN, mrrYVdtuyu[qqLitHKOGd])) { XbkKjsFxtf(mSgZuyLzMN); return 1; }
    }
    SNxJFdOIGH(mSgZuyLzMN); putchar('\n');
    AyRrTjDHXG(&mSgZuyLzMN, 4);
    SNxJFdOIGH(mSgZuyLzMN); putchar('\n');
    printf("%d\n", mSgZuyLzMN->uCCLrMjAOr);
    AyRrTjDHXG(&mSgZuyLzMN, 1); AyRrTjDHXG(&mSgZuyLzMN, 6);
    SNxJFdOIGH(mSgZuyLzMN); putchar('\n');
    XbkKjsFxtf(mSgZuyLzMN);
    mSgZuyLzMN = NULL;
    return 0;
}
