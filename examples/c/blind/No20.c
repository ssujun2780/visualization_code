#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int *uojAyBRTBp = malloc(4 * sizeof *uojAyBRTBp);
    int *zdFkacrHSG = calloc(4, sizeof *zdFkacrHSG);
    if (!uojAyBRTBp || !zdFkacrHSG) { free(uojAyBRTBp); free(zdFkacrHSG); return 1; }
    for (int gCTVTGUgAg = 0; gCTVTGUgAg < 4; ++gCTVTGUgAg) uojAyBRTBp[gCTVTGUgAg] = gCTVTGUgAg + 1;
    for (int gCTVTGUgAg = 0; gCTVTGUgAg < 4; ++gCTVTGUgAg) printf("%d%c", uojAyBRTBp[gCTVTGUgAg], gCTVTGUgAg == 3 ? '\n' : ' ');
    for (int gCTVTGUgAg = 0; gCTVTGUgAg < 4; ++gCTVTGUgAg) printf("%d%c", zdFkacrHSG[gCTVTGUgAg], gCTVTGUgAg == 3 ? '\n' : ' ');
    int *EESAVGERsV = uojAyBRTBp;
    EESAVGERsV[1] = 9;
    printf("%d %d\n", uojAyBRTBp[1], EESAVGERsV == uojAyBRTBp);
    free(EESAVGERsV);
    uojAyBRTBp = NULL;
    EESAVGERsV = NULL;
    free(zdFkacrHSG);
    zdFkacrHSG = NULL;
    printf("%d %d %d\n", uojAyBRTBp == NULL, EESAVGERsV == NULL, zdFkacrHSG == NULL);
    return 0;
}
