#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <assert.h>
typedef enum { ohCzEjUQuZ, iYaunyYbXj } fFflCICaOP;
typedef struct vzqGDiNtOk vzqGDiNtOk;
struct vzqGDiNtOk { int hfIiVmdNUg; fFflCICaOP ExkQQGyCry; vzqGDiNtOk *oWlempipXA, *XOomyXqIYg, *NuBqaNzjSW; };
typedef struct { vzqGDiNtOk *FMIdbXiqDK; vzqGDiNtOk CvOWERDUDh; size_t ixmvIiyGvh; } JAsVmjJZtb;
static void PMKhEHLnGU(JAsVmjJZtb *txUlwjSYbp) {
    txUlwjSYbp->CvOWERDUDh = (vzqGDiNtOk){.hfIiVmdNUg = 0, .ExkQQGyCry = ohCzEjUQuZ,
        .oWlempipXA = &txUlwjSYbp->CvOWERDUDh, .XOomyXqIYg = &txUlwjSYbp->CvOWERDUDh, .NuBqaNzjSW = &txUlwjSYbp->CvOWERDUDh};
    txUlwjSYbp->FMIdbXiqDK = &txUlwjSYbp->CvOWERDUDh;
    txUlwjSYbp->ixmvIiyGvh = 0;
}
static void sXJFeiIeIk(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *XzbCDDXmHG) {
    vzqGDiNtOk *CymQqSfidV = XzbCDDXmHG->XOomyXqIYg;
    assert(CymQqSfidV != &txUlwjSYbp->CvOWERDUDh);
    XzbCDDXmHG->XOomyXqIYg = CymQqSfidV->oWlempipXA;
    if (CymQqSfidV->oWlempipXA != &txUlwjSYbp->CvOWERDUDh) CymQqSfidV->oWlempipXA->NuBqaNzjSW = XzbCDDXmHG;
    CymQqSfidV->NuBqaNzjSW = XzbCDDXmHG->NuBqaNzjSW;
    if (XzbCDDXmHG->NuBqaNzjSW == &txUlwjSYbp->CvOWERDUDh) txUlwjSYbp->FMIdbXiqDK = CymQqSfidV;
    else if (XzbCDDXmHG == XzbCDDXmHG->NuBqaNzjSW->oWlempipXA) XzbCDDXmHG->NuBqaNzjSW->oWlempipXA = CymQqSfidV;
    else XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg = CymQqSfidV;
    CymQqSfidV->oWlempipXA = XzbCDDXmHG;
    XzbCDDXmHG->NuBqaNzjSW = CymQqSfidV;
}
static void iafIhDKmPH(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *XzbCDDXmHG) {
    vzqGDiNtOk *CymQqSfidV = XzbCDDXmHG->oWlempipXA;
    assert(CymQqSfidV != &txUlwjSYbp->CvOWERDUDh);
    XzbCDDXmHG->oWlempipXA = CymQqSfidV->XOomyXqIYg;
    if (CymQqSfidV->XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh) CymQqSfidV->XOomyXqIYg->NuBqaNzjSW = XzbCDDXmHG;
    CymQqSfidV->NuBqaNzjSW = XzbCDDXmHG->NuBqaNzjSW;
    if (XzbCDDXmHG->NuBqaNzjSW == &txUlwjSYbp->CvOWERDUDh) txUlwjSYbp->FMIdbXiqDK = CymQqSfidV;
    else if (XzbCDDXmHG == XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg) XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg = CymQqSfidV;
    else XzbCDDXmHG->NuBqaNzjSW->oWlempipXA = CymQqSfidV;
    CymQqSfidV->XOomyXqIYg = XzbCDDXmHG;
    XzbCDDXmHG->NuBqaNzjSW = CymQqSfidV;
}
static void SfADyEwbfN(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *trtebKEwVu) {
    while (trtebKEwVu->NuBqaNzjSW->ExkQQGyCry == iYaunyYbXj) {
        if (trtebKEwVu->NuBqaNzjSW == trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->oWlempipXA) {
            vzqGDiNtOk *CymQqSfidV = trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->XOomyXqIYg;
            if (CymQqSfidV->ExkQQGyCry == iYaunyYbXj) {
                trtebKEwVu->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ; CymQqSfidV->ExkQQGyCry = ohCzEjUQuZ;
                trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj; trtebKEwVu = trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW;
            } else {
                if (trtebKEwVu == trtebKEwVu->NuBqaNzjSW->XOomyXqIYg) { trtebKEwVu = trtebKEwVu->NuBqaNzjSW; sXJFeiIeIk(txUlwjSYbp, trtebKEwVu); }
                trtebKEwVu->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ; trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj;
                iafIhDKmPH(txUlwjSYbp, trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW);
            }
        } else {
            vzqGDiNtOk *CymQqSfidV = trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->oWlempipXA;
            if (CymQqSfidV->ExkQQGyCry == iYaunyYbXj) {
                trtebKEwVu->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ; CymQqSfidV->ExkQQGyCry = ohCzEjUQuZ;
                trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj; trtebKEwVu = trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW;
            } else {
                if (trtebKEwVu == trtebKEwVu->NuBqaNzjSW->oWlempipXA) { trtebKEwVu = trtebKEwVu->NuBqaNzjSW; iafIhDKmPH(txUlwjSYbp, trtebKEwVu); }
                trtebKEwVu->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ; trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj;
                sXJFeiIeIk(txUlwjSYbp, trtebKEwVu->NuBqaNzjSW->NuBqaNzjSW);
            }
        }
    }
    txUlwjSYbp->FMIdbXiqDK->ExkQQGyCry = ohCzEjUQuZ;
}
static int xwPiIjmVPy(JAsVmjJZtb *txUlwjSYbp, int hfIiVmdNUg) {
    vzqGDiNtOk *NuBqaNzjSW = &txUlwjSYbp->CvOWERDUDh, *eyRwqRImIh = txUlwjSYbp->FMIdbXiqDK;
    while (eyRwqRImIh != &txUlwjSYbp->CvOWERDUDh) {
        NuBqaNzjSW = eyRwqRImIh;
        if (hfIiVmdNUg == eyRwqRImIh->hfIiVmdNUg) return 2;
        eyRwqRImIh = hfIiVmdNUg < eyRwqRImIh->hfIiVmdNUg ? eyRwqRImIh->oWlempipXA : eyRwqRImIh->XOomyXqIYg;
    }
    vzqGDiNtOk *trtebKEwVu = malloc(sizeof *trtebKEwVu);
    if (!trtebKEwVu) return 0;
    *trtebKEwVu = (vzqGDiNtOk){.hfIiVmdNUg = hfIiVmdNUg, .ExkQQGyCry = iYaunyYbXj,
        .oWlempipXA = &txUlwjSYbp->CvOWERDUDh, .XOomyXqIYg = &txUlwjSYbp->CvOWERDUDh, .NuBqaNzjSW = NuBqaNzjSW};
    if (NuBqaNzjSW == &txUlwjSYbp->CvOWERDUDh) txUlwjSYbp->FMIdbXiqDK = trtebKEwVu;
    else if (hfIiVmdNUg < NuBqaNzjSW->hfIiVmdNUg) NuBqaNzjSW->oWlempipXA = trtebKEwVu;
    else NuBqaNzjSW->XOomyXqIYg = trtebKEwVu;
    ++txUlwjSYbp->ixmvIiyGvh;
    SfADyEwbfN(txUlwjSYbp, trtebKEwVu);
    return 1;
}
static void fcWeiVAppg(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *cOGGuSHmPL, vzqGDiNtOk *xgCrBZUVhl) {
    if (cOGGuSHmPL->NuBqaNzjSW == &txUlwjSYbp->CvOWERDUDh) txUlwjSYbp->FMIdbXiqDK = xgCrBZUVhl;
    else if (cOGGuSHmPL == cOGGuSHmPL->NuBqaNzjSW->oWlempipXA) cOGGuSHmPL->NuBqaNzjSW->oWlempipXA = xgCrBZUVhl;
    else cOGGuSHmPL->NuBqaNzjSW->XOomyXqIYg = xgCrBZUVhl;
    xgCrBZUVhl->NuBqaNzjSW = cOGGuSHmPL->NuBqaNzjSW;
}
static void yHSkwvVEIY(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *XzbCDDXmHG) {
    while (XzbCDDXmHG != txUlwjSYbp->FMIdbXiqDK && XzbCDDXmHG->ExkQQGyCry == ohCzEjUQuZ) {
        if (XzbCDDXmHG == XzbCDDXmHG->NuBqaNzjSW->oWlempipXA) {
            vzqGDiNtOk *uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg;
            assert(uRIrfDFtOa != &txUlwjSYbp->CvOWERDUDh);
            if (uRIrfDFtOa->ExkQQGyCry == iYaunyYbXj) {
                uRIrfDFtOa->ExkQQGyCry = ohCzEjUQuZ; XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj;
                sXJFeiIeIk(txUlwjSYbp, XzbCDDXmHG->NuBqaNzjSW); uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg;
            }
            if (uRIrfDFtOa->oWlempipXA->ExkQQGyCry == ohCzEjUQuZ && uRIrfDFtOa->XOomyXqIYg->ExkQQGyCry == ohCzEjUQuZ) {
                uRIrfDFtOa->ExkQQGyCry = iYaunyYbXj; XzbCDDXmHG = XzbCDDXmHG->NuBqaNzjSW;
            } else {
                if (uRIrfDFtOa->XOomyXqIYg->ExkQQGyCry == ohCzEjUQuZ) {
                    uRIrfDFtOa->oWlempipXA->ExkQQGyCry = ohCzEjUQuZ; uRIrfDFtOa->ExkQQGyCry = iYaunyYbXj;
                    iafIhDKmPH(txUlwjSYbp, uRIrfDFtOa); uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->XOomyXqIYg;
                }
                uRIrfDFtOa->ExkQQGyCry = XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry; XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ;
                uRIrfDFtOa->XOomyXqIYg->ExkQQGyCry = ohCzEjUQuZ; sXJFeiIeIk(txUlwjSYbp, XzbCDDXmHG->NuBqaNzjSW); XzbCDDXmHG = txUlwjSYbp->FMIdbXiqDK;
            }
        } else {
            vzqGDiNtOk *uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->oWlempipXA;
            assert(uRIrfDFtOa != &txUlwjSYbp->CvOWERDUDh);
            if (uRIrfDFtOa->ExkQQGyCry == iYaunyYbXj) {
                uRIrfDFtOa->ExkQQGyCry = ohCzEjUQuZ; XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry = iYaunyYbXj;
                iafIhDKmPH(txUlwjSYbp, XzbCDDXmHG->NuBqaNzjSW); uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->oWlempipXA;
            }
            if (uRIrfDFtOa->XOomyXqIYg->ExkQQGyCry == ohCzEjUQuZ && uRIrfDFtOa->oWlempipXA->ExkQQGyCry == ohCzEjUQuZ) {
                uRIrfDFtOa->ExkQQGyCry = iYaunyYbXj; XzbCDDXmHG = XzbCDDXmHG->NuBqaNzjSW;
            } else {
                if (uRIrfDFtOa->oWlempipXA->ExkQQGyCry == ohCzEjUQuZ) {
                    uRIrfDFtOa->XOomyXqIYg->ExkQQGyCry = ohCzEjUQuZ; uRIrfDFtOa->ExkQQGyCry = iYaunyYbXj;
                    sXJFeiIeIk(txUlwjSYbp, uRIrfDFtOa); uRIrfDFtOa = XzbCDDXmHG->NuBqaNzjSW->oWlempipXA;
                }
                uRIrfDFtOa->ExkQQGyCry = XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry; XzbCDDXmHG->NuBqaNzjSW->ExkQQGyCry = ohCzEjUQuZ;
                uRIrfDFtOa->oWlempipXA->ExkQQGyCry = ohCzEjUQuZ; iafIhDKmPH(txUlwjSYbp, XzbCDDXmHG->NuBqaNzjSW); XzbCDDXmHG = txUlwjSYbp->FMIdbXiqDK;
            }
        }
    }
    XzbCDDXmHG->ExkQQGyCry = ohCzEjUQuZ;
}
static int cuaHLRffQo(JAsVmjJZtb *txUlwjSYbp, int hfIiVmdNUg) {
    vzqGDiNtOk *trtebKEwVu = txUlwjSYbp->FMIdbXiqDK;
    while (trtebKEwVu != &txUlwjSYbp->CvOWERDUDh && trtebKEwVu->hfIiVmdNUg != hfIiVmdNUg)
        trtebKEwVu = hfIiVmdNUg < trtebKEwVu->hfIiVmdNUg ? trtebKEwVu->oWlempipXA : trtebKEwVu->XOomyXqIYg;
    if (trtebKEwVu == &txUlwjSYbp->CvOWERDUDh) return 0;
    vzqGDiNtOk *CymQqSfidV = trtebKEwVu, *XzbCDDXmHG;
    fFflCICaOP fiWFETHZHb = CymQqSfidV->ExkQQGyCry;
    if (trtebKEwVu->oWlempipXA == &txUlwjSYbp->CvOWERDUDh) { XzbCDDXmHG = trtebKEwVu->XOomyXqIYg; fcWeiVAppg(txUlwjSYbp, trtebKEwVu, trtebKEwVu->XOomyXqIYg); }
    else if (trtebKEwVu->XOomyXqIYg == &txUlwjSYbp->CvOWERDUDh) { XzbCDDXmHG = trtebKEwVu->oWlempipXA; fcWeiVAppg(txUlwjSYbp, trtebKEwVu, trtebKEwVu->oWlempipXA); }
    else {
        CymQqSfidV = trtebKEwVu->XOomyXqIYg;
        while (CymQqSfidV->oWlempipXA != &txUlwjSYbp->CvOWERDUDh) CymQqSfidV = CymQqSfidV->oWlempipXA;
        fiWFETHZHb = CymQqSfidV->ExkQQGyCry;
        XzbCDDXmHG = CymQqSfidV->XOomyXqIYg;
        if (CymQqSfidV->NuBqaNzjSW == trtebKEwVu) XzbCDDXmHG->NuBqaNzjSW = CymQqSfidV;
        else {
            fcWeiVAppg(txUlwjSYbp, CymQqSfidV, CymQqSfidV->XOomyXqIYg);
            CymQqSfidV->XOomyXqIYg = trtebKEwVu->XOomyXqIYg; CymQqSfidV->XOomyXqIYg->NuBqaNzjSW = CymQqSfidV;
        }
        fcWeiVAppg(txUlwjSYbp, trtebKEwVu, CymQqSfidV);
        CymQqSfidV->oWlempipXA = trtebKEwVu->oWlempipXA; CymQqSfidV->oWlempipXA->NuBqaNzjSW = CymQqSfidV; CymQqSfidV->ExkQQGyCry = trtebKEwVu->ExkQQGyCry;
    }
    free(trtebKEwVu);
    --txUlwjSYbp->ixmvIiyGvh;
    if (fiWFETHZHb == ohCzEjUQuZ) yHSkwvVEIY(txUlwjSYbp, XzbCDDXmHG);
    txUlwjSYbp->CvOWERDUDh.NuBqaNzjSW = &txUlwjSYbp->CvOWERDUDh;
    return 1;
}
static int NDULnRCHMq(const JAsVmjJZtb *txUlwjSYbp, const vzqGDiNtOk *rGPcCXEmbv, long long xkJOWgjaQh,
                     long long JxpQzZznYn, size_t *FvfGaIVnmX) {
    if (rGPcCXEmbv == &txUlwjSYbp->CvOWERDUDh) return 1;
    if ((long long)rGPcCXEmbv->hfIiVmdNUg <= xkJOWgjaQh || (long long)rGPcCXEmbv->hfIiVmdNUg >= JxpQzZznYn) return -1;
    if (rGPcCXEmbv->ExkQQGyCry != ohCzEjUQuZ && rGPcCXEmbv->ExkQQGyCry != iYaunyYbXj) return -1;
    if (rGPcCXEmbv->oWlempipXA != &txUlwjSYbp->CvOWERDUDh && rGPcCXEmbv->oWlempipXA->NuBqaNzjSW != rGPcCXEmbv) return -1;
    if (rGPcCXEmbv->XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh && rGPcCXEmbv->XOomyXqIYg->NuBqaNzjSW != rGPcCXEmbv) return -1;
    if (rGPcCXEmbv->ExkQQGyCry == iYaunyYbXj && (rGPcCXEmbv->oWlempipXA->ExkQQGyCry == iYaunyYbXj || rGPcCXEmbv->XOomyXqIYg->ExkQQGyCry == iYaunyYbXj)) return -1;
    int XUsjTxOOwW = NDULnRCHMq(txUlwjSYbp, rGPcCXEmbv->oWlempipXA, xkJOWgjaQh, rGPcCXEmbv->hfIiVmdNUg, FvfGaIVnmX);
    int XttZgbdrsO = NDULnRCHMq(txUlwjSYbp, rGPcCXEmbv->XOomyXqIYg, rGPcCXEmbv->hfIiVmdNUg, JxpQzZznYn, FvfGaIVnmX);
    if (XUsjTxOOwW < 0 || XttZgbdrsO < 0 || XUsjTxOOwW != XttZgbdrsO) return -1;
    ++*FvfGaIVnmX;
    return XUsjTxOOwW + (rGPcCXEmbv->ExkQQGyCry == ohCzEjUQuZ);
}
static int pyKksuGnMO(const JAsVmjJZtb *txUlwjSYbp) {
    size_t FvfGaIVnmX = 0;
    if (txUlwjSYbp->CvOWERDUDh.ExkQQGyCry != ohCzEjUQuZ || txUlwjSYbp->CvOWERDUDh.oWlempipXA != &txUlwjSYbp->CvOWERDUDh || txUlwjSYbp->CvOWERDUDh.XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh) return 0;
    if (txUlwjSYbp->FMIdbXiqDK != &txUlwjSYbp->CvOWERDUDh && (txUlwjSYbp->FMIdbXiqDK->NuBqaNzjSW != &txUlwjSYbp->CvOWERDUDh || txUlwjSYbp->FMIdbXiqDK->ExkQQGyCry != ohCzEjUQuZ)) return 0;
    int oihwxCHXwt = NDULnRCHMq(txUlwjSYbp, txUlwjSYbp->FMIdbXiqDK, LLONG_MIN, LLONG_MAX, &FvfGaIVnmX);
    return oihwxCHXwt > 0 && FvfGaIVnmX == txUlwjSYbp->ixmvIiyGvh;
}
static void LfEkfBupct(JAsVmjJZtb *txUlwjSYbp, vzqGDiNtOk *rGPcCXEmbv) {
    if (rGPcCXEmbv == &txUlwjSYbp->CvOWERDUDh) return;
    LfEkfBupct(txUlwjSYbp, rGPcCXEmbv->oWlempipXA); LfEkfBupct(txUlwjSYbp, rGPcCXEmbv->XOomyXqIYg); free(rGPcCXEmbv);
}
static void zXIqbhoUGQ(JAsVmjJZtb *txUlwjSYbp) { LfEkfBupct(txUlwjSYbp, txUlwjSYbp->FMIdbXiqDK); PMKhEHLnGU(txUlwjSYbp); }

static const vzqGDiNtOk *QgVnzltEme(const JAsVmjJZtb *txUlwjSYbp, int hfIiVmdNUg) {
    const vzqGDiNtOk *voarzSBCDH = txUlwjSYbp->FMIdbXiqDK;
    while (voarzSBCDH != &txUlwjSYbp->CvOWERDUDh && voarzSBCDH->hfIiVmdNUg != hfIiVmdNUg)
        voarzSBCDH = hfIiVmdNUg < voarzSBCDH->hfIiVmdNUg ? voarzSBCDH->oWlempipXA : voarzSBCDH->XOomyXqIYg;
    return voarzSBCDH;
}
static const vzqGDiNtOk *yoRKlDdZzF(const JAsVmjJZtb *txUlwjSYbp, int StsVeZYyxO) {
    const vzqGDiNtOk *voarzSBCDH = txUlwjSYbp->FMIdbXiqDK;
    if (voarzSBCDH == &txUlwjSYbp->CvOWERDUDh) return voarzSBCDH;
    if (StsVeZYyxO < 0) {
        while (voarzSBCDH->oWlempipXA != &txUlwjSYbp->CvOWERDUDh) voarzSBCDH = voarzSBCDH->oWlempipXA;
    } else {
        while (voarzSBCDH->XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh) voarzSBCDH = voarzSBCDH->XOomyXqIYg;
    }
    return voarzSBCDH;
}
static const vzqGDiNtOk *GlARIbLltA(const JAsVmjJZtb *txUlwjSYbp, int hfIiVmdNUg, int StsVeZYyxO, int DugLRqSzld) {
    const vzqGDiNtOk *voarzSBCDH = txUlwjSYbp->FMIdbXiqDK, *cJuykNHckg = &txUlwjSYbp->CvOWERDUDh;
    while (voarzSBCDH != &txUlwjSYbp->CvOWERDUDh) {
        if (StsVeZYyxO < 0) {
            if (voarzSBCDH->hfIiVmdNUg < hfIiVmdNUg) { cJuykNHckg = voarzSBCDH; voarzSBCDH = voarzSBCDH->XOomyXqIYg; }
            else voarzSBCDH = voarzSBCDH->oWlempipXA;
        } else {
            if (voarzSBCDH->hfIiVmdNUg > hfIiVmdNUg || (DugLRqSzld && voarzSBCDH->hfIiVmdNUg == hfIiVmdNUg)) { cJuykNHckg = voarzSBCDH; voarzSBCDH = voarzSBCDH->oWlempipXA; }
            else voarzSBCDH = voarzSBCDH->XOomyXqIYg;
        }
    }
    return cJuykNHckg;
}
static void bLNxCSCNIS(const JAsVmjJZtb *txUlwjSYbp, const vzqGDiNtOk *voarzSBCDH) {
    if (voarzSBCDH == &txUlwjSYbp->CvOWERDUDh) return;
    bLNxCSCNIS(txUlwjSYbp, voarzSBCDH->oWlempipXA);
    printf(" %d", voarzSBCDH->hfIiVmdNUg);
    bLNxCSCNIS(txUlwjSYbp, voarzSBCDH->XOomyXqIYg);
}
static void TmhFvARjCF(const JAsVmjJZtb *txUlwjSYbp, const vzqGDiNtOk *voarzSBCDH) {
    if (voarzSBCDH == &txUlwjSYbp->CvOWERDUDh) return;
    TmhFvARjCF(txUlwjSYbp, voarzSBCDH->oWlempipXA);
    printf("N %d %u %d %d %d %d %d %d\n", voarzSBCDH->hfIiVmdNUg, (unsigned)voarzSBCDH->ExkQQGyCry,
           voarzSBCDH->oWlempipXA != &txUlwjSYbp->CvOWERDUDh, voarzSBCDH->oWlempipXA != &txUlwjSYbp->CvOWERDUDh ? voarzSBCDH->oWlempipXA->hfIiVmdNUg : 0,
           voarzSBCDH->XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh, voarzSBCDH->XOomyXqIYg != &txUlwjSYbp->CvOWERDUDh ? voarzSBCDH->XOomyXqIYg->hfIiVmdNUg : 0,
           voarzSBCDH->NuBqaNzjSW != &txUlwjSYbp->CvOWERDUDh, voarzSBCDH->NuBqaNzjSW != &txUlwjSYbp->CvOWERDUDh ? voarzSBCDH->NuBqaNzjSW->hfIiVmdNUg : 0);
    TmhFvARjCF(txUlwjSYbp, voarzSBCDH->XOomyXqIYg);
}
static int nczPssZzXm(JAsVmjJZtb *txUlwjSYbp, char PsGdxyzWkf, int hfIiVmdNUg, size_t jAdGDDwbLs, int tvODaGcuMg) {
    int wbAeNorVqJ = 0, cmjvzyuWvZ = 0;
    const vzqGDiNtOk *voarzSBCDH = &txUlwjSYbp->CvOWERDUDh;
    switch (PsGdxyzWkf) {
        case '+':
            wbAeNorVqJ = xwPiIjmVPy(txUlwjSYbp, hfIiVmdNUg);
            if (!wbAeNorVqJ) { fputs("ERROR\n", stderr); return 0; }
            cmjvzyuWvZ = hfIiVmdNUg;
            break;
        case '-':
            wbAeNorVqJ = cuaHLRffQo(txUlwjSYbp, hfIiVmdNUg);
            if (wbAeNorVqJ) cmjvzyuWvZ = hfIiVmdNUg;
            break;
        case '?': voarzSBCDH = QgVnzltEme(txUlwjSYbp, hfIiVmdNUg); break;
        case '<': voarzSBCDH = GlARIbLltA(txUlwjSYbp, hfIiVmdNUg, -1, 0); break;
        case '>': voarzSBCDH = GlARIbLltA(txUlwjSYbp, hfIiVmdNUg, 1, 0); break;
        case '=': voarzSBCDH = GlARIbLltA(txUlwjSYbp, hfIiVmdNUg, 1, 1); break;
        case 'm': voarzSBCDH = yoRKlDdZzF(txUlwjSYbp, -1); break;
        case 'M': voarzSBCDH = yoRKlDdZzF(txUlwjSYbp, 1); break;
        case 'r':
            if (txUlwjSYbp->FMIdbXiqDK != &txUlwjSYbp->CvOWERDUDh) {
                cmjvzyuWvZ = txUlwjSYbp->FMIdbXiqDK->hfIiVmdNUg;
                wbAeNorVqJ = cuaHLRffQo(txUlwjSYbp, cmjvzyuWvZ);
            }
            break;
        case 'c':
            if (txUlwjSYbp->ixmvIiyGvh > (size_t)INT_MAX) { fputs("ERROR\n", stderr); return 0; }
            cmjvzyuWvZ = (int)txUlwjSYbp->ixmvIiyGvh;
            zXIqbhoUGQ(txUlwjSYbp);
            wbAeNorVqJ = 1;
            break;
        case 'p': wbAeNorVqJ = 1; break;
        default: fputs("ERROR\n", stderr); return 0;
    }
    if (voarzSBCDH != &txUlwjSYbp->CvOWERDUDh) { wbAeNorVqJ = 1; cmjvzyuWvZ = voarzSBCDH->hfIiVmdNUg; }
    int AlEZfnRRiY = pyKksuGnMO(txUlwjSYbp);
    if (!AlEZfnRRiY) { fputs("ERROR\n", stderr); return 0; }
    printf("S %zu %c %d %d %d %zu %d", jAdGDDwbLs, PsGdxyzWkf, hfIiVmdNUg, wbAeNorVqJ,
           cmjvzyuWvZ, txUlwjSYbp->ixmvIiyGvh, AlEZfnRRiY);
    bLNxCSCNIS(txUlwjSYbp, txUlwjSYbp->FMIdbXiqDK);
    putchar('\n');
    if (tvODaGcuMg) {
        printf("T %d %d\n", txUlwjSYbp->FMIdbXiqDK != &txUlwjSYbp->CvOWERDUDh,
               txUlwjSYbp->FMIdbXiqDK != &txUlwjSYbp->CvOWERDUDh ? txUlwjSYbp->FMIdbXiqDK->hfIiVmdNUg : 0);
        TmhFvARjCF(txUlwjSYbp, txUlwjSYbp->FMIdbXiqDK);
    }
    return 1;
}
static int yGFHORJLzO(char *line, char *PsGdxyzWkf, int *hfIiVmdNUg) {
    char *voarzSBCDH = line;
    while (isspace((unsigned char)*voarzSBCDH)) ++voarzSBCDH;
    if (!*voarzSBCDH) return 0;
    *PsGdxyzWkf = *voarzSBCDH++;
    *hfIiVmdNUg = 0;
    if (*PsGdxyzWkf == '+' || *PsGdxyzWkf == '-' || *PsGdxyzWkf == '?' ||
        *PsGdxyzWkf == '<' || *PsGdxyzWkf == '>' || *PsGdxyzWkf == '=') {
        while (isspace((unsigned char)*voarzSBCDH)) ++voarzSBCDH;
        if (!*voarzSBCDH) return -1;
        errno = 0;
        char *MSDfujdJkA;
        long izsSMEmcPW = strtol(voarzSBCDH, &MSDfujdJkA, 10);
        if (MSDfujdJkA == voarzSBCDH || errno == ERANGE || izsSMEmcPW < INT_MIN || izsSMEmcPW > INT_MAX) return -1;
        *hfIiVmdNUg = (int)izsSMEmcPW;
        voarzSBCDH = MSDfujdJkA;
    } else if (!strchr("mMrcpq", *PsGdxyzWkf)) return -1;
    while (isspace((unsigned char)*voarzSBCDH)) ++voarzSBCDH;
    return *voarzSBCDH ? -1 : 1;
}
int main(int MZOQqwpdcz, char **VscneXeEGq) {
    int azzbkroVCP = 0, tvODaGcuMg = 0;
    for (int CpQBUDMlzU = 1; CpQBUDMlzU < MZOQqwpdcz; ++CpQBUDMlzU) {
        if (strcmp(VscneXeEGq[CpQBUDMlzU], "--interactive") == 0) azzbkroVCP = 1;
        else if (strcmp(VscneXeEGq[CpQBUDMlzU], "--dump") == 0) tvODaGcuMg = 1;
        else if (strcmp(VscneXeEGq[CpQBUDMlzU], "--help") == 0) {
            puts("+ n | - n | ? n | < n | > n | = n | m | M | r | c | p | q");
            return 0;
        } else { fputs("ERROR\n", stderr); return 2; }
    }
    JAsVmjJZtb txUlwjSYbp;
    PMKhEHLnGU(&txUlwjSYbp);
    int ClDSwlmsmY = 0;
    size_t jAdGDDwbLs = 0;
    if (azzbkroVCP) {
        char line[128];
        while (fgets(line, sizeof line, stdin)) {
            if (!strchr(line, '\n') && !feof(stdin)) {
                fputs("ERROR\n", stderr); ClDSwlmsmY = 2; break;
            }
            char PsGdxyzWkf;
            int hfIiVmdNUg;
            int wbAeNorVqJ = yGFHORJLzO(line, &PsGdxyzWkf, &hfIiVmdNUg);
            if (!wbAeNorVqJ) continue;
            if (wbAeNorVqJ < 0) { fputs("ERROR\n", stderr); ClDSwlmsmY = 2; break; }
            if (PsGdxyzWkf == 'q') break;
            if (jAdGDDwbLs == SIZE_MAX) { fputs("ERROR\n", stderr); ClDSwlmsmY = 2; break; }
            if (!nczPssZzXm(&txUlwjSYbp, PsGdxyzWkf, hfIiVmdNUg, ++jAdGDDwbLs, tvODaGcuMg)) { ClDSwlmsmY = 1; break; }
        }
        if (ferror(stdin)) { fputs("ERROR\n", stderr); ClDSwlmsmY = 2; }
    } else {
        const struct { char PsGdxyzWkf; int hfIiVmdNUg; } pyZdakMgtA[] = {
            {'p', 0},
            {'+', 10},
            {'+', 20},
            {'+', 30},
            {'+', 15},
            {'+', 25},
            {'+', 5},
            {'+', 1},
            {'?', 15},
            {'?', 99},
            {'m', 0},
            {'M', 0},
            {'<', 15},
            {'>', 15},
            {'=', 16},
            {'+', 15},
            {'r', 0},
            {'-', 1},
            {'-', 5},
            {'+', 12},
            {'+', 18},
            {'+', 40},
            {'-', 99},
            {'-', 25},
            {'p', 0},
            {'c', 0},
            {'m', 0},
            {'M', 0},
            {'-', 10},
            {'+', 7},
            {'r', 0},
            {'+', 7},
            {'c', 0},
            {'c', 0},
        };
        for (size_t CpQBUDMlzU = 0; CpQBUDMlzU < sizeof pyZdakMgtA / sizeof pyZdakMgtA[0]; ++CpQBUDMlzU) {
            if (!nczPssZzXm(&txUlwjSYbp, pyZdakMgtA[CpQBUDMlzU].PsGdxyzWkf, pyZdakMgtA[CpQBUDMlzU].hfIiVmdNUg, ++jAdGDDwbLs, tvODaGcuMg)) {
                ClDSwlmsmY = 1; break;
            }
        }
    }
    zXIqbhoUGQ(&txUlwjSYbp);
    if (fflush(stdout) == EOF) return 2;
    return ClDSwlmsmY;
}
