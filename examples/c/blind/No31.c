#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
typedef struct bwITRAgwyT bwITRAgwyT;
struct bwITRAgwyT { unsigned pdYInekCSX; int AvkTHHPOCZ; bwITRAgwyT *pcRRsHCZkk; };
typedef struct { bwITRAgwyT **ctgqcHNwoA; size_t cHVUubZRrN, pqFbXvemrw; } WMKrmdWawn;
static int uuTYAxqKZs(WMKrmdWawn *KJbSaZgaiD) {
    if (KJbSaZgaiD->cHVUubZRrN > SIZE_MAX / 2) return 0;
    size_t cHVUubZRrN = KJbSaZgaiD->cHVUubZRrN ? 2 * KJbSaZgaiD->cHVUubZRrN : 2;
    if (cHVUubZRrN > SIZE_MAX / sizeof *KJbSaZgaiD->ctgqcHNwoA) return 0;
    bwITRAgwyT **ctgqcHNwoA = malloc(cHVUubZRrN * sizeof *ctgqcHNwoA);
    if (!ctgqcHNwoA) return 0;
    for (size_t lWkApidfvY = 0; lWkApidfvY < cHVUubZRrN; ++lWkApidfvY) ctgqcHNwoA[lWkApidfvY] = NULL;
    for (size_t lWkApidfvY = 0; lWkApidfvY < KJbSaZgaiD->cHVUubZRrN; ++lWkApidfvY) {
        bwITRAgwyT *LXzMelNaCx = KJbSaZgaiD->ctgqcHNwoA[lWkApidfvY];
        while (LXzMelNaCx) {
            bwITRAgwyT *pcRRsHCZkk = LXzMelNaCx->pcRRsHCZkk;
            size_t TPcZjNlenk = LXzMelNaCx->pdYInekCSX % cHVUubZRrN;
            LXzMelNaCx->pcRRsHCZkk = ctgqcHNwoA[TPcZjNlenk]; ctgqcHNwoA[TPcZjNlenk] = LXzMelNaCx; LXzMelNaCx = pcRRsHCZkk;
        }
    }
    free(KJbSaZgaiD->ctgqcHNwoA);
    KJbSaZgaiD->ctgqcHNwoA = ctgqcHNwoA; KJbSaZgaiD->cHVUubZRrN = cHVUubZRrN;
    return 1;
}
static bwITRAgwyT *wNmDclKEHO(const WMKrmdWawn *KJbSaZgaiD, unsigned pdYInekCSX) {
    if (!KJbSaZgaiD->cHVUubZRrN) return NULL;
    for (bwITRAgwyT *LXzMelNaCx = KJbSaZgaiD->ctgqcHNwoA[pdYInekCSX % KJbSaZgaiD->cHVUubZRrN]; LXzMelNaCx; LXzMelNaCx = LXzMelNaCx->pcRRsHCZkk)
        if (LXzMelNaCx->pdYInekCSX == pdYInekCSX) return LXzMelNaCx;
    return NULL;
}
static int nqdyyvlceY(WMKrmdWawn *KJbSaZgaiD, unsigned pdYInekCSX, int AvkTHHPOCZ) {
    bwITRAgwyT *LXzMelNaCx = wNmDclKEHO(KJbSaZgaiD, pdYInekCSX);
    if (LXzMelNaCx) { LXzMelNaCx->AvkTHHPOCZ = AvkTHHPOCZ; return 1; }
    if (KJbSaZgaiD->pqFbXvemrw == KJbSaZgaiD->cHVUubZRrN && !uuTYAxqKZs(KJbSaZgaiD)) return 0;
    LXzMelNaCx = malloc(sizeof *LXzMelNaCx);
    if (!LXzMelNaCx) return 0;
    size_t TPcZjNlenk = pdYInekCSX % KJbSaZgaiD->cHVUubZRrN;
    *LXzMelNaCx = (bwITRAgwyT){.pdYInekCSX = pdYInekCSX, .AvkTHHPOCZ = AvkTHHPOCZ, .pcRRsHCZkk = KJbSaZgaiD->ctgqcHNwoA[TPcZjNlenk]};
    KJbSaZgaiD->ctgqcHNwoA[TPcZjNlenk] = LXzMelNaCx; ++KJbSaZgaiD->pqFbXvemrw;
    return 1;
}
static int rJwEGXEkPp(WMKrmdWawn *KJbSaZgaiD, unsigned pdYInekCSX) {
    if (!KJbSaZgaiD->cHVUubZRrN) return 0;
    bwITRAgwyT **KbmSbXClKh = &KJbSaZgaiD->ctgqcHNwoA[pdYInekCSX % KJbSaZgaiD->cHVUubZRrN];
    while (*KbmSbXClKh && (*KbmSbXClKh)->pdYInekCSX != pdYInekCSX) KbmSbXClKh = &(*KbmSbXClKh)->pcRRsHCZkk;
    if (!*KbmSbXClKh) return 0;
    bwITRAgwyT *ZoUTFYoRdI = *KbmSbXClKh; *KbmSbXClKh = ZoUTFYoRdI->pcRRsHCZkk; free(ZoUTFYoRdI); --KJbSaZgaiD->pqFbXvemrw;
    return 1;
}
static void LFXbYLSsuq(WMKrmdWawn *KJbSaZgaiD) {
    for (size_t lWkApidfvY = 0; lWkApidfvY < KJbSaZgaiD->cHVUubZRrN; ++lWkApidfvY) {
        while (KJbSaZgaiD->ctgqcHNwoA[lWkApidfvY]) {
            bwITRAgwyT *ZoUTFYoRdI = KJbSaZgaiD->ctgqcHNwoA[lWkApidfvY]; KJbSaZgaiD->ctgqcHNwoA[lWkApidfvY] = ZoUTFYoRdI->pcRRsHCZkk; free(ZoUTFYoRdI);
        }
    }
    free(KJbSaZgaiD->ctgqcHNwoA); *KJbSaZgaiD = (WMKrmdWawn){0};
}
int main(void) {
    WMKrmdWawn KJbSaZgaiD = {0};
    unsigned TQyTeBzQhF[4] = {1, 5, 9, 2};
    int vTcNCsQpus[4] = {10, 50, 90, 20};
    for (size_t lWkApidfvY = 0; lWkApidfvY < 4; ++lWkApidfvY) {
        if (!nqdyyvlceY(&KJbSaZgaiD, TQyTeBzQhF[lWkApidfvY], vTcNCsQpus[lWkApidfvY])) { LFXbYLSsuq(&KJbSaZgaiD); return 1; }
    }
    printf("%zu %zu\n", KJbSaZgaiD.pqFbXvemrw, KJbSaZgaiD.cHVUubZRrN);
    printf("%d\n", wNmDclKEHO(&KJbSaZgaiD, 5)->AvkTHHPOCZ);
    if (!nqdyyvlceY(&KJbSaZgaiD, 5, 55)) { LFXbYLSsuq(&KJbSaZgaiD); return 1; }
    printf("%d\n", wNmDclKEHO(&KJbSaZgaiD, 5)->AvkTHHPOCZ);
    printf("%d\n", rJwEGXEkPp(&KJbSaZgaiD, 1));
    printf("%d %zu %zu\n", wNmDclKEHO(&KJbSaZgaiD, 9)->AvkTHHPOCZ, KJbSaZgaiD.pqFbXvemrw, KJbSaZgaiD.cHVUubZRrN);
    printf("%d\n", wNmDclKEHO(&KJbSaZgaiD, 1) != NULL);
    LFXbYLSsuq(&KJbSaZgaiD);
    return 0;
}
