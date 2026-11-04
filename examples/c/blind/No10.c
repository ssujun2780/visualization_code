#include <stdio.h>
#include <stddef.h>

int main(void) {
    int HPeXInwpAi = 10;
    int xvuSROewsQ = 20;
    int *FFYmJFktNL = &HPeXInwpAi;
    int *DpPLnUfCSl = FFYmJFktNL;

    printf("%d %d %d\n", HPeXInwpAi, *FFYmJFktNL, *DpPLnUfCSl);

    *FFYmJFktNL += 5;
    printf("%d %d %d\n", HPeXInwpAi, *FFYmJFktNL, *DpPLnUfCSl);

    DpPLnUfCSl = &xvuSROewsQ;
    *DpPLnUfCSl = *FFYmJFktNL + 7;
    printf("%d %d %d %d\n", HPeXInwpAi, xvuSROewsQ, *FFYmJFktNL, *DpPLnUfCSl);

    int gfMcgAsnQZ[4] = {3, 6, 9, 12};
    int *wnBblBdLBE = gfMcgAsnQZ;
    int *MXkcXEpvuf = wnBblBdLBE + 2;

    *MXkcXEpvuf = *wnBblBdLBE + 20;
    printf("%d %d %d %d\n", gfMcgAsnQZ[0], gfMcgAsnQZ[1], gfMcgAsnQZ[2], gfMcgAsnQZ[3]);
    printf("%td %d\n", MXkcXEpvuf - wnBblBdLBE, MXkcXEpvuf == &gfMcgAsnQZ[2]);

    wnBblBdLBE++;
    *wnBblBdLBE += *MXkcXEpvuf;
    printf("%d %d %d %d\n", gfMcgAsnQZ[0], gfMcgAsnQZ[1], gfMcgAsnQZ[2], gfMcgAsnQZ[3]);
    printf("%td\n", MXkcXEpvuf - wnBblBdLBE);

    MXkcXEpvuf = gfMcgAsnQZ + 4;
    printf("%td %d\n", MXkcXEpvuf - gfMcgAsnQZ, MXkcXEpvuf == &gfMcgAsnQZ[4]);
    return 0;
}
