#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <assert.h>
typedef enum { PeAkGtYTED, lvwCHToDhE } FTstkPfBQk;
typedef struct pzrvQmseVM pzrvQmseVM;
struct pzrvQmseVM { int dOXBRhXhsh; FTstkPfBQk ZpmKEeobrp; pzrvQmseVM *cPDZRjISzD, *BdrRlRFjtI, *nwusXUSujc; };
typedef struct { pzrvQmseVM *YSciqERYDt; pzrvQmseVM yZTGLvnnCy; size_t eHMrxScvqm; } JievaGJaLi;
static void dZsCIhaHjO(JievaGJaLi *pbStbRleHt) {
    pbStbRleHt->yZTGLvnnCy = (pzrvQmseVM){.dOXBRhXhsh = 0, .ZpmKEeobrp = PeAkGtYTED,
        .cPDZRjISzD = &pbStbRleHt->yZTGLvnnCy, .BdrRlRFjtI = &pbStbRleHt->yZTGLvnnCy, .nwusXUSujc = &pbStbRleHt->yZTGLvnnCy};
    pbStbRleHt->YSciqERYDt = &pbStbRleHt->yZTGLvnnCy;
    pbStbRleHt->eHMrxScvqm = 0;
}
static void TKeeMnfXvb(JievaGJaLi *pbStbRleHt, pzrvQmseVM *YEDyNgqNUO) {
    pzrvQmseVM *RkmrPIDHER = YEDyNgqNUO->BdrRlRFjtI;
    assert(RkmrPIDHER != &pbStbRleHt->yZTGLvnnCy);
    YEDyNgqNUO->BdrRlRFjtI = RkmrPIDHER->cPDZRjISzD;
    if (RkmrPIDHER->cPDZRjISzD != &pbStbRleHt->yZTGLvnnCy) RkmrPIDHER->cPDZRjISzD->nwusXUSujc = YEDyNgqNUO;
    RkmrPIDHER->nwusXUSujc = YEDyNgqNUO->nwusXUSujc;
    if (YEDyNgqNUO->nwusXUSujc == &pbStbRleHt->yZTGLvnnCy) pbStbRleHt->YSciqERYDt = RkmrPIDHER;
    else if (YEDyNgqNUO == YEDyNgqNUO->nwusXUSujc->cPDZRjISzD) YEDyNgqNUO->nwusXUSujc->cPDZRjISzD = RkmrPIDHER;
    else YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI = RkmrPIDHER;
    RkmrPIDHER->cPDZRjISzD = YEDyNgqNUO;
    YEDyNgqNUO->nwusXUSujc = RkmrPIDHER;
}
static void ToynKZbMaO(JievaGJaLi *pbStbRleHt, pzrvQmseVM *YEDyNgqNUO) {
    pzrvQmseVM *RkmrPIDHER = YEDyNgqNUO->cPDZRjISzD;
    assert(RkmrPIDHER != &pbStbRleHt->yZTGLvnnCy);
    YEDyNgqNUO->cPDZRjISzD = RkmrPIDHER->BdrRlRFjtI;
    if (RkmrPIDHER->BdrRlRFjtI != &pbStbRleHt->yZTGLvnnCy) RkmrPIDHER->BdrRlRFjtI->nwusXUSujc = YEDyNgqNUO;
    RkmrPIDHER->nwusXUSujc = YEDyNgqNUO->nwusXUSujc;
    if (YEDyNgqNUO->nwusXUSujc == &pbStbRleHt->yZTGLvnnCy) pbStbRleHt->YSciqERYDt = RkmrPIDHER;
    else if (YEDyNgqNUO == YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI) YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI = RkmrPIDHER;
    else YEDyNgqNUO->nwusXUSujc->cPDZRjISzD = RkmrPIDHER;
    RkmrPIDHER->BdrRlRFjtI = YEDyNgqNUO;
    YEDyNgqNUO->nwusXUSujc = RkmrPIDHER;
}
static void obGMhkCVap(JievaGJaLi *pbStbRleHt, pzrvQmseVM *gFhyfIPGPo) {
    while (gFhyfIPGPo->nwusXUSujc->ZpmKEeobrp == lvwCHToDhE) {
        if (gFhyfIPGPo->nwusXUSujc == gFhyfIPGPo->nwusXUSujc->nwusXUSujc->cPDZRjISzD) {
            pzrvQmseVM *RkmrPIDHER = gFhyfIPGPo->nwusXUSujc->nwusXUSujc->BdrRlRFjtI;
            if (RkmrPIDHER->ZpmKEeobrp == lvwCHToDhE) {
                gFhyfIPGPo->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED; RkmrPIDHER->ZpmKEeobrp = PeAkGtYTED;
                gFhyfIPGPo->nwusXUSujc->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE; gFhyfIPGPo = gFhyfIPGPo->nwusXUSujc->nwusXUSujc;
            } else {
                if (gFhyfIPGPo == gFhyfIPGPo->nwusXUSujc->BdrRlRFjtI) { gFhyfIPGPo = gFhyfIPGPo->nwusXUSujc; TKeeMnfXvb(pbStbRleHt, gFhyfIPGPo); }
                gFhyfIPGPo->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED; gFhyfIPGPo->nwusXUSujc->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE;
                ToynKZbMaO(pbStbRleHt, gFhyfIPGPo->nwusXUSujc->nwusXUSujc);
            }
        } else {
            pzrvQmseVM *RkmrPIDHER = gFhyfIPGPo->nwusXUSujc->nwusXUSujc->cPDZRjISzD;
            if (RkmrPIDHER->ZpmKEeobrp == lvwCHToDhE) {
                gFhyfIPGPo->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED; RkmrPIDHER->ZpmKEeobrp = PeAkGtYTED;
                gFhyfIPGPo->nwusXUSujc->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE; gFhyfIPGPo = gFhyfIPGPo->nwusXUSujc->nwusXUSujc;
            } else {
                if (gFhyfIPGPo == gFhyfIPGPo->nwusXUSujc->cPDZRjISzD) { gFhyfIPGPo = gFhyfIPGPo->nwusXUSujc; ToynKZbMaO(pbStbRleHt, gFhyfIPGPo); }
                gFhyfIPGPo->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED; gFhyfIPGPo->nwusXUSujc->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE;
                TKeeMnfXvb(pbStbRleHt, gFhyfIPGPo->nwusXUSujc->nwusXUSujc);
            }
        }
    }
    pbStbRleHt->YSciqERYDt->ZpmKEeobrp = PeAkGtYTED;
}
static int bhawOKyZvR(JievaGJaLi *pbStbRleHt, int dOXBRhXhsh) {
    pzrvQmseVM *nwusXUSujc = &pbStbRleHt->yZTGLvnnCy, *awnuUEXptN = pbStbRleHt->YSciqERYDt;
    while (awnuUEXptN != &pbStbRleHt->yZTGLvnnCy) {
        nwusXUSujc = awnuUEXptN;
        if (dOXBRhXhsh == awnuUEXptN->dOXBRhXhsh) return 1;
        awnuUEXptN = dOXBRhXhsh < awnuUEXptN->dOXBRhXhsh ? awnuUEXptN->cPDZRjISzD : awnuUEXptN->BdrRlRFjtI;
    }
    pzrvQmseVM *gFhyfIPGPo = malloc(sizeof *gFhyfIPGPo);
    if (!gFhyfIPGPo) return 0;
    *gFhyfIPGPo = (pzrvQmseVM){.dOXBRhXhsh = dOXBRhXhsh, .ZpmKEeobrp = lvwCHToDhE,
        .cPDZRjISzD = &pbStbRleHt->yZTGLvnnCy, .BdrRlRFjtI = &pbStbRleHt->yZTGLvnnCy, .nwusXUSujc = nwusXUSujc};
    if (nwusXUSujc == &pbStbRleHt->yZTGLvnnCy) pbStbRleHt->YSciqERYDt = gFhyfIPGPo;
    else if (dOXBRhXhsh < nwusXUSujc->dOXBRhXhsh) nwusXUSujc->cPDZRjISzD = gFhyfIPGPo;
    else nwusXUSujc->BdrRlRFjtI = gFhyfIPGPo;
    ++pbStbRleHt->eHMrxScvqm;
    obGMhkCVap(pbStbRleHt, gFhyfIPGPo);
    return 1;
}
static void jmFYBRhcfJ(JievaGJaLi *pbStbRleHt, pzrvQmseVM *jVmlFnZfBg, pzrvQmseVM *fyZNKmxPrg) {
    if (jVmlFnZfBg->nwusXUSujc == &pbStbRleHt->yZTGLvnnCy) pbStbRleHt->YSciqERYDt = fyZNKmxPrg;
    else if (jVmlFnZfBg == jVmlFnZfBg->nwusXUSujc->cPDZRjISzD) jVmlFnZfBg->nwusXUSujc->cPDZRjISzD = fyZNKmxPrg;
    else jVmlFnZfBg->nwusXUSujc->BdrRlRFjtI = fyZNKmxPrg;
    fyZNKmxPrg->nwusXUSujc = jVmlFnZfBg->nwusXUSujc;
}
static void VqPHGwwhYR(JievaGJaLi *pbStbRleHt, pzrvQmseVM *YEDyNgqNUO) {
    while (YEDyNgqNUO != pbStbRleHt->YSciqERYDt && YEDyNgqNUO->ZpmKEeobrp == PeAkGtYTED) {
        if (YEDyNgqNUO == YEDyNgqNUO->nwusXUSujc->cPDZRjISzD) {
            pzrvQmseVM *qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI;
            assert(qrYVPoKOjb != &pbStbRleHt->yZTGLvnnCy);
            if (qrYVPoKOjb->ZpmKEeobrp == lvwCHToDhE) {
                qrYVPoKOjb->ZpmKEeobrp = PeAkGtYTED; YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE;
                TKeeMnfXvb(pbStbRleHt, YEDyNgqNUO->nwusXUSujc); qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI;
            }
            if (qrYVPoKOjb->cPDZRjISzD->ZpmKEeobrp == PeAkGtYTED && qrYVPoKOjb->BdrRlRFjtI->ZpmKEeobrp == PeAkGtYTED) {
                qrYVPoKOjb->ZpmKEeobrp = lvwCHToDhE; YEDyNgqNUO = YEDyNgqNUO->nwusXUSujc;
            } else {
                if (qrYVPoKOjb->BdrRlRFjtI->ZpmKEeobrp == PeAkGtYTED) {
                    qrYVPoKOjb->cPDZRjISzD->ZpmKEeobrp = PeAkGtYTED; qrYVPoKOjb->ZpmKEeobrp = lvwCHToDhE;
                    ToynKZbMaO(pbStbRleHt, qrYVPoKOjb); qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->BdrRlRFjtI;
                }
                qrYVPoKOjb->ZpmKEeobrp = YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp; YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED;
                qrYVPoKOjb->BdrRlRFjtI->ZpmKEeobrp = PeAkGtYTED; TKeeMnfXvb(pbStbRleHt, YEDyNgqNUO->nwusXUSujc); YEDyNgqNUO = pbStbRleHt->YSciqERYDt;
            }
        } else {
            pzrvQmseVM *qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->cPDZRjISzD;
            assert(qrYVPoKOjb != &pbStbRleHt->yZTGLvnnCy);
            if (qrYVPoKOjb->ZpmKEeobrp == lvwCHToDhE) {
                qrYVPoKOjb->ZpmKEeobrp = PeAkGtYTED; YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp = lvwCHToDhE;
                ToynKZbMaO(pbStbRleHt, YEDyNgqNUO->nwusXUSujc); qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->cPDZRjISzD;
            }
            if (qrYVPoKOjb->BdrRlRFjtI->ZpmKEeobrp == PeAkGtYTED && qrYVPoKOjb->cPDZRjISzD->ZpmKEeobrp == PeAkGtYTED) {
                qrYVPoKOjb->ZpmKEeobrp = lvwCHToDhE; YEDyNgqNUO = YEDyNgqNUO->nwusXUSujc;
            } else {
                if (qrYVPoKOjb->cPDZRjISzD->ZpmKEeobrp == PeAkGtYTED) {
                    qrYVPoKOjb->BdrRlRFjtI->ZpmKEeobrp = PeAkGtYTED; qrYVPoKOjb->ZpmKEeobrp = lvwCHToDhE;
                    TKeeMnfXvb(pbStbRleHt, qrYVPoKOjb); qrYVPoKOjb = YEDyNgqNUO->nwusXUSujc->cPDZRjISzD;
                }
                qrYVPoKOjb->ZpmKEeobrp = YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp; YEDyNgqNUO->nwusXUSujc->ZpmKEeobrp = PeAkGtYTED;
                qrYVPoKOjb->cPDZRjISzD->ZpmKEeobrp = PeAkGtYTED; ToynKZbMaO(pbStbRleHt, YEDyNgqNUO->nwusXUSujc); YEDyNgqNUO = pbStbRleHt->YSciqERYDt;
            }
        }
    }
    YEDyNgqNUO->ZpmKEeobrp = PeAkGtYTED;
}
static int kHkESNQdbe(JievaGJaLi *pbStbRleHt, int dOXBRhXhsh) {
    pzrvQmseVM *gFhyfIPGPo = pbStbRleHt->YSciqERYDt;
    while (gFhyfIPGPo != &pbStbRleHt->yZTGLvnnCy && gFhyfIPGPo->dOXBRhXhsh != dOXBRhXhsh)
        gFhyfIPGPo = dOXBRhXhsh < gFhyfIPGPo->dOXBRhXhsh ? gFhyfIPGPo->cPDZRjISzD : gFhyfIPGPo->BdrRlRFjtI;
    if (gFhyfIPGPo == &pbStbRleHt->yZTGLvnnCy) return 0;
    pzrvQmseVM *RkmrPIDHER = gFhyfIPGPo, *YEDyNgqNUO;
    FTstkPfBQk fApCqONIor = RkmrPIDHER->ZpmKEeobrp;
    if (gFhyfIPGPo->cPDZRjISzD == &pbStbRleHt->yZTGLvnnCy) { YEDyNgqNUO = gFhyfIPGPo->BdrRlRFjtI; jmFYBRhcfJ(pbStbRleHt, gFhyfIPGPo, gFhyfIPGPo->BdrRlRFjtI); }
    else if (gFhyfIPGPo->BdrRlRFjtI == &pbStbRleHt->yZTGLvnnCy) { YEDyNgqNUO = gFhyfIPGPo->cPDZRjISzD; jmFYBRhcfJ(pbStbRleHt, gFhyfIPGPo, gFhyfIPGPo->cPDZRjISzD); }
    else {
        RkmrPIDHER = gFhyfIPGPo->BdrRlRFjtI;
        while (RkmrPIDHER->cPDZRjISzD != &pbStbRleHt->yZTGLvnnCy) RkmrPIDHER = RkmrPIDHER->cPDZRjISzD;
        fApCqONIor = RkmrPIDHER->ZpmKEeobrp;
        YEDyNgqNUO = RkmrPIDHER->BdrRlRFjtI;
        if (RkmrPIDHER->nwusXUSujc == gFhyfIPGPo) YEDyNgqNUO->nwusXUSujc = RkmrPIDHER;
        else {
            jmFYBRhcfJ(pbStbRleHt, RkmrPIDHER, RkmrPIDHER->BdrRlRFjtI);
            RkmrPIDHER->BdrRlRFjtI = gFhyfIPGPo->BdrRlRFjtI; RkmrPIDHER->BdrRlRFjtI->nwusXUSujc = RkmrPIDHER;
        }
        jmFYBRhcfJ(pbStbRleHt, gFhyfIPGPo, RkmrPIDHER);
        RkmrPIDHER->cPDZRjISzD = gFhyfIPGPo->cPDZRjISzD; RkmrPIDHER->cPDZRjISzD->nwusXUSujc = RkmrPIDHER; RkmrPIDHER->ZpmKEeobrp = gFhyfIPGPo->ZpmKEeobrp;
    }
    free(gFhyfIPGPo);
    --pbStbRleHt->eHMrxScvqm;
    if (fApCqONIor == PeAkGtYTED) VqPHGwwhYR(pbStbRleHt, YEDyNgqNUO);
    pbStbRleHt->yZTGLvnnCy.nwusXUSujc = &pbStbRleHt->yZTGLvnnCy;
    return 1;
}
static int ubLTrqkpYl(const JievaGJaLi *pbStbRleHt, const pzrvQmseVM *bniLkYncUK, long long pwnORLsMcd,
                     long long sevDJqXlIm, size_t *zIDkAblwqC) {
    if (bniLkYncUK == &pbStbRleHt->yZTGLvnnCy) return 1;
    if ((long long)bniLkYncUK->dOXBRhXhsh <= pwnORLsMcd || (long long)bniLkYncUK->dOXBRhXhsh >= sevDJqXlIm) return -1;
    if (bniLkYncUK->ZpmKEeobrp != PeAkGtYTED && bniLkYncUK->ZpmKEeobrp != lvwCHToDhE) return -1;
    if (bniLkYncUK->cPDZRjISzD != &pbStbRleHt->yZTGLvnnCy && bniLkYncUK->cPDZRjISzD->nwusXUSujc != bniLkYncUK) return -1;
    if (bniLkYncUK->BdrRlRFjtI != &pbStbRleHt->yZTGLvnnCy && bniLkYncUK->BdrRlRFjtI->nwusXUSujc != bniLkYncUK) return -1;
    if (bniLkYncUK->ZpmKEeobrp == lvwCHToDhE && (bniLkYncUK->cPDZRjISzD->ZpmKEeobrp == lvwCHToDhE || bniLkYncUK->BdrRlRFjtI->ZpmKEeobrp == lvwCHToDhE)) return -1;
    int dZfIgzBlnU = ubLTrqkpYl(pbStbRleHt, bniLkYncUK->cPDZRjISzD, pwnORLsMcd, bniLkYncUK->dOXBRhXhsh, zIDkAblwqC);
    int RTOaPeBNRR = ubLTrqkpYl(pbStbRleHt, bniLkYncUK->BdrRlRFjtI, bniLkYncUK->dOXBRhXhsh, sevDJqXlIm, zIDkAblwqC);
    if (dZfIgzBlnU < 0 || RTOaPeBNRR < 0 || dZfIgzBlnU != RTOaPeBNRR) return -1;
    ++*zIDkAblwqC;
    return dZfIgzBlnU + (bniLkYncUK->ZpmKEeobrp == PeAkGtYTED);
}
static int OQgZTrpSlt(const JievaGJaLi *pbStbRleHt) {
    size_t zIDkAblwqC = 0;
    if (pbStbRleHt->yZTGLvnnCy.ZpmKEeobrp != PeAkGtYTED || pbStbRleHt->yZTGLvnnCy.cPDZRjISzD != &pbStbRleHt->yZTGLvnnCy || pbStbRleHt->yZTGLvnnCy.BdrRlRFjtI != &pbStbRleHt->yZTGLvnnCy) return 0;
    if (pbStbRleHt->YSciqERYDt != &pbStbRleHt->yZTGLvnnCy && (pbStbRleHt->YSciqERYDt->nwusXUSujc != &pbStbRleHt->yZTGLvnnCy || pbStbRleHt->YSciqERYDt->ZpmKEeobrp != PeAkGtYTED)) return 0;
    int mOBkoxbykd = ubLTrqkpYl(pbStbRleHt, pbStbRleHt->YSciqERYDt, LLONG_MIN, LLONG_MAX, &zIDkAblwqC);
    return mOBkoxbykd > 0 && zIDkAblwqC == pbStbRleHt->eHMrxScvqm;
}
static void NgJhZOMspt(const JievaGJaLi *pbStbRleHt, const pzrvQmseVM *bniLkYncUK, int *PvSfVCHeNK) {
    if (bniLkYncUK == &pbStbRleHt->yZTGLvnnCy) return;
    NgJhZOMspt(pbStbRleHt, bniLkYncUK->cPDZRjISzD, PvSfVCHeNK);
    if (!*PvSfVCHeNK) putchar(' ');
    printf("%d:%u", bniLkYncUK->dOXBRhXhsh, (unsigned)bniLkYncUK->ZpmKEeobrp);
    *PvSfVCHeNK = 0;
    NgJhZOMspt(pbStbRleHt, bniLkYncUK->BdrRlRFjtI, PvSfVCHeNK);
}
static void UetHGLvddu(const JievaGJaLi *pbStbRleHt) {
    int PvSfVCHeNK = 1;
    NgJhZOMspt(pbStbRleHt, pbStbRleHt->YSciqERYDt, &PvSfVCHeNK);
    putchar('\n');
}
static void PbTOJJUSHQ(JievaGJaLi *pbStbRleHt, pzrvQmseVM *bniLkYncUK) {
    if (bniLkYncUK == &pbStbRleHt->yZTGLvnnCy) return;
    PbTOJJUSHQ(pbStbRleHt, bniLkYncUK->cPDZRjISzD); PbTOJJUSHQ(pbStbRleHt, bniLkYncUK->BdrRlRFjtI); free(bniLkYncUK);
}
static void dKXrQmICNF(JievaGJaLi *pbStbRleHt) { PbTOJJUSHQ(pbStbRleHt, pbStbRleHt->YSciqERYDt); dZsCIhaHjO(pbStbRleHt); }
int main(void) {
    JievaGJaLi pbStbRleHt;
    dZsCIhaHjO(&pbStbRleHt);
    int pFkkMWHELV[7] = {10, 20, 30, 15, 25, 5, 1};
    for (size_t VcAlMfgsLw = 0; VcAlMfgsLw < 7; ++VcAlMfgsLw) {
        if (!bhawOKyZvR(&pbStbRleHt, pFkkMWHELV[VcAlMfgsLw])) { dKXrQmICNF(&pbStbRleHt); return 1; }
        assert(OQgZTrpSlt(&pbStbRleHt));
    }
    UetHGLvddu(&pbStbRleHt);
    int YWFOtuRAsE = kHkESNQdbe(&pbStbRleHt, 20);
    assert(YWFOtuRAsE && OQgZTrpSlt(&pbStbRleHt));
    UetHGLvddu(&pbStbRleHt);
    int PvSfVCHeNK[3] = {1, 5, 30};
    for (size_t VcAlMfgsLw = 0; VcAlMfgsLw < 3; ++VcAlMfgsLw) {
        YWFOtuRAsE = kHkESNQdbe(&pbStbRleHt, PvSfVCHeNK[VcAlMfgsLw]);
        assert(YWFOtuRAsE && OQgZTrpSlt(&pbStbRleHt));
    }
    UetHGLvddu(&pbStbRleHt);
    int HMGzQJYRiy[3] = {15, 10, 25};
    for (size_t VcAlMfgsLw = 0; VcAlMfgsLw < 3; ++VcAlMfgsLw) {
        YWFOtuRAsE = kHkESNQdbe(&pbStbRleHt, HMGzQJYRiy[VcAlMfgsLw]);
        assert(YWFOtuRAsE && OQgZTrpSlt(&pbStbRleHt));
    }
    printf("%zu %d\n", pbStbRleHt.eHMrxScvqm, OQgZTrpSlt(&pbStbRleHt));
    dKXrQmICNF(&pbStbRleHt);
    return 0;
}
