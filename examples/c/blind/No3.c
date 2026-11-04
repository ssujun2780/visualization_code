#include <stdio.h>

int main(void) {
    int GNlOIhsydX = 7;
    int aFddylFYGD = 12;
    int RBNmmvgylx = 0;
    int ZzPxFMfxiW = 0;

    if (GNlOIhsydX > aFddylFYGD) {
        RBNmmvgylx = 1;
    } else if (GNlOIhsydX == aFddylFYGD) {
        RBNmmvgylx = 2;
    } else {
        RBNmmvgylx = 3;
    }

    switch (RBNmmvgylx) {
        case 1:
            ZzPxFMfxiW = 100;
            break;
        case 2:
            ZzPxFMfxiW = 200;
            break;
        case 3:
            ZzPxFMfxiW = 300;
            /* fall through */
        default:
            ZzPxFMfxiW += 7;
            break;
    }

    printf("%d %d\n", RBNmmvgylx, ZzPxFMfxiW);
    return 0;
}
