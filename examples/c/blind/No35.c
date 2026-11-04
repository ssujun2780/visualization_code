#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <inttypes.h>
#include <stddef.h>
#include <limits.h>
#include <ctype.h>
#include <errno.h>
#include <stdarg.h>
#include <assert.h>
#include <time.h>

_Static_assert(CHAR_BIT == 8, "q000");
_Static_assert(sizeof(uint64_t) * CHAR_BIT == 64, "q001");

#ifndef orlUlgbGac
#define orlUlgbGac 16384u
#endif
#ifndef MorQDSqWyN
#define MorQDSqWyN 8192u
#endif
#ifndef FwfnlGqepY
#define FwfnlGqepY 100000u
#endif
#ifndef UCQTiIFKwI
#define UCQTiIFKwI 500000u
#endif
#ifndef vVFcLNqtTS
#define vVFcLNqtTS (256u * 1024u * 1024u)
#endif
#define SWWpIfoOBC 256u
#define bekDvCcvyb SIZE_MAX

typedef struct EwCRSAdajK EwCRSAdajK;
typedef union {
    long double dAfnGkcDzJ;
    void *cdfiJTwuyx;
    uint64_t vzfKOndlkm;
} iOQmugEpFp;

struct EwCRSAdajK {
    EwCRSAdajK *JgLZMLYuas;
    iOQmugEpFp dzfYRBbzlF[];
};

typedef struct {
    EwCRSAdajK *UpusRlYGXt;
    size_t sACRbLjFXb;
    uint64_t bNUgIxFrLQ;
    bool MwnHYICqsn;
} eHoEtJGsdE;

static void rdtAKwAvxQ(eHoEtJGsdE *fUmKdgqecC);

static _Noreturn void HNQkXxeURo(eHoEtJGsdE *fUmKdgqecC, const char *sKjXGDqXCU, ...) {
    fputs("ERROR: ", stderr);
    va_list OApVRRgosy;
    va_start(OApVRRgosy, sKjXGDqXCU);
    vfprintf(stderr, sKjXGDqXCU, OApVRRgosy);
    va_end(OApVRRgosy);
    fputc('\n', stderr);
    rdtAKwAvxQ(fUmKdgqecC);
    free(fUmKdgqecC);
    exit(2);
}

static size_t QLYdwnyvmi(eHoEtJGsdE *fUmKdgqecC, size_t cVpaliIMuV, size_t QSANfiOoyl) {
    if (QSANfiOoyl > SIZE_MAX - cVpaliIMuV) HNQkXxeURo(fUmKdgqecC, "q002");
    return cVpaliIMuV + QSANfiOoyl;
}

static size_t noylFAxNlZ(eHoEtJGsdE *fUmKdgqecC, size_t cVpaliIMuV, size_t QSANfiOoyl) {
    if (cVpaliIMuV && QSANfiOoyl > SIZE_MAX / cVpaliIMuV) HNQkXxeURo(fUmKdgqecC, "q003");
    return cVpaliIMuV * QSANfiOoyl;
}

static void *LTOrqXRbCu(eHoEtJGsdE *fUmKdgqecC, size_t UyABNyadMK) {
    size_t LxpoBAoSRc = QLYdwnyvmi(fUmKdgqecC, offsetof(EwCRSAdajK, dzfYRBbzlF), UyABNyadMK);
    if (LxpoBAoSRc < sizeof(EwCRSAdajK)) LxpoBAoSRc = sizeof(EwCRSAdajK);
    size_t txMmzIFJSq = QLYdwnyvmi(fUmKdgqecC, fUmKdgqecC->sACRbLjFXb, LxpoBAoSRc);
    if (txMmzIFJSq > (size_t)vVFcLNqtTS) HNQkXxeURo(fUmKdgqecC, "q004");
    EwCRSAdajK *VzIxDyUQZU = malloc(LxpoBAoSRc);
    if (!VzIxDyUQZU) HNQkXxeURo(fUmKdgqecC, "q005");
    VzIxDyUQZU->JgLZMLYuas = fUmKdgqecC->UpusRlYGXt;
    fUmKdgqecC->UpusRlYGXt = VzIxDyUQZU;
    fUmKdgqecC->sACRbLjFXb = txMmzIFJSq;
    assert(offsetof(EwCRSAdajK, dzfYRBbzlF) % _Alignof(iOQmugEpFp) == 0);
    memset(VzIxDyUQZU->dzfYRBbzlF, 0, UyABNyadMK);
    return VzIxDyUQZU->dzfYRBbzlF;
}

static void *qXUJTkeAkM(eHoEtJGsdE *fUmKdgqecC, size_t tIejwUjHfz, size_t UyABNyadMK) {
    return LTOrqXRbCu(fUmKdgqecC, noylFAxNlZ(fUmKdgqecC, tIejwUjHfz, UyABNyadMK));
}

static void rdtAKwAvxQ(eHoEtJGsdE *fUmKdgqecC) {
    EwCRSAdajK *VzIxDyUQZU = fUmKdgqecC->UpusRlYGXt;
    while (VzIxDyUQZU) {
        EwCRSAdajK *JgLZMLYuas = VzIxDyUQZU->JgLZMLYuas;
        free(VzIxDyUQZU);
        VzIxDyUQZU = JgLZMLYuas;
    }
}

typedef struct {
    void *MdckGCInfR;
    size_t jImtNgHXvm, KNwFhXWzvl, AvSSHgKdlt;
} WkiwxijJoq;

static void ltcNlcOMIB(eHoEtJGsdE *fUmKdgqecC, WkiwxijJoq *SlIFZxKTVo, const void *qbHXIrjVhJ) {
    if (SlIFZxKTVo->jImtNgHXvm == SlIFZxKTVo->KNwFhXWzvl) {
        size_t KNwFhXWzvl = SlIFZxKTVo->KNwFhXWzvl ? noylFAxNlZ(fUmKdgqecC, SlIFZxKTVo->KNwFhXWzvl, 2) : 8;
        void *MdckGCInfR = qXUJTkeAkM(fUmKdgqecC, KNwFhXWzvl, SlIFZxKTVo->AvSSHgKdlt);
        if (SlIFZxKTVo->jImtNgHXvm) memcpy(MdckGCInfR, SlIFZxKTVo->MdckGCInfR, SlIFZxKTVo->jImtNgHXvm * SlIFZxKTVo->AvSSHgKdlt);
        SlIFZxKTVo->MdckGCInfR = MdckGCInfR;
        SlIFZxKTVo->KNwFhXWzvl = KNwFhXWzvl;
    }
    memcpy((unsigned char *)SlIFZxKTVo->MdckGCInfR + SlIFZxKTVo->jImtNgHXvm * SlIFZxKTVo->AvSSHgKdlt,
           qbHXIrjVhJ, SlIFZxKTVo->AvSSHgKdlt);
    ++SlIFZxKTVo->jImtNgHXvm;
}

static void ysZCBofRqh(WkiwxijJoq *SlIFZxKTVo, void *qbHXIrjVhJ) {
    assert(SlIFZxKTVo->jImtNgHXvm);
    --SlIFZxKTVo->jImtNgHXvm;
    memcpy(qbHXIrjVhJ, (unsigned char *)SlIFZxKTVo->MdckGCInfR + SlIFZxKTVo->jImtNgHXvm * SlIFZxKTVo->AvSSHgKdlt,
           SlIFZxKTVo->AvSSHgKdlt);
}

typedef struct { uint64_t LyWDLsQVZs[4]; } HtWhfrOXEC;

static void ToIeVZzQYV(HtWhfrOXEC *gobwNOhflw, unsigned JOnjxvdTkt) {
    assert(JOnjxvdTkt < 256);
    gobwNOhflw->LyWDLsQVZs[JOnjxvdTkt / 64] |= UINT64_C(1) << (JOnjxvdTkt % 64);
}

static bool FgrmIllPit(const HtWhfrOXEC *gobwNOhflw, unsigned JOnjxvdTkt) {
    return (gobwNOhflw->LyWDLsQVZs[JOnjxvdTkt / 64] & (UINT64_C(1) << (JOnjxvdTkt % 64))) != 0;
}

static void xAIemuPiUw(HtWhfrOXEC *gobwNOhflw) {
    for (size_t BGSihUAduA = 0; BGSihUAduA < 4; ++BGSihUAduA) gobwNOhflw->LyWDLsQVZs[BGSihUAduA] = ~gobwNOhflw->LyWDLsQVZs[BGSihUAduA];
}

typedef enum {
    gxYshfEsBv, DYXoDvRige, cefWMfjFVp, HvXRqHFAad,
    wXinmTKyNw, RpQnUklkAv, aNPDUgqwmj, TpUkSxOHSw
} SpEnVWJGql;

typedef struct XwXKksMvCb XwXKksMvCb;
struct XwXKksMvCb {
    SpEnVWJGql prcDzlSLoR;
    union {
        HtWhfrOXEC gobwNOhflw;
        struct { XwXKksMvCb *plNuaKPNHN, *EnRBdpLrAi; } MHAZSPSnbD;
        XwXKksMvCb *rLSmOROlua;
    } KAQuyKNAnF;
};

typedef struct {
    eHoEtJGsdE *fUmKdgqecC;
    const unsigned char *FzWgrYpOnD;
    size_t jImtNgHXvm, iFhGSOakYs, pSCIMOjKgp;
    unsigned szHrQWFgkf;
} WjcboDXauv;

static _Noreturn void dUfCWqWdvl(WjcboDXauv *hhWBUYsUyZ, const char *TAZcxCbWny) {
    HNQkXxeURo(hhWBUYsUyZ->fUmKdgqecC, "q006%uq007%zu: %s",
         hhWBUYsUyZ->szHrQWFgkf, hhWBUYsUyZ->iFhGSOakYs + 1, TAZcxCbWny);
}

static XwXKksMvCb *VMOJyMSJxs(eHoEtJGsdE *fUmKdgqecC, SpEnVWJGql prcDzlSLoR) {
    XwXKksMvCb *stAQRSBWWe = LTOrqXRbCu(fUmKdgqecC, sizeof *stAQRSBWWe);
    stAQRSBWWe->prcDzlSLoR = prcDzlSLoR;
    return stAQRSBWWe;
}

static XwXKksMvCb *byTxAOhUWQ(eHoEtJGsdE *fUmKdgqecC, SpEnVWJGql prcDzlSLoR, XwXKksMvCb *plNuaKPNHN, XwXKksMvCb *EnRBdpLrAi) {
    XwXKksMvCb *stAQRSBWWe = VMOJyMSJxs(fUmKdgqecC, prcDzlSLoR);
    stAQRSBWWe->KAQuyKNAnF.MHAZSPSnbD.plNuaKPNHN = plNuaKPNHN;
    stAQRSBWWe->KAQuyKNAnF.MHAZSPSnbD.EnRBdpLrAi = EnRBdpLrAi;
    return stAQRSBWWe;
}

static unsigned caRdpGgoGl(unsigned char GXFUAzkcjt) {
    if (isdigit(GXFUAzkcjt)) return (unsigned)(GXFUAzkcjt - '0');
    return (unsigned)(tolower(GXFUAzkcjt) - 'a' + 10);
}

static unsigned QhkFlCmrWi(WjcboDXauv *hhWBUYsUyZ) {
    if (hhWBUYsUyZ->iFhGSOakYs == hhWBUYsUyZ->jImtNgHXvm) dUfCWqWdvl(hhWBUYsUyZ, "q008");
    unsigned char GXFUAzkcjt = hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs++];
    switch (GXFUAzkcjt) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'a': return '\a';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return 0;
        case 'x': {
            if (hhWBUYsUyZ->jImtNgHXvm - hhWBUYsUyZ->iFhGSOakYs < 2 ||
                !isxdigit(hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs]) ||
                !isxdigit(hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs + 1])) {
                dUfCWqWdvl(hhWBUYsUyZ, "\\q009");
            }
            unsigned sCBniKTpLj = caRdpGgoGl(hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs++]);
            unsigned zSmEcmxGzW = caRdpGgoGl(hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs++]);
            return sCBniKTpLj * 16 + zSmEcmxGzW;
        }
        default: return GXFUAzkcjt;
    }
}

static unsigned xYlhmwVChk(WjcboDXauv *hhWBUYsUyZ) {
    if (hhWBUYsUyZ->iFhGSOakYs == hhWBUYsUyZ->jImtNgHXvm) dUfCWqWdvl(hhWBUYsUyZ, "q010");
    unsigned char GXFUAzkcjt = hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs++];
    return GXFUAzkcjt == '\\' ? QhkFlCmrWi(hhWBUYsUyZ) : GXFUAzkcjt;
}

static HtWhfrOXEC UiXtrkumwy(WjcboDXauv *hhWBUYsUyZ) {
    HtWhfrOXEC gobwNOhflw = {{0}};
    bool KIHGFzzhLw = hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm && hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] == '^';
    if (KIHGFzzhLw) ++hhWBUYsUyZ->iFhGSOakYs;
    while (hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm && hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] != ']') {
        unsigned kPAvBKIKgF = xYlhmwVChk(hhWBUYsUyZ);
        if (hhWBUYsUyZ->iFhGSOakYs + 1 < hhWBUYsUyZ->jImtNgHXvm &&
            hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] == '-' && hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs + 1] != ']') {
            ++hhWBUYsUyZ->iFhGSOakYs;
            unsigned lauCWDvcJs = xYlhmwVChk(hhWBUYsUyZ);
            if (kPAvBKIKgF > lauCWDvcJs) dUfCWqWdvl(hhWBUYsUyZ, "q011");
            for (unsigned JOnjxvdTkt = kPAvBKIKgF; JOnjxvdTkt <= lauCWDvcJs; ++JOnjxvdTkt) ToIeVZzQYV(&gobwNOhflw, JOnjxvdTkt);
        } else {
            ToIeVZzQYV(&gobwNOhflw, kPAvBKIKgF);
        }
    }
    if (hhWBUYsUyZ->iFhGSOakYs == hhWBUYsUyZ->jImtNgHXvm) dUfCWqWdvl(hhWBUYsUyZ, "q012");
    ++hhWBUYsUyZ->iFhGSOakYs;
    if (KIHGFzzhLw) xAIemuPiUw(&gobwNOhflw);
    return gobwNOhflw;
}

static XwXKksMvCb *oABMKKtkXL(WjcboDXauv *hhWBUYsUyZ);

static XwXKksMvCb *IuenZCjmkb(WjcboDXauv *hhWBUYsUyZ) {
    assert(hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm);
    unsigned char GXFUAzkcjt = hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs++];
    if (GXFUAzkcjt == '(') {
        if (++hhWBUYsUyZ->pSCIMOjKgp > SWWpIfoOBC) dUfCWqWdvl(hhWBUYsUyZ, "q013");
        XwXKksMvCb *FIMcGfaNwb = oABMKKtkXL(hhWBUYsUyZ);
        if (hhWBUYsUyZ->iFhGSOakYs == hhWBUYsUyZ->jImtNgHXvm || hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] != ')') {
            dUfCWqWdvl(hhWBUYsUyZ, "q014");
        }
        ++hhWBUYsUyZ->iFhGSOakYs;
        --hhWBUYsUyZ->pSCIMOjKgp;
        return FIMcGfaNwb;
    }
    if (GXFUAzkcjt == '*' || GXFUAzkcjt == '+' || GXFUAzkcjt == '?') {
        dUfCWqWdvl(hhWBUYsUyZ, "q015");
    }
    XwXKksMvCb *stAQRSBWWe = VMOJyMSJxs(hhWBUYsUyZ->fUmKdgqecC, DYXoDvRige);
    if (GXFUAzkcjt == '[') {
        stAQRSBWWe->KAQuyKNAnF.gobwNOhflw = UiXtrkumwy(hhWBUYsUyZ);
    } else if (GXFUAzkcjt == '.') {
        xAIemuPiUw(&stAQRSBWWe->KAQuyKNAnF.gobwNOhflw);
    } else {
        ToIeVZzQYV(&stAQRSBWWe->KAQuyKNAnF.gobwNOhflw, GXFUAzkcjt == '\\' ? QhkFlCmrWi(hhWBUYsUyZ) : GXFUAzkcjt);
    }
    return stAQRSBWWe;
}

static XwXKksMvCb *lBzcRvBfDs(WjcboDXauv *hhWBUYsUyZ) {
    XwXKksMvCb *stAQRSBWWe = IuenZCjmkb(hhWBUYsUyZ);
    while (hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm) {
        SpEnVWJGql prcDzlSLoR;
        switch (hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs]) {
            case '*': prcDzlSLoR = wXinmTKyNw; break;
            case '+': prcDzlSLoR = RpQnUklkAv; break;
            case '?': prcDzlSLoR = aNPDUgqwmj; break;
            default: return stAQRSBWWe;
        }
        ++hhWBUYsUyZ->iFhGSOakYs;
        XwXKksMvCb *TVyMbqZTMw = VMOJyMSJxs(hhWBUYsUyZ->fUmKdgqecC, prcDzlSLoR);
        TVyMbqZTMw->KAQuyKNAnF.rLSmOROlua = stAQRSBWWe;
        stAQRSBWWe = TVyMbqZTMw;
    }
    return stAQRSBWWe;
}

static XwXKksMvCb *zubTQMvmjR(WjcboDXauv *hhWBUYsUyZ) {
    XwXKksMvCb *stAQRSBWWe = NULL;
    while (hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm && hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] != '|' &&
           hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] != ')') {
        XwXKksMvCb *JgLZMLYuas = lBzcRvBfDs(hhWBUYsUyZ);
        stAQRSBWWe = stAQRSBWWe ? byTxAOhUWQ(hhWBUYsUyZ->fUmKdgqecC, cefWMfjFVp, stAQRSBWWe, JgLZMLYuas) : JgLZMLYuas;
    }
    return stAQRSBWWe ? stAQRSBWWe : VMOJyMSJxs(hhWBUYsUyZ->fUmKdgqecC, gxYshfEsBv);
}

static XwXKksMvCb *oABMKKtkXL(WjcboDXauv *hhWBUYsUyZ) {
    XwXKksMvCb *stAQRSBWWe = zubTQMvmjR(hhWBUYsUyZ);
    while (hhWBUYsUyZ->iFhGSOakYs < hhWBUYsUyZ->jImtNgHXvm && hhWBUYsUyZ->FzWgrYpOnD[hhWBUYsUyZ->iFhGSOakYs] == '|') {
        ++hhWBUYsUyZ->iFhGSOakYs;
        stAQRSBWWe = byTxAOhUWQ(hhWBUYsUyZ->fUmKdgqecC, HvXRqHFAad, stAQRSBWWe, zubTQMvmjR(hhWBUYsUyZ));
    }
    return stAQRSBWWe;
}

static XwXKksMvCb *eOsVQjZAcC(eHoEtJGsdE *fUmKdgqecC, const unsigned char *FzWgrYpOnD,
                      size_t jImtNgHXvm, unsigned szHrQWFgkf) {
    WjcboDXauv GdCmGvWEcS = {
        .fUmKdgqecC = fUmKdgqecC, .FzWgrYpOnD = FzWgrYpOnD, .jImtNgHXvm = jImtNgHXvm, .szHrQWFgkf = szHrQWFgkf
    };
    XwXKksMvCb *AAbPGrBCDb = oABMKKtkXL(&GdCmGvWEcS);
    if (GdCmGvWEcS.iFhGSOakYs != GdCmGvWEcS.jImtNgHXvm) dUfCWqWdvl(&GdCmGvWEcS, "q016");
    return AAbPGrBCDb;
}

typedef enum { YojuTIjOMI, jyeuaQGENU, dthvEcNEEa, pUJzlBBWJL } mXhEFdieGS;
typedef struct XUFbWjIOYU XUFbWjIOYU;
struct XUFbWjIOYU {
    size_t ppNadvoYib;
    mXhEFdieGS prcDzlSLoR;
    HtWhfrOXEC gobwNOhflw;
    XUFbWjIOYU *PBYUseKcTs[2];
};

typedef struct FdmMsTwkmA FdmMsTwkmA;
struct FdmMsTwkmA { XUFbWjIOYU **JWUJWaxmdj; FdmMsTwkmA *JgLZMLYuas; };

typedef struct {
    XUFbWjIOYU *aAfVpSGjmE;
    FdmMsTwkmA *kPAvBKIKgF, *lauCWDvcJs;
} WfleGPACjm;

typedef struct {
    eHoEtJGsdE *fUmKdgqecC;
    WkiwxijJoq CnfpsEUHQV;
    XUFbWjIOYU *aAfVpSGjmE, *FTPtGHdwIX;
} RJJRMnUmtL;

static XUFbWjIOYU *fISztufSnH(RJJRMnUmtL *FuyvtjMGoW, mXhEFdieGS prcDzlSLoR) {
    if (FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm >= MorQDSqWyN) HNQkXxeURo(FuyvtjMGoW->fUmKdgqecC, "q017");
    XUFbWjIOYU *iqpKXJslQS = LTOrqXRbCu(FuyvtjMGoW->fUmKdgqecC, sizeof *iqpKXJslQS);
    iqpKXJslQS->ppNadvoYib = FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm;
    iqpKXJslQS->prcDzlSLoR = prcDzlSLoR;
    ltcNlcOMIB(FuyvtjMGoW->fUmKdgqecC, &FuyvtjMGoW->CnfpsEUHQV, &iqpKXJslQS);
    return iqpKXJslQS;
}

static WfleGPACjm TpcwsxZjKu(eHoEtJGsdE *fUmKdgqecC, XUFbWjIOYU *aAfVpSGjmE, XUFbWjIOYU **JWUJWaxmdj) {
    FdmMsTwkmA *DBatzSLyFL = LTOrqXRbCu(fUmKdgqecC, sizeof *DBatzSLyFL);
    DBatzSLyFL->JWUJWaxmdj = JWUJWaxmdj;
    return (WfleGPACjm){ .aAfVpSGjmE = aAfVpSGjmE, .kPAvBKIKgF = DBatzSLyFL, .lauCWDvcJs = DBatzSLyFL };
}

static WfleGPACjm wKVofsfayz(WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    if (!cVpaliIMuV.kPAvBKIKgF) return QSANfiOoyl;
    if (!QSANfiOoyl.kPAvBKIKgF) return cVpaliIMuV;
    cVpaliIMuV.lauCWDvcJs->JgLZMLYuas = QSANfiOoyl.kPAvBKIKgF;
    cVpaliIMuV.lauCWDvcJs = QSANfiOoyl.lauCWDvcJs;
    return cVpaliIMuV;
}

static void kIBeMDgbDt(WfleGPACjm PdNazdSVXM, XUFbWjIOYU *ISeLfhwFXy) {
    for (FdmMsTwkmA *hhWBUYsUyZ = PdNazdSVXM.kPAvBKIKgF; hhWBUYsUyZ; hhWBUYsUyZ = hhWBUYsUyZ->JgLZMLYuas) {
        assert(*hhWBUYsUyZ->JWUJWaxmdj == NULL);
        *hhWBUYsUyZ->JWUJWaxmdj = ISeLfhwFXy;
    }
}

typedef WfleGPACjm (*RtLyCSEdLx)(RJJRMnUmtL *, const XwXKksMvCb *, WfleGPACjm, WfleGPACjm);
typedef struct { unsigned oLgzVrzWjF; RtLyCSEdLx JBLeDvYpiU; } HrruEwXKxS;

static WfleGPACjm eMpiyAXsAo(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)stAQRSBWWe; (void)cVpaliIMuV; (void)QSANfiOoyl;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, jyeuaQGENU);
    return TpcwsxZjKu(FuyvtjMGoW->fUmKdgqecC, iqpKXJslQS, &iqpKXJslQS->PBYUseKcTs[0]);
}

static WfleGPACjm nrzyWGFfZy(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)cVpaliIMuV; (void)QSANfiOoyl;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, YojuTIjOMI);
    iqpKXJslQS->gobwNOhflw = stAQRSBWWe->KAQuyKNAnF.gobwNOhflw;
    return TpcwsxZjKu(FuyvtjMGoW->fUmKdgqecC, iqpKXJslQS, &iqpKXJslQS->PBYUseKcTs[0]);
}

static WfleGPACjm GuCwFtCffZ(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)FuyvtjMGoW; (void)stAQRSBWWe;
    kIBeMDgbDt(cVpaliIMuV, QSANfiOoyl.aAfVpSGjmE);
    QSANfiOoyl.aAfVpSGjmE = cVpaliIMuV.aAfVpSGjmE;
    return QSANfiOoyl;
}

static WfleGPACjm HHLWJiBYYh(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)stAQRSBWWe;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, dthvEcNEEa);
    iqpKXJslQS->PBYUseKcTs[0] = cVpaliIMuV.aAfVpSGjmE;
    iqpKXJslQS->PBYUseKcTs[1] = QSANfiOoyl.aAfVpSGjmE;
    WfleGPACjm gLIZYFtJtY = wKVofsfayz(cVpaliIMuV, QSANfiOoyl);
    gLIZYFtJtY.aAfVpSGjmE = iqpKXJslQS;
    return gLIZYFtJtY;
}

static WfleGPACjm AUocDRfKsM(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)stAQRSBWWe; (void)QSANfiOoyl;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, dthvEcNEEa);
    iqpKXJslQS->PBYUseKcTs[0] = cVpaliIMuV.aAfVpSGjmE;
    kIBeMDgbDt(cVpaliIMuV, iqpKXJslQS);
    return TpcwsxZjKu(FuyvtjMGoW->fUmKdgqecC, iqpKXJslQS, &iqpKXJslQS->PBYUseKcTs[1]);
}

static WfleGPACjm EhDkmzokQb(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)stAQRSBWWe; (void)QSANfiOoyl;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, dthvEcNEEa);
    iqpKXJslQS->PBYUseKcTs[0] = cVpaliIMuV.aAfVpSGjmE;
    kIBeMDgbDt(cVpaliIMuV, iqpKXJslQS);
    return TpcwsxZjKu(FuyvtjMGoW->fUmKdgqecC, cVpaliIMuV.aAfVpSGjmE, &iqpKXJslQS->PBYUseKcTs[1]);
}

static WfleGPACjm bynIvXWCFN(RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *stAQRSBWWe, WfleGPACjm cVpaliIMuV, WfleGPACjm QSANfiOoyl) {
    (void)stAQRSBWWe; (void)QSANfiOoyl;
    XUFbWjIOYU *iqpKXJslQS = fISztufSnH(FuyvtjMGoW, dthvEcNEEa);
    iqpKXJslQS->PBYUseKcTs[0] = cVpaliIMuV.aAfVpSGjmE;
    WfleGPACjm exit = TpcwsxZjKu(FuyvtjMGoW->fUmKdgqecC, iqpKXJslQS, &iqpKXJslQS->PBYUseKcTs[1]);
    WfleGPACjm gLIZYFtJtY = wKVofsfayz(cVpaliIMuV, exit);
    gLIZYFtJtY.aAfVpSGjmE = iqpKXJslQS;
    return gLIZYFtJtY;
}

static const HrruEwXKxS LgdsKNFrDR[TpUkSxOHSw] = {
    [gxYshfEsBv]  = { .oLgzVrzWjF = 0, .JBLeDvYpiU = eMpiyAXsAo },
    [DYXoDvRige]      = { .oLgzVrzWjF = 0, .JBLeDvYpiU = nrzyWGFfZy },
    [cefWMfjFVp]   = { .oLgzVrzWjF = 2, .JBLeDvYpiU = GuCwFtCffZ },
    [HvXRqHFAad]      = { .oLgzVrzWjF = 2, .JBLeDvYpiU = HHLWJiBYYh },
    [wXinmTKyNw]     = { .oLgzVrzWjF = 1, .JBLeDvYpiU = AUocDRfKsM },
    [RpQnUklkAv]     = { .oLgzVrzWjF = 1, .JBLeDvYpiU = EhDkmzokQb },
    [aNPDUgqwmj] = { .oLgzVrzWjF = 1, .JBLeDvYpiU = bynIvXWCFN }
};

typedef struct { const XwXKksMvCb *stAQRSBWWe; bool pHgEIzUvAs; } YLFFjJjKGS;

static void zdBiPTdatc(eHoEtJGsdE *fUmKdgqecC, RJJRMnUmtL *FuyvtjMGoW, const XwXKksMvCb *AAbPGrBCDb) {
    FuyvtjMGoW->fUmKdgqecC = fUmKdgqecC;
    FuyvtjMGoW->CnfpsEUHQV.AvSSHgKdlt = sizeof(XUFbWjIOYU *);
    WkiwxijJoq HMwGuGiJWJ = { .AvSSHgKdlt = sizeof(YLFFjJjKGS) };
    WkiwxijJoq cJugrexvcW = { .AvSSHgKdlt = sizeof(WfleGPACjm) };
    YLFFjJjKGS kPAvBKIKgF = { .stAQRSBWWe = AAbPGrBCDb };
    ltcNlcOMIB(fUmKdgqecC, &HMwGuGiJWJ, &kPAvBKIKgF);
    while (HMwGuGiJWJ.jImtNgHXvm) {
        YLFFjJjKGS NPxkfmtOIR;
        ysZCBofRqh(&HMwGuGiJWJ, &NPxkfmtOIR);
        const HrruEwXKxS *otbMuzcbcU = &LgdsKNFrDR[NPxkfmtOIR.stAQRSBWWe->prcDzlSLoR];
        if (!NPxkfmtOIR.pHgEIzUvAs) {
            YLFFjJjKGS pHgEIzUvAs = { .stAQRSBWWe = NPxkfmtOIR.stAQRSBWWe, .pHgEIzUvAs = true };
            ltcNlcOMIB(fUmKdgqecC, &HMwGuGiJWJ, &pHgEIzUvAs);
            if (otbMuzcbcU->oLgzVrzWjF == 2) {
                YLFFjJjKGS EnRBdpLrAi = { .stAQRSBWWe = NPxkfmtOIR.stAQRSBWWe->KAQuyKNAnF.MHAZSPSnbD.EnRBdpLrAi };
                YLFFjJjKGS plNuaKPNHN = { .stAQRSBWWe = NPxkfmtOIR.stAQRSBWWe->KAQuyKNAnF.MHAZSPSnbD.plNuaKPNHN };
                ltcNlcOMIB(fUmKdgqecC, &HMwGuGiJWJ, &EnRBdpLrAi);
                ltcNlcOMIB(fUmKdgqecC, &HMwGuGiJWJ, &plNuaKPNHN);
            } else if (otbMuzcbcU->oLgzVrzWjF == 1) {
                YLFFjJjKGS rLSmOROlua = { .stAQRSBWWe = NPxkfmtOIR.stAQRSBWWe->KAQuyKNAnF.rLSmOROlua };
                ltcNlcOMIB(fUmKdgqecC, &HMwGuGiJWJ, &rLSmOROlua);
            }
        } else {
            WfleGPACjm cVpaliIMuV = {0}, QSANfiOoyl = {0};
            if (otbMuzcbcU->oLgzVrzWjF == 2) ysZCBofRqh(&cJugrexvcW, &QSANfiOoyl);
            if (otbMuzcbcU->oLgzVrzWjF >= 1) ysZCBofRqh(&cJugrexvcW, &cVpaliIMuV);
            WfleGPACjm gLIZYFtJtY = otbMuzcbcU->JBLeDvYpiU(FuyvtjMGoW, NPxkfmtOIR.stAQRSBWWe, cVpaliIMuV, QSANfiOoyl);
            ltcNlcOMIB(fUmKdgqecC, &cJugrexvcW, &gLIZYFtJtY);
        }
    }
    assert(cJugrexvcW.jImtNgHXvm == 1);
    WfleGPACjm gLIZYFtJtY;
    ysZCBofRqh(&cJugrexvcW, &gLIZYFtJtY);
    FuyvtjMGoW->FTPtGHdwIX = fISztufSnH(FuyvtjMGoW, pUJzlBBWJL);
    kIBeMDgbDt(gLIZYFtJtY, FuyvtjMGoW->FTPtGHdwIX);
    FuyvtjMGoW->aAfVpSGjmE = gLIZYFtJtY.aAfVpSGjmE;
}

typedef struct { unsigned char pgRZLMCcnV[256]; size_t jImtNgHXvm; } sWOiRPCwFj;

static sWOiRPCwFj keoapbskyZ(const RJJRMnUmtL *plNuaKPNHN, const RJJRMnUmtL *EnRBdpLrAi) {
    HtWhfrOXEC gobwNOhflw = {{0}};
    const RJJRMnUmtL *pVpTKJXdbB[] = {plNuaKPNHN, EnRBdpLrAi};
    for (size_t tOCAowcAiJ = 0; tOCAowcAiJ < 2; ++tOCAowcAiJ) {
        XUFbWjIOYU *const *CnfpsEUHQV = pVpTKJXdbB[tOCAowcAiJ]->CnfpsEUHQV.MdckGCInfR;
        for (size_t BGSihUAduA = 0; BGSihUAduA < pVpTKJXdbB[tOCAowcAiJ]->CnfpsEUHQV.jImtNgHXvm; ++BGSihUAduA) {
            if (CnfpsEUHQV[BGSihUAduA]->prcDzlSLoR != YojuTIjOMI) continue;
            for (size_t TcoIkkVEEV = 0; TcoIkkVEEV < 4; ++TcoIkkVEEV) gobwNOhflw.LyWDLsQVZs[TcoIkkVEEV] |= CnfpsEUHQV[BGSihUAduA]->gobwNOhflw.LyWDLsQVZs[TcoIkkVEEV];
        }
    }
    sWOiRPCwFj POMuNMucdj = {0};
    for (unsigned JOnjxvdTkt = 0; JOnjxvdTkt < 256; ++JOnjxvdTkt) {
        if (FgrmIllPit(&gobwNOhflw, JOnjxvdTkt)) POMuNMucdj.pgRZLMCcnV[POMuNMucdj.jImtNgHXvm++] = (unsigned char)JOnjxvdTkt;
    }
    return POMuNMucdj;
}

typedef struct nxxkUMegOT nxxkUMegOT;
struct nxxkUMegOT {
    size_t ppNadvoYib;
    uint64_t ENTGxPIRGX;
    bool jhKaYncMQz;
    size_t *JgLZMLYuas;
    uint64_t IIbCABjoLK[];
};

typedef struct {
    eHoEtJGsdE *fUmKdgqecC;
    const RJJRMnUmtL *FuyvtjMGoW;
    const sWOiRPCwFj *POMuNMucdj;
    size_t EjYapauZcw;
    WkiwxijJoq CnfpsEUHQV;
    nxxkUMegOT **QpykTYRUHp;
    size_t wZbWHElHLo;
    uint64_t *sDGkOJUdtD;
    XUFbWjIOYU **LLGdnglZKW;
    size_t WlLFUzltGd;
    size_t PRRixztVYm;
} nYVqRXSGSK;

static uint64_t aSOUjqgRFM(const uint64_t *LyWDLsQVZs, size_t tIejwUjHfz) {
    uint64_t ENTGxPIRGX = UINT64_C(14695981039346656037);
    for (size_t BGSihUAduA = 0; BGSihUAduA < tIejwUjHfz; ++BGSihUAduA) {
        uint64_t ZGJhiHUpKJ = LyWDLsQVZs[BGSihUAduA];
        for (unsigned TcoIkkVEEV = 0; TcoIkkVEEV < 8; ++TcoIkkVEEV) {
            ENTGxPIRGX ^= ZGJhiHUpKJ & UINT64_C(255);
            ENTGxPIRGX *= UINT64_C(1099511628211);
            ZGJhiHUpKJ >>= 8;
        }
    }
    return ENTGxPIRGX;
}

static bool bLxMKthaOh(const uint64_t *IIbCABjoLK, size_t ppNadvoYib) {
    return (IIbCABjoLK[ppNadvoYib / 64] & (UINT64_C(1) << (ppNadvoYib % 64))) != 0;
}

static void OnmpyifNaT(nYVqRXSGSK *vaXOVRYnOP, XUFbWjIOYU *iqpKXJslQS) {
    if (!iqpKXJslQS || bLxMKthaOh(vaXOVRYnOP->sDGkOJUdtD, iqpKXJslQS->ppNadvoYib)) return;
    vaXOVRYnOP->sDGkOJUdtD[iqpKXJslQS->ppNadvoYib / 64] |= UINT64_C(1) << (iqpKXJslQS->ppNadvoYib % 64);
    assert(vaXOVRYnOP->WlLFUzltGd < vaXOVRYnOP->FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm);
    vaXOVRYnOP->LLGdnglZKW[vaXOVRYnOP->WlLFUzltGd++] = iqpKXJslQS;
}

static void nwvGcTzOre(nYVqRXSGSK *vaXOVRYnOP) {
    while (vaXOVRYnOP->WlLFUzltGd) {
        XUFbWjIOYU *iqpKXJslQS = vaXOVRYnOP->LLGdnglZKW[--vaXOVRYnOP->WlLFUzltGd];
        switch (iqpKXJslQS->prcDzlSLoR) {
            case dthvEcNEEa:
                OnmpyifNaT(vaXOVRYnOP, iqpKXJslQS->PBYUseKcTs[1]);

                /* fall through */
            case jyeuaQGENU:
                OnmpyifNaT(vaXOVRYnOP, iqpKXJslQS->PBYUseKcTs[0]);
                break;
            case YojuTIjOMI:
            case pUJzlBBWJL:
                break;
        }
    }
}

static void ghHcGgYnbw(nYVqRXSGSK *vaXOVRYnOP, size_t KNwFhXWzvl) {
    nxxkUMegOT **QpykTYRUHp = qXUJTkeAkM(vaXOVRYnOP->fUmKdgqecC, KNwFhXWzvl, sizeof *QpykTYRUHp);
    nxxkUMegOT *const *CnfpsEUHQV = vaXOVRYnOP->CnfpsEUHQV.MdckGCInfR;
    for (size_t BGSihUAduA = 0; BGSihUAduA < vaXOVRYnOP->CnfpsEUHQV.jImtNgHXvm; ++BGSihUAduA) {
        size_t JWUJWaxmdj = (size_t)CnfpsEUHQV[BGSihUAduA]->ENTGxPIRGX & (KNwFhXWzvl - 1);
        while (QpykTYRUHp[JWUJWaxmdj]) JWUJWaxmdj = (JWUJWaxmdj + 1) & (KNwFhXWzvl - 1);
        QpykTYRUHp[JWUJWaxmdj] = CnfpsEUHQV[BGSihUAduA];
    }
    vaXOVRYnOP->QpykTYRUHp = QpykTYRUHp;
    vaXOVRYnOP->wZbWHElHLo = KNwFhXWzvl;
}

static size_t WSEpDtEUms(nYVqRXSGSK *vaXOVRYnOP) {
    uint64_t ENTGxPIRGX = aSOUjqgRFM(vaXOVRYnOP->sDGkOJUdtD, vaXOVRYnOP->EjYapauZcw);
    size_t JWUJWaxmdj = (size_t)ENTGxPIRGX & (vaXOVRYnOP->wZbWHElHLo - 1);
    size_t pgRZLMCcnV = noylFAxNlZ(vaXOVRYnOP->fUmKdgqecC, vaXOVRYnOP->EjYapauZcw, sizeof(uint64_t));
    while (vaXOVRYnOP->QpykTYRUHp[JWUJWaxmdj]) {
        nxxkUMegOT *iqpKXJslQS = vaXOVRYnOP->QpykTYRUHp[JWUJWaxmdj];
        if (iqpKXJslQS->ENTGxPIRGX == ENTGxPIRGX && memcmp(iqpKXJslQS->IIbCABjoLK, vaXOVRYnOP->sDGkOJUdtD, pgRZLMCcnV) == 0) {
            return iqpKXJslQS->ppNadvoYib;
        }
        JWUJWaxmdj = (JWUJWaxmdj + 1) & (vaXOVRYnOP->wZbWHElHLo - 1);
    }
    if (vaXOVRYnOP->CnfpsEUHQV.jImtNgHXvm >= FwfnlGqepY) HNQkXxeURo(vaXOVRYnOP->fUmKdgqecC, "q018");
    if (vaXOVRYnOP->CnfpsEUHQV.jImtNgHXvm + 1 > vaXOVRYnOP->wZbWHElHLo / 2) {
        ghHcGgYnbw(vaXOVRYnOP, noylFAxNlZ(vaXOVRYnOP->fUmKdgqecC, vaXOVRYnOP->wZbWHElHLo, 2));
        JWUJWaxmdj = (size_t)ENTGxPIRGX & (vaXOVRYnOP->wZbWHElHLo - 1);
        while (vaXOVRYnOP->QpykTYRUHp[JWUJWaxmdj]) JWUJWaxmdj = (JWUJWaxmdj + 1) & (vaXOVRYnOP->wZbWHElHLo - 1);
    }
    size_t XMBczbWafB = QLYdwnyvmi(vaXOVRYnOP->fUmKdgqecC, sizeof(nxxkUMegOT), pgRZLMCcnV);
    nxxkUMegOT *iqpKXJslQS = LTOrqXRbCu(vaXOVRYnOP->fUmKdgqecC, XMBczbWafB);
    iqpKXJslQS->ppNadvoYib = vaXOVRYnOP->CnfpsEUHQV.jImtNgHXvm;
    iqpKXJslQS->ENTGxPIRGX = ENTGxPIRGX;
    iqpKXJslQS->jhKaYncMQz = bLxMKthaOh(vaXOVRYnOP->sDGkOJUdtD, vaXOVRYnOP->FuyvtjMGoW->FTPtGHdwIX->ppNadvoYib);
    memcpy(iqpKXJslQS->IIbCABjoLK, vaXOVRYnOP->sDGkOJUdtD, pgRZLMCcnV);
    iqpKXJslQS->JgLZMLYuas = qXUJTkeAkM(vaXOVRYnOP->fUmKdgqecC, vaXOVRYnOP->POMuNMucdj->jImtNgHXvm, sizeof *iqpKXJslQS->JgLZMLYuas);
    for (size_t BGSihUAduA = 0; BGSihUAduA < vaXOVRYnOP->POMuNMucdj->jImtNgHXvm; ++BGSihUAduA) iqpKXJslQS->JgLZMLYuas[BGSihUAduA] = bekDvCcvyb;
    ltcNlcOMIB(vaXOVRYnOP->fUmKdgqecC, &vaXOVRYnOP->CnfpsEUHQV, &iqpKXJslQS);
    vaXOVRYnOP->QpykTYRUHp[JWUJWaxmdj] = iqpKXJslQS;
    return iqpKXJslQS->ppNadvoYib;
}

static void yddWKvuszm(eHoEtJGsdE *fUmKdgqecC, nYVqRXSGSK *vaXOVRYnOP, const RJJRMnUmtL *FuyvtjMGoW,
                     const sWOiRPCwFj *POMuNMucdj) {
    vaXOVRYnOP->fUmKdgqecC = fUmKdgqecC;
    vaXOVRYnOP->FuyvtjMGoW = FuyvtjMGoW;
    vaXOVRYnOP->POMuNMucdj = POMuNMucdj;
    vaXOVRYnOP->EjYapauZcw = (FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm + 63) / 64;
    vaXOVRYnOP->CnfpsEUHQV.AvSSHgKdlt = sizeof(nxxkUMegOT *);
    vaXOVRYnOP->sDGkOJUdtD = qXUJTkeAkM(fUmKdgqecC, vaXOVRYnOP->EjYapauZcw, sizeof *vaXOVRYnOP->sDGkOJUdtD);
    vaXOVRYnOP->LLGdnglZKW = qXUJTkeAkM(fUmKdgqecC, FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm, sizeof *vaXOVRYnOP->LLGdnglZKW);
    ghHcGgYnbw(vaXOVRYnOP, 16);
    OnmpyifNaT(vaXOVRYnOP, FuyvtjMGoW->aAfVpSGjmE);
    nwvGcTzOre(vaXOVRYnOP);
    vaXOVRYnOP->PRRixztVYm = WSEpDtEUms(vaXOVRYnOP);
}

static nxxkUMegOT *NOFDaeFrRB(const nYVqRXSGSK *vaXOVRYnOP, size_t ppNadvoYib) {
    assert(ppNadvoYib < vaXOVRYnOP->CnfpsEUHQV.jImtNgHXvm);
    return ((nxxkUMegOT **)vaXOVRYnOP->CnfpsEUHQV.MdckGCInfR)[ppNadvoYib];
}

static size_t NLnboVNzMi(nYVqRXSGSK *vaXOVRYnOP, size_t ppNadvoYib, size_t oeylGScdKw) {
    nxxkUMegOT *qqBCstPOea = NOFDaeFrRB(vaXOVRYnOP, ppNadvoYib);
    if (qqBCstPOea->JgLZMLYuas[oeylGScdKw] != bekDvCcvyb) return qqBCstPOea->JgLZMLYuas[oeylGScdKw];
    ++vaXOVRYnOP->fUmKdgqecC->bNUgIxFrLQ;
    memset(vaXOVRYnOP->sDGkOJUdtD, 0, vaXOVRYnOP->EjYapauZcw * sizeof *vaXOVRYnOP->sDGkOJUdtD);
    assert(vaXOVRYnOP->WlLFUzltGd == 0);
    unsigned char JOnjxvdTkt = vaXOVRYnOP->POMuNMucdj->pgRZLMCcnV[oeylGScdKw];
    XUFbWjIOYU *const *CnfpsEUHQV = vaXOVRYnOP->FuyvtjMGoW->CnfpsEUHQV.MdckGCInfR;
    for (size_t BGSihUAduA = 0; BGSihUAduA < vaXOVRYnOP->FuyvtjMGoW->CnfpsEUHQV.jImtNgHXvm; ++BGSihUAduA) {
        XUFbWjIOYU *iqpKXJslQS = CnfpsEUHQV[BGSihUAduA];
        if (iqpKXJslQS->prcDzlSLoR == YojuTIjOMI && bLxMKthaOh(qqBCstPOea->IIbCABjoLK, BGSihUAduA) &&
            FgrmIllPit(&iqpKXJslQS->gobwNOhflw, JOnjxvdTkt)) {
            OnmpyifNaT(vaXOVRYnOP, iqpKXJslQS->PBYUseKcTs[0]);
        }
    }
    nwvGcTzOre(vaXOVRYnOP);
    size_t SMbmwvpoxK = WSEpDtEUms(vaXOVRYnOP);
    qqBCstPOea->JgLZMLYuas[oeylGScdKw] = SMbmwvpoxK;
    return SMbmwvpoxK;
}

typedef struct {
    size_t plNuaKPNHN, EnRBdpLrAi, TVyMbqZTMw, pSCIMOjKgp;
    unsigned char WgTYzTHDdD;
} feBqPvKykR;

typedef struct {
    eHoEtJGsdE *fUmKdgqecC;
    WkiwxijJoq reJWspWTJD;
    size_t *QpykTYRUHp;
    size_t wZbWHElHLo;
} SfPfnxlDpj;

typedef struct { size_t ppNadvoYib; bool lEVLthQjHf; } myrVKlbCtu;

static uint64_t vlsLGPlywA(uint64_t EvAGbsnLRu) {
    EvAGbsnLRu ^= EvAGbsnLRu >> 30;
    EvAGbsnLRu *= UINT64_C(0xbf58476d1ce4e5b9);
    EvAGbsnLRu ^= EvAGbsnLRu >> 27;
    EvAGbsnLRu *= UINT64_C(0x94d049bb133111eb);
    return EvAGbsnLRu ^ (EvAGbsnLRu >> 31);
}

static uint64_t bkizKhvfYS(size_t plNuaKPNHN, size_t EnRBdpLrAi) {
    return vlsLGPlywA((uint64_t)plNuaKPNHN) ^ vlsLGPlywA((uint64_t)EnRBdpLrAi + UINT64_C(0x9e3779b97f4a7c15));
}

static void SjmzKUeick(SfPfnxlDpj *rGjcoCiGYD, size_t KNwFhXWzvl) {
    size_t *QpykTYRUHp = qXUJTkeAkM(rGjcoCiGYD->fUmKdgqecC, KNwFhXWzvl, sizeof *QpykTYRUHp);
    const feBqPvKykR *reJWspWTJD = rGjcoCiGYD->reJWspWTJD.MdckGCInfR;
    for (size_t BGSihUAduA = 0; BGSihUAduA < rGjcoCiGYD->reJWspWTJD.jImtNgHXvm; ++BGSihUAduA) {
        size_t JWUJWaxmdj = (size_t)bkizKhvfYS(reJWspWTJD[BGSihUAduA].plNuaKPNHN, reJWspWTJD[BGSihUAduA].EnRBdpLrAi) & (KNwFhXWzvl - 1);
        while (QpykTYRUHp[JWUJWaxmdj]) JWUJWaxmdj = (JWUJWaxmdj + 1) & (KNwFhXWzvl - 1);
        QpykTYRUHp[JWUJWaxmdj] = BGSihUAduA + 1;
    }
    rGjcoCiGYD->QpykTYRUHp = QpykTYRUHp;
    rGjcoCiGYD->wZbWHElHLo = KNwFhXWzvl;
}

static myrVKlbCtu RABwyMQglM(SfPfnxlDpj *rGjcoCiGYD, feBqPvKykR stAQRSBWWe) {
    size_t JWUJWaxmdj = (size_t)bkizKhvfYS(stAQRSBWWe.plNuaKPNHN, stAQRSBWWe.EnRBdpLrAi) & (rGjcoCiGYD->wZbWHElHLo - 1);
    const feBqPvKykR *reJWspWTJD = rGjcoCiGYD->reJWspWTJD.MdckGCInfR;
    while (rGjcoCiGYD->QpykTYRUHp[JWUJWaxmdj]) {
        size_t ppNadvoYib = rGjcoCiGYD->QpykTYRUHp[JWUJWaxmdj] - 1;
        if (reJWspWTJD[ppNadvoYib].plNuaKPNHN == stAQRSBWWe.plNuaKPNHN && reJWspWTJD[ppNadvoYib].EnRBdpLrAi == stAQRSBWWe.EnRBdpLrAi) {
            return (myrVKlbCtu){ .ppNadvoYib = ppNadvoYib, .lEVLthQjHf = false };
        }
        JWUJWaxmdj = (JWUJWaxmdj + 1) & (rGjcoCiGYD->wZbWHElHLo - 1);
    }
    if (rGjcoCiGYD->reJWspWTJD.jImtNgHXvm >= UCQTiIFKwI) HNQkXxeURo(rGjcoCiGYD->fUmKdgqecC, "q019");
    if (rGjcoCiGYD->reJWspWTJD.jImtNgHXvm + 1 > rGjcoCiGYD->wZbWHElHLo / 2) {
        SjmzKUeick(rGjcoCiGYD, noylFAxNlZ(rGjcoCiGYD->fUmKdgqecC, rGjcoCiGYD->wZbWHElHLo, 2));
        JWUJWaxmdj = (size_t)bkizKhvfYS(stAQRSBWWe.plNuaKPNHN, stAQRSBWWe.EnRBdpLrAi) & (rGjcoCiGYD->wZbWHElHLo - 1);
        while (rGjcoCiGYD->QpykTYRUHp[JWUJWaxmdj]) JWUJWaxmdj = (JWUJWaxmdj + 1) & (rGjcoCiGYD->wZbWHElHLo - 1);
    }
    size_t ppNadvoYib = rGjcoCiGYD->reJWspWTJD.jImtNgHXvm;
    ltcNlcOMIB(rGjcoCiGYD->fUmKdgqecC, &rGjcoCiGYD->reJWspWTJD, &stAQRSBWWe);
    rGjcoCiGYD->QpykTYRUHp[JWUJWaxmdj] = ppNadvoYib + 1;
    return (myrVKlbCtu){ .ppNadvoYib = ppNadvoYib, .lEVLthQjHf = true };
}

static bool EklKxBGtPl(const nYVqRXSGSK *plNuaKPNHN, const nYVqRXSGSK *EnRBdpLrAi,
                               size_t cfBkewLsRd, size_t YARWDYddCP) {
    return NOFDaeFrRB(plNuaKPNHN, cfBkewLsRd)->jhKaYncMQz != NOFDaeFrRB(EnRBdpLrAi, YARWDYddCP)->jhKaYncMQz;
}

static size_t SVnnWrcUVF(eHoEtJGsdE *fUmKdgqecC, nYVqRXSGSK *plNuaKPNHN, nYVqRXSGSK *EnRBdpLrAi,
                               SfPfnxlDpj *rGjcoCiGYD) {
    rGjcoCiGYD->fUmKdgqecC = fUmKdgqecC;
    rGjcoCiGYD->reJWspWTJD.AvSSHgKdlt = sizeof(feBqPvKykR);
    SjmzKUeick(rGjcoCiGYD, 16);
    feBqPvKykR PRRixztVYm = {
        .plNuaKPNHN = plNuaKPNHN->PRRixztVYm, .EnRBdpLrAi = EnRBdpLrAi->PRRixztVYm, .TVyMbqZTMw = bekDvCcvyb
    };
    myrVKlbCtu kPAvBKIKgF = RABwyMQglM(rGjcoCiGYD, PRRixztVYm);
    if (EklKxBGtPl(plNuaKPNHN, EnRBdpLrAi, PRRixztVYm.plNuaKPNHN, PRRixztVYm.EnRBdpLrAi)) return kPAvBKIKgF.ppNadvoYib;
    for (size_t xLVQzYknxN = 0; xLVQzYknxN < rGjcoCiGYD->reJWspWTJD.jImtNgHXvm; ++xLVQzYknxN) {

        feBqPvKykR QyVeGwoSdY = ((feBqPvKykR *)rGjcoCiGYD->reJWspWTJD.MdckGCInfR)[xLVQzYknxN];
        for (size_t oeylGScdKw = 0; oeylGScdKw < plNuaKPNHN->POMuNMucdj->jImtNgHXvm; ++oeylGScdKw) {
            size_t cVpaliIMuV = NLnboVNzMi(plNuaKPNHN, QyVeGwoSdY.plNuaKPNHN, oeylGScdKw);
            size_t QSANfiOoyl = NLnboVNzMi(EnRBdpLrAi, QyVeGwoSdY.EnRBdpLrAi, oeylGScdKw);
            feBqPvKykR JgLZMLYuas = {
                .plNuaKPNHN = cVpaliIMuV, .EnRBdpLrAi = QSANfiOoyl, .TVyMbqZTMw = xLVQzYknxN,
                .pSCIMOjKgp = QLYdwnyvmi(fUmKdgqecC, QyVeGwoSdY.pSCIMOjKgp, 1),
                .WgTYzTHDdD = plNuaKPNHN->POMuNMucdj->pgRZLMCcnV[oeylGScdKw]
            };
            myrVKlbCtu XWdEHsZZAb = RABwyMQglM(rGjcoCiGYD, JgLZMLYuas);
            if (XWdEHsZZAb.lEVLthQjHf && EklKxBGtPl(plNuaKPNHN, EnRBdpLrAi, cVpaliIMuV, QSANfiOoyl)) return XWdEHsZZAb.ppNadvoYib;
        }
    }
    return bekDvCcvyb;
}

typedef struct { const unsigned char *FzWgrYpOnD; size_t jImtNgHXvm; } rqUIRPmUhV;

static rqUIRPmUhV dEjFEakSfT(eHoEtJGsdE *fUmKdgqecC, unsigned szHrQWFgkf) {
    WkiwxijJoq line = { .AvSSHgKdlt = sizeof(unsigned char) };
    int GXFUAzkcjt;
    while ((GXFUAzkcjt = fgetc(stdin)) != EOF && GXFUAzkcjt != '\n') {
        if (line.jImtNgHXvm >= (size_t)orlUlgbGac + 1) HNQkXxeURo(fUmKdgqecC, "q020");
        unsigned char JOnjxvdTkt = (unsigned char)GXFUAzkcjt;
        ltcNlcOMIB(fUmKdgqecC, &line, &JOnjxvdTkt);
    }
    if (ferror(stdin)) HNQkXxeURo(fUmKdgqecC, "q021%s", strerror(errno));
    if (GXFUAzkcjt == EOF && !line.jImtNgHXvm) HNQkXxeURo(fUmKdgqecC, "q022%u", szHrQWFgkf);
    unsigned char *MdckGCInfR = line.MdckGCInfR;
    if (line.jImtNgHXvm && MdckGCInfR[line.jImtNgHXvm - 1] == '\r') --line.jImtNgHXvm;
    if (line.jImtNgHXvm > orlUlgbGac) HNQkXxeURo(fUmKdgqecC, "q023");
    return (rqUIRPmUhV){ .FzWgrYpOnD = MdckGCInfR, .jImtNgHXvm = line.jImtNgHXvm };
}

static void yIgAQKkqFc(const unsigned char *FzWgrYpOnD, size_t jImtNgHXvm) {
    putchar('"');
    for (size_t BGSihUAduA = 0; BGSihUAduA < jImtNgHXvm; ++BGSihUAduA) {
        unsigned char GXFUAzkcjt = FzWgrYpOnD[BGSihUAduA];
        switch (GXFUAzkcjt) {
            case '\\': fputs("\\\\", stdout); break;
            case '"': fputs("\\\"", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            default:
                if (GXFUAzkcjt >= 32 && GXFUAzkcjt <= 126) putchar(GXFUAzkcjt);
                else printf("\\x%02X", (unsigned)GXFUAzkcjt);
        }
    }
    putchar('"');
}

static void bmCWWHpJLj(eHoEtJGsdE *fUmKdgqecC, const nYVqRXSGSK *plNuaKPNHN, const SfPfnxlDpj *rGjcoCiGYD,
                         size_t ZURqgCKxbm) {
    if (ZURqgCKxbm == bekDvCcvyb) {
        puts("EQUIVALENT");
        return;
    }
    const feBqPvKykR *reJWspWTJD = rGjcoCiGYD->reJWspWTJD.MdckGCInfR;
    size_t jImtNgHXvm = reJWspWTJD[ZURqgCKxbm].pSCIMOjKgp;
    unsigned char *DCHOLQDasK = qXUJTkeAkM(fUmKdgqecC, jImtNgHXvm, sizeof *DCHOLQDasK);
    size_t ppNadvoYib = ZURqgCKxbm;
    for (size_t BGSihUAduA = jImtNgHXvm; BGSihUAduA; --BGSihUAduA) {
        DCHOLQDasK[BGSihUAduA - 1] = reJWspWTJD[ppNadvoYib].WgTYzTHDdD;
        ppNadvoYib = reJWspWTJD[ppNadvoYib].TVyMbqZTMw;
    }
    assert(reJWspWTJD[ppNadvoYib].TVyMbqZTMw == bekDvCcvyb);
    puts("NOT EQUIVALENT");
    fputs("WITNESS ", stdout);
    yIgAQKkqFc(DCHOLQDasK, jImtNgHXvm);
    printf("\nLENGTH %zu\nACCEPTED_BY %d\n", jImtNgHXvm,
           NOFDaeFrRB(plNuaKPNHN, reJWspWTJD[ZURqgCKxbm].plNuaKPNHN)->jhKaYncMQz ? 1 : 2);
}

static void XeTjcWAZcH(const char *LwooTBuULk) {
    printf("q024%sq025\n", LwooTBuULk);
    puts("q026");
    puts("q027");
    puts("q028\\n \\r \\t \\a \\b \\f \\v \\0 \\q029");
    puts("q030");
    puts("q031");
    puts("q032");
    puts("q033");
}

int main(int uBVRjBkvoZ, char **jTyJqdVQPb) {
    bool MwnHYICqsn = false;
    if (uBVRjBkvoZ == 2 && strcmp(jTyJqdVQPb[1], "--help") == 0) {
        XeTjcWAZcH(jTyJqdVQPb[0]);
        return 0;
    }
    if (uBVRjBkvoZ == 2 && strcmp(jTyJqdVQPb[1], "--stats") == 0) MwnHYICqsn = true;
    else if (uBVRjBkvoZ != 1) {
        fprintf(stderr, "q034%sq035\n", jTyJqdVQPb[0]);
        return 2;
    }
    eHoEtJGsdE *fUmKdgqecC = calloc(1, sizeof *fUmKdgqecC);
    if (!fUmKdgqecC) {
        fputs("q036\n", stderr);
        return 2;
    }
    fUmKdgqecC->MwnHYICqsn = MwnHYICqsn;
    clock_t aAfVpSGjmE = clock();
    rqUIRPmUhV mTNStRjhHz[2];
    XwXKksMvCb *mFtuYzyYej[2];
    RJJRMnUmtL pVpTKJXdbB[2] = {{0}};
    nYVqRXSGSK WrcbMrLvVn[2] = {{0}};
    for (unsigned BGSihUAduA = 0; BGSihUAduA < 2; ++BGSihUAduA) {
        mTNStRjhHz[BGSihUAduA] = dEjFEakSfT(fUmKdgqecC, BGSihUAduA + 1);
        mFtuYzyYej[BGSihUAduA] = eOsVQjZAcC(fUmKdgqecC, mTNStRjhHz[BGSihUAduA].FzWgrYpOnD, mTNStRjhHz[BGSihUAduA].jImtNgHXvm, BGSihUAduA + 1);
        zdBiPTdatc(fUmKdgqecC, &pVpTKJXdbB[BGSihUAduA], mFtuYzyYej[BGSihUAduA]);
    }
    sWOiRPCwFj POMuNMucdj = keoapbskyZ(&pVpTKJXdbB[0], &pVpTKJXdbB[1]);

    yddWKvuszm(fUmKdgqecC, &WrcbMrLvVn[0], &pVpTKJXdbB[0], &POMuNMucdj);
    yddWKvuszm(fUmKdgqecC, &WrcbMrLvVn[1], &pVpTKJXdbB[1], &POMuNMucdj);
    SfPfnxlDpj rGjcoCiGYD = {0};
    size_t ZURqgCKxbm = SVnnWrcUVF(fUmKdgqecC, &WrcbMrLvVn[0], &WrcbMrLvVn[1], &rGjcoCiGYD);
    bmCWWHpJLj(fUmKdgqecC, &WrcbMrLvVn[0], &rGjcoCiGYD, ZURqgCKxbm);
    if (fUmKdgqecC->MwnHYICqsn) {
        fprintf(stderr, "q037%zu / %zu\n", pVpTKJXdbB[0].CnfpsEUHQV.jImtNgHXvm, pVpTKJXdbB[1].CnfpsEUHQV.jImtNgHXvm);
        fprintf(stderr, "q038%zu / %zu\n", WrcbMrLvVn[0].CnfpsEUHQV.jImtNgHXvm, WrcbMrLvVn[1].CnfpsEUHQV.jImtNgHXvm);
        fprintf(stderr, "q039%zu\nq040%zu\n",
                rGjcoCiGYD.reJWspWTJD.jImtNgHXvm, POMuNMucdj.jImtNgHXvm);
        fprintf(stderr, "q041%" PRIu64 "\nq042%zu\n",
                fUmKdgqecC->bNUgIxFrLQ, fUmKdgqecC->sACRbLjFXb);
        clock_t fYggbCGJfS = clock();
        if (aAfVpSGjmE != (clock_t)-1 && fYggbCGJfS != (clock_t)-1) {
            fprintf(stderr, "q043%.6f\n", (double)(fYggbCGJfS - aAfVpSGjmE) / CLOCKS_PER_SEC);
        }
    }
    if (fflush(stdout) == EOF) HNQkXxeURo(fUmKdgqecC, "q044%s", strerror(errno));
    rdtAKwAvxQ(fUmKdgqecC);
    free(fUmKdgqecC);
    return 0;
}
