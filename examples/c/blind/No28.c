#include <stdio.h>
#include <assert.h>
typedef struct { int RcmdarwJWL[8]; size_t oynrwDkvDd; } JcysYepkPu;
static void YgwRyacoKe(int *moAotDgExp, int *idxFhZRBvV) { int VsZHbCLAEP = *moAotDgExp; *moAotDgExp = *idxFhZRBvV; *idxFhZRBvV = VsZHbCLAEP; }
static void GaXWEyjNxj(JcysYepkPu *TcduhUEPzX, int VsZHbCLAEP) {
    assert(TcduhUEPzX->oynrwDkvDd < 8);
    size_t EJsYSnXsAd = TcduhUEPzX->oynrwDkvDd++;
    TcduhUEPzX->RcmdarwJWL[EJsYSnXsAd] = VsZHbCLAEP;
    while (EJsYSnXsAd > 0) {
        size_t ReoUcfmiNy = (EJsYSnXsAd - 1) / 2;
        if (TcduhUEPzX->RcmdarwJWL[ReoUcfmiNy] >= TcduhUEPzX->RcmdarwJWL[EJsYSnXsAd]) break;
        YgwRyacoKe(&TcduhUEPzX->RcmdarwJWL[ReoUcfmiNy], &TcduhUEPzX->RcmdarwJWL[EJsYSnXsAd]);
        EJsYSnXsAd = ReoUcfmiNy;
    }
}
static int WanwwWUiMs(JcysYepkPu *TcduhUEPzX) {
    assert(TcduhUEPzX->oynrwDkvDd);
    int VsZHbCLAEP = TcduhUEPzX->RcmdarwJWL[0];
    TcduhUEPzX->RcmdarwJWL[0] = TcduhUEPzX->RcmdarwJWL[--TcduhUEPzX->oynrwDkvDd];
    size_t EJsYSnXsAd = 0;
    while (2 * EJsYSnXsAd + 1 < TcduhUEPzX->oynrwDkvDd) {
        size_t zZSGZhbZtO = 2 * EJsYSnXsAd + 1;
        if (zZSGZhbZtO + 1 < TcduhUEPzX->oynrwDkvDd && TcduhUEPzX->RcmdarwJWL[zZSGZhbZtO + 1] > TcduhUEPzX->RcmdarwJWL[zZSGZhbZtO]) ++zZSGZhbZtO;
        if (TcduhUEPzX->RcmdarwJWL[EJsYSnXsAd] >= TcduhUEPzX->RcmdarwJWL[zZSGZhbZtO]) break;
        YgwRyacoKe(&TcduhUEPzX->RcmdarwJWL[EJsYSnXsAd], &TcduhUEPzX->RcmdarwJWL[zZSGZhbZtO]);
        EJsYSnXsAd = zZSGZhbZtO;
    }
    return VsZHbCLAEP;
}
int main(void) {
    JcysYepkPu TcduhUEPzX = {0};
    int KGNyAHGzNo[6] = {5, 2, 8, 1, 3, 9};
    for (size_t EJsYSnXsAd = 0; EJsYSnXsAd < 6; ++EJsYSnXsAd) GaXWEyjNxj(&TcduhUEPzX, KGNyAHGzNo[EJsYSnXsAd]);
    for (size_t EJsYSnXsAd = 0; EJsYSnXsAd < TcduhUEPzX.oynrwDkvDd; ++EJsYSnXsAd)
        printf("%d%c", TcduhUEPzX.RcmdarwJWL[EJsYSnXsAd], EJsYSnXsAd + 1 == TcduhUEPzX.oynrwDkvDd ? '\n' : ' ');
    while (TcduhUEPzX.oynrwDkvDd) {
        int VsZHbCLAEP = WanwwWUiMs(&TcduhUEPzX);
        printf("%d%c", VsZHbCLAEP, TcduhUEPzX.oynrwDkvDd ? ' ' : '\n');
    }
    return 0;
}
