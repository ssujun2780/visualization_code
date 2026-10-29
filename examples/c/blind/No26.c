#include <stdio.h>
typedef struct { int FnvoMcfFeg, WNVRufncEM; } HyeZKcdsXd;
static void JUazuxCYeM(HyeZKcdsXd *BikhiDnEhD, HyeZKcdsXd *FQmmKOkTci, size_t SGVynYvYKO, size_t QRojrkmIgN, size_t VPGHmZlMEN) {
    size_t bnZcRRszAX = SGVynYvYKO, rBLjprNMRQ = QRojrkmIgN, KArTXLMIXH = SGVynYvYKO;
    while (bnZcRRszAX < QRojrkmIgN && rBLjprNMRQ < VPGHmZlMEN) {
        if (BikhiDnEhD[bnZcRRszAX].FnvoMcfFeg <= BikhiDnEhD[rBLjprNMRQ].FnvoMcfFeg) {
            FQmmKOkTci[KArTXLMIXH].FnvoMcfFeg = BikhiDnEhD[bnZcRRszAX].FnvoMcfFeg;
            FQmmKOkTci[KArTXLMIXH++].WNVRufncEM = BikhiDnEhD[bnZcRRszAX++].WNVRufncEM;
        } else {
            FQmmKOkTci[KArTXLMIXH].FnvoMcfFeg = BikhiDnEhD[rBLjprNMRQ].FnvoMcfFeg;
            FQmmKOkTci[KArTXLMIXH++].WNVRufncEM = BikhiDnEhD[rBLjprNMRQ++].WNVRufncEM;
        }
    }
    while (bnZcRRszAX < QRojrkmIgN) {
        FQmmKOkTci[KArTXLMIXH].FnvoMcfFeg = BikhiDnEhD[bnZcRRszAX].FnvoMcfFeg;
        FQmmKOkTci[KArTXLMIXH++].WNVRufncEM = BikhiDnEhD[bnZcRRszAX++].WNVRufncEM;
    }
    while (rBLjprNMRQ < VPGHmZlMEN) {
        FQmmKOkTci[KArTXLMIXH].FnvoMcfFeg = BikhiDnEhD[rBLjprNMRQ].FnvoMcfFeg;
        FQmmKOkTci[KArTXLMIXH++].WNVRufncEM = BikhiDnEhD[rBLjprNMRQ++].WNVRufncEM;
    }
    for (KArTXLMIXH = SGVynYvYKO; KArTXLMIXH < VPGHmZlMEN; ++KArTXLMIXH) {
        BikhiDnEhD[KArTXLMIXH].FnvoMcfFeg = FQmmKOkTci[KArTXLMIXH].FnvoMcfFeg;
        BikhiDnEhD[KArTXLMIXH].WNVRufncEM = FQmmKOkTci[KArTXLMIXH].WNVRufncEM;
    }
}
static void zZUFVngtWH(HyeZKcdsXd *BikhiDnEhD, HyeZKcdsXd *FQmmKOkTci, size_t SGVynYvYKO, size_t VPGHmZlMEN) {
    if (VPGHmZlMEN - SGVynYvYKO < 2) return;
    size_t QRojrkmIgN = SGVynYvYKO + (VPGHmZlMEN - SGVynYvYKO) / 2;
    zZUFVngtWH(BikhiDnEhD, FQmmKOkTci, SGVynYvYKO, QRojrkmIgN);
    zZUFVngtWH(BikhiDnEhD, FQmmKOkTci, QRojrkmIgN, VPGHmZlMEN);
    JUazuxCYeM(BikhiDnEhD, FQmmKOkTci, SGVynYvYKO, QRojrkmIgN, VPGHmZlMEN);
}
int main(void) {
    HyeZKcdsXd BikhiDnEhD[6] = {{4, 0}, {1, 1}, {3, 2}, {1, 3}, {2, 4}, {4, 5}};
    HyeZKcdsXd FQmmKOkTci[6];
    zZUFVngtWH(BikhiDnEhD, FQmmKOkTci, 0, 6);
    for (size_t bnZcRRszAX = 0; bnZcRRszAX < 6; ++bnZcRRszAX)
        printf("%d:%d%c", BikhiDnEhD[bnZcRRszAX].FnvoMcfFeg, BikhiDnEhD[bnZcRRszAX].WNVRufncEM, bnZcRRszAX == 5 ? '\n' : ' ');
    return 0;
}
