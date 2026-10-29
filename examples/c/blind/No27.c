#include <stdio.h>
typedef int (*LDsorIBOUk)(const int *, const int *);
static int EnlcflvtYt(const int *TppTGvmUHW, const int *BNdcrezBWA) { return (*TppTGvmUHW > *BNdcrezBWA) - (*TppTGvmUHW < *BNdcrezBWA); }
static void vWLTjaPIIW(int *TppTGvmUHW, int *BNdcrezBWA) { int QPQowcipTC = *TppTGvmUHW; *TppTGvmUHW = *BNdcrezBWA; *BNdcrezBWA = QPQowcipTC; }
static size_t PHsyPeGEdM(int *TppTGvmUHW, size_t ywzFgruYSN, size_t EBrBYMLJWl, LDsorIBOUk AAzNOcexLY) {
    int QPQowcipTC = TppTGvmUHW[EBrBYMLJWl - 1];
    size_t UooehPNPDd = ywzFgruYSN;
    for (size_t DoeSRYtGnJ = ywzFgruYSN; DoeSRYtGnJ + 1 < EBrBYMLJWl; ++DoeSRYtGnJ) {
        if (AAzNOcexLY(&TppTGvmUHW[DoeSRYtGnJ], &QPQowcipTC) < 0) vWLTjaPIIW(&TppTGvmUHW[UooehPNPDd++], &TppTGvmUHW[DoeSRYtGnJ]);
    }
    vWLTjaPIIW(&TppTGvmUHW[UooehPNPDd], &TppTGvmUHW[EBrBYMLJWl - 1]);
    return UooehPNPDd;
}
static void KOMiotzePa(int *TppTGvmUHW, size_t ywzFgruYSN, size_t EBrBYMLJWl, LDsorIBOUk AAzNOcexLY) {
    if (EBrBYMLJWl - ywzFgruYSN < 2) return;
    size_t gUAmAZsbji = PHsyPeGEdM(TppTGvmUHW, ywzFgruYSN, EBrBYMLJWl, AAzNOcexLY);
    KOMiotzePa(TppTGvmUHW, ywzFgruYSN, gUAmAZsbji, AAzNOcexLY);
    KOMiotzePa(TppTGvmUHW, gUAmAZsbji + 1, EBrBYMLJWl, AAzNOcexLY);
}
int main(void) {
    int TppTGvmUHW[6] = {5, 2, 5, 1, 4, 2};
    LDsorIBOUk AVLxzNYjIX = EnlcflvtYt;
    KOMiotzePa(TppTGvmUHW, 0, 6, AVLxzNYjIX);
    for (size_t UooehPNPDd = 0; UooehPNPDd < 6; ++UooehPNPDd) printf("%d%c", TppTGvmUHW[UooehPNPDd], UooehPNPDd == 5 ? '\n' : ' ');
    return 0;
}
