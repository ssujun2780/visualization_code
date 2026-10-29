#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
typedef struct { void *EfqOKABsMH; size_t NCKprRUlLU, NamUtcOdxO, kXlfSvmuXU; } uhHGBkiRJV;
static int fzxWwpFKDm(uhHGBkiRJV *omBvBMZmlJ, const void *BAEBhrtraa) {
    if (omBvBMZmlJ->NCKprRUlLU == omBvBMZmlJ->NamUtcOdxO) {
        if (omBvBMZmlJ->NamUtcOdxO > SIZE_MAX / 2) return 0;
        size_t NamUtcOdxO = omBvBMZmlJ->NamUtcOdxO ? omBvBMZmlJ->NamUtcOdxO * 2 : 2;
        if (!omBvBMZmlJ->kXlfSvmuXU || NamUtcOdxO > SIZE_MAX / omBvBMZmlJ->kXlfSvmuXU) return 0;
        void *EfqOKABsMH = realloc(omBvBMZmlJ->EfqOKABsMH, NamUtcOdxO * omBvBMZmlJ->kXlfSvmuXU);
        if (!EfqOKABsMH) return 0;
        omBvBMZmlJ->EfqOKABsMH = EfqOKABsMH;
        omBvBMZmlJ->NamUtcOdxO = NamUtcOdxO;
    }
    memcpy((unsigned char *)omBvBMZmlJ->EfqOKABsMH + omBvBMZmlJ->NCKprRUlLU * omBvBMZmlJ->kXlfSvmuXU, BAEBhrtraa, omBvBMZmlJ->kXlfSvmuXU);
    ++omBvBMZmlJ->NCKprRUlLU;
    return 1;
}
int main(void) {
    uhHGBkiRJV omBvBMZmlJ = {.EfqOKABsMH = NULL, .NCKprRUlLU = 0, .NamUtcOdxO = 0, .kXlfSvmuXU = sizeof(int)};
    int RZpCPaQMkK[5] = {3, 1, 4, 1, 5};
    for (size_t GlWBFjKUuZ = 0; GlWBFjKUuZ < 5; ++GlWBFjKUuZ) {
        if (!fzxWwpFKDm(&omBvBMZmlJ, &RZpCPaQMkK[GlWBFjKUuZ])) { free(omBvBMZmlJ.EfqOKABsMH); return 1; }
    }
    printf("%zu %zu\n", omBvBMZmlJ.NCKprRUlLU, omBvBMZmlJ.NamUtcOdxO);
    int *EWRfLhrUxW = omBvBMZmlJ.EfqOKABsMH;
    for (size_t GlWBFjKUuZ = 0; GlWBFjKUuZ < omBvBMZmlJ.NCKprRUlLU; ++GlWBFjKUuZ)
        printf("%d%c", EWRfLhrUxW[GlWBFjKUuZ], GlWBFjKUuZ + 1 == omBvBMZmlJ.NCKprRUlLU ? '\n' : ' ');
    free(omBvBMZmlJ.EfqOKABsMH);
    omBvBMZmlJ.EfqOKABsMH = NULL;
    return 0;
}
