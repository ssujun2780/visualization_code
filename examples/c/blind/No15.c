#include <stdio.h>
static int bvgZspNKfR = 0;
static int gFZOtGxTzp(int CFaEMYYdzm) {
    ++bvgZspNKfR;
    if (CFaEMYYdzm < 2) return CFaEMYYdzm;
    int REObRUELlo = gFZOtGxTzp(CFaEMYYdzm - 1);
    int QcFiQonoyk = gFZOtGxTzp(CFaEMYYdzm - 2);
    return REObRUELlo + QcFiQonoyk;
}
int main(void) {
    int nfEzPArnku = gFZOtGxTzp(6);
    printf("%d %d\n", nfEzPArnku, bvgZspNKfR);
    return 0;
}
