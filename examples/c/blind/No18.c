#include <stdio.h>
#include <string.h>
typedef enum { qxwGHFNFQH, ZBOUYOrbWx, WEwFnyfiCU } xzCjDzuaZc;
typedef union { int XtEdcbualB; double VNjFlgfIlP; char mhbktmDsdY[8]; } UnXzDfemEr;
typedef struct { xzCjDzuaZc NCsgaJxsXA; UnXzDfemEr FIbeTMFKer; } RFzxawJRYu;
int main(void) {
    RFzxawJRYu ZUuVddiXTX = {.NCsgaJxsXA = qxwGHFNFQH, .FIbeTMFKer = {.XtEdcbualB = 42}};
    RFzxawJRYu VGZSZiHKnE = ZUuVddiXTX;
    VGZSZiHKnE.NCsgaJxsXA = ZBOUYOrbWx;
    VGZSZiHKnE.FIbeTMFKer.VNjFlgfIlP = 2.5;
    printf("%d %.1f\n", ZUuVddiXTX.FIbeTMFKer.XtEdcbualB, VGZSZiHKnE.FIbeTMFKer.VNjFlgfIlP);
    ZUuVddiXTX.NCsgaJxsXA = WEwFnyfiCU;
    strcpy(ZUuVddiXTX.FIbeTMFKer.mhbktmDsdY, "xy");
    if (ZUuVddiXTX.NCsgaJxsXA == WEwFnyfiCU) puts(ZUuVddiXTX.FIbeTMFKer.mhbktmDsdY);
    printf("%d %d\n", sizeof(UnXzDfemEr) >= sizeof(double),
           sizeof(UnXzDfemEr) >= sizeof(int));
    return 0;
}
