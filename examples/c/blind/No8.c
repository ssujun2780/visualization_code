#include <stdio.h>

int main(void) {
    int zQggcFlRXJ[5] = {3, 6};
    int yrvZEcPOhc[5] = {[1] = 10, [3] = 20};
    int IgwDDUJzFS[5];

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", zQggcFlRXJ[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", yrvZEcPOhc[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        IgwDDUJzFS[xuuTWTUmCR] = zQggcFlRXJ[xuuTWTUmCR] + yrvZEcPOhc[xuuTWTUmCR];
    }

    zQggcFlRXJ[0] = 99;
    yrvZEcPOhc[3] = -5;

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", IgwDDUJzFS[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        yrvZEcPOhc[xuuTWTUmCR] = IgwDDUJzFS[xuuTWTUmCR];
    }

    IgwDDUJzFS[1] += 4;

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", zQggcFlRXJ[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", yrvZEcPOhc[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    for (int xuuTWTUmCR = 0; xuuTWTUmCR < 5; xuuTWTUmCR++) {
        printf("%d%c", IgwDDUJzFS[xuuTWTUmCR], xuuTWTUmCR == 4 ? '\n' : ' ');
    }

    return 0;
}
