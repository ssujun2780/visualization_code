#include <stdio.h>
#include <stdlib.h>
typedef struct XlTCyNlNEs XlTCyNlNEs;
struct XlTCyNlNEs { int RCBmhGiQud; XlTCyNlNEs *FIspAuFgsL, *IdYlBSTGmP; };
static int yFvLGyxZaR(XlTCyNlNEs *KQwnTiaaRA, int RCBmhGiQud) {
    XlTCyNlNEs *CuKCcNwekV = malloc(sizeof *CuKCcNwekV);
    if (!CuKCcNwekV) return 0;
    *CuKCcNwekV = (XlTCyNlNEs){.RCBmhGiQud = RCBmhGiQud, .FIspAuFgsL = KQwnTiaaRA->FIspAuFgsL, .IdYlBSTGmP = KQwnTiaaRA};
    KQwnTiaaRA->FIspAuFgsL->IdYlBSTGmP = CuKCcNwekV;
    KQwnTiaaRA->FIspAuFgsL = CuKCcNwekV;
    return 1;
}
static void jZMmuRFmTy(XlTCyNlNEs *CuKCcNwekV) {
    CuKCcNwekV->FIspAuFgsL->IdYlBSTGmP = CuKCcNwekV->IdYlBSTGmP;
    CuKCcNwekV->IdYlBSTGmP->FIspAuFgsL = CuKCcNwekV->FIspAuFgsL;
    free(CuKCcNwekV);
}
static void bWeRtGXOKI(const XlTCyNlNEs *KQwnTiaaRA, int QGFVLXiKHm) {
    const XlTCyNlNEs *fOMIfmdLuq = QGFVLXiKHm ? KQwnTiaaRA->FIspAuFgsL : KQwnTiaaRA->IdYlBSTGmP;
    while (fOMIfmdLuq != KQwnTiaaRA) {
        const XlTCyNlNEs *IdYlBSTGmP = QGFVLXiKHm ? fOMIfmdLuq->FIspAuFgsL : fOMIfmdLuq->IdYlBSTGmP;
        printf("%d%c", fOMIfmdLuq->RCBmhGiQud, IdYlBSTGmP == KQwnTiaaRA ? '\n' : ' ');
        fOMIfmdLuq = IdYlBSTGmP;
    }
}
int main(void) {
    XlTCyNlNEs KQwnTiaaRA = {.RCBmhGiQud = 0, .FIspAuFgsL = &KQwnTiaaRA, .IdYlBSTGmP = &KQwnTiaaRA};
    for (int AAfOfTuHRA = 1; AAfOfTuHRA <= 3; ++AAfOfTuHRA) {
        if (!yFvLGyxZaR(&KQwnTiaaRA, AAfOfTuHRA)) {
            while (KQwnTiaaRA.IdYlBSTGmP != &KQwnTiaaRA) jZMmuRFmTy(KQwnTiaaRA.IdYlBSTGmP);
            return 1;
        }
    }
    bWeRtGXOKI(&KQwnTiaaRA, 0);
    bWeRtGXOKI(&KQwnTiaaRA, 1);
    jZMmuRFmTy(KQwnTiaaRA.IdYlBSTGmP->IdYlBSTGmP);
    bWeRtGXOKI(&KQwnTiaaRA, 0);
    bWeRtGXOKI(&KQwnTiaaRA, 1);
    while (KQwnTiaaRA.IdYlBSTGmP != &KQwnTiaaRA) jZMmuRFmTy(KQwnTiaaRA.IdYlBSTGmP);
    printf("%d %d\n", KQwnTiaaRA.IdYlBSTGmP == &KQwnTiaaRA, KQwnTiaaRA.FIspAuFgsL == &KQwnTiaaRA);
    return 0;
}
