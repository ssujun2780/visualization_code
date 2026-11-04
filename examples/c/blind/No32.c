#include <stdio.h>
static int esyXKXthwU(int *pMPRdIhWMk, int yqZrKQTrTu) {
    if (pMPRdIhWMk[yqZrKQTrTu] != yqZrKQTrTu) pMPRdIhWMk[yqZrKQTrTu] = esyXKXthwU(pMPRdIhWMk, pMPRdIhWMk[yqZrKQTrTu]);
    return pMPRdIhWMk[yqZrKQTrTu];
}
static void BGPKoPTXtu(int *pMPRdIhWMk, int *quBNMTPctT, int yFDpFXyhAm, int nSJsSamXnt) {
    yFDpFXyhAm = esyXKXthwU(pMPRdIhWMk, yFDpFXyhAm); nSJsSamXnt = esyXKXthwU(pMPRdIhWMk, nSJsSamXnt);
    if (yFDpFXyhAm == nSJsSamXnt) return;
    if (quBNMTPctT[yFDpFXyhAm] < quBNMTPctT[nSJsSamXnt]) { int yqZrKQTrTu = yFDpFXyhAm; yFDpFXyhAm = nSJsSamXnt; nSJsSamXnt = yqZrKQTrTu; }
    pMPRdIhWMk[nSJsSamXnt] = yFDpFXyhAm; quBNMTPctT[yFDpFXyhAm] += quBNMTPctT[nSJsSamXnt];
}
static void EjZLaJmqCq(const int *IldxTaxTUh) {
    for (int hwEMdnRfkv = 0; hwEMdnRfkv < 7; ++hwEMdnRfkv) printf("%d%c", IldxTaxTUh[hwEMdnRfkv], hwEMdnRfkv == 6 ? '\n' : ' ');
}
int main(void) {
    int pMPRdIhWMk[7], quBNMTPctT[7];
    for (int hwEMdnRfkv = 0; hwEMdnRfkv < 7; ++hwEMdnRfkv) { pMPRdIhWMk[hwEMdnRfkv] = hwEMdnRfkv; quBNMTPctT[hwEMdnRfkv] = 1; }
    BGPKoPTXtu(pMPRdIhWMk, quBNMTPctT, 0, 1); BGPKoPTXtu(pMPRdIhWMk, quBNMTPctT, 2, 3);
    BGPKoPTXtu(pMPRdIhWMk, quBNMTPctT, 4, 5); BGPKoPTXtu(pMPRdIhWMk, quBNMTPctT, 2, 4);
    BGPKoPTXtu(pMPRdIhWMk, quBNMTPctT, 0, 2);
    EjZLaJmqCq(pMPRdIhWMk);
    int yFDpFXyhAm = esyXKXthwU(pMPRdIhWMk, 1), nSJsSamXnt = esyXKXthwU(pMPRdIhWMk, 5);
    printf("%d %d\n", yFDpFXyhAm, nSJsSamXnt);
    EjZLaJmqCq(pMPRdIhWMk);
    printf("%d %d\n", quBNMTPctT[esyXKXthwU(pMPRdIhWMk, 0)], quBNMTPctT[esyXKXthwU(pMPRdIhWMk, 6)]);
    return 0;
}
