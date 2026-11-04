#include <stdio.h>
int main(void) {
    int wOLFogKwvB = 10, YdEHnJnVxA = 20;
    int *DmYNgUPBAU = &wOLFogKwvB;
    int **qOIVFAkolc = &DmYNgUPBAU;
    int ***xbjZAYtYXY = &qOIVFAkolc;
    **qOIVFAkolc += 5;
    printf("%d %d %d\n", wOLFogKwvB, **qOIVFAkolc, ***xbjZAYtYXY);
    **xbjZAYtYXY = &YdEHnJnVxA;
    ***xbjZAYtYXY += 7;
    printf("%d %d %d\n", wOLFogKwvB, YdEHnJnVxA, *DmYNgUPBAU);
    int *TTqGkBowXr = &wOLFogKwvB;
    *xbjZAYtYXY = &TTqGkBowXr;
    ***xbjZAYtYXY = 99;
    printf("%d %d %d %d\n", wOLFogKwvB, YdEHnJnVxA, *DmYNgUPBAU, **qOIVFAkolc);
    printf("%d %d %d\n", qOIVFAkolc == &TTqGkBowXr, DmYNgUPBAU == &YdEHnJnVxA, *xbjZAYtYXY == qOIVFAkolc);
    return 0;
}
