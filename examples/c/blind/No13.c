#include <stdio.h>
#include <stdlib.h>
int main(void) {
    size_t zlLFlQrsNV[3] = {2, 4, 1};
    int *lhXmovpLWT[3] = {NULL, NULL, NULL};
    for (size_t xkpsJbWfiI = 0; xkpsJbWfiI < 3; ++xkpsJbWfiI) {
        lhXmovpLWT[xkpsJbWfiI] = malloc(zlLFlQrsNV[xkpsJbWfiI] * sizeof *lhXmovpLWT[xkpsJbWfiI]);
        if (!lhXmovpLWT[xkpsJbWfiI]) {
            for (size_t wDqKddujwd = 0; wDqKddujwd < xkpsJbWfiI; ++wDqKddujwd) free(lhXmovpLWT[wDqKddujwd]);
            return 1;
        }
        for (size_t wDqKddujwd = 0; wDqKddujwd < zlLFlQrsNV[xkpsJbWfiI]; ++wDqKddujwd)
            lhXmovpLWT[xkpsJbWfiI][wDqKddujwd] = (int)(xkpsJbWfiI * 10 + wDqKddujwd);
    }
    int *RcwKrxgdXC = lhXmovpLWT[1];
    RcwKrxgdXC[2] = 99;
    for (size_t xkpsJbWfiI = 0; xkpsJbWfiI < 3; ++xkpsJbWfiI) {
        for (size_t wDqKddujwd = 0; wDqKddujwd < zlLFlQrsNV[xkpsJbWfiI]; ++wDqKddujwd)
            printf("%d%c", lhXmovpLWT[xkpsJbWfiI][wDqKddujwd], wDqKddujwd + 1 == zlLFlQrsNV[xkpsJbWfiI] ? '\n' : ' ');
    }
    printf("%d %zu\n", RcwKrxgdXC == lhXmovpLWT[1], zlLFlQrsNV[1]);
    for (size_t xkpsJbWfiI = 0; xkpsJbWfiI < 3; ++xkpsJbWfiI) { free(lhXmovpLWT[xkpsJbWfiI]); lhXmovpLWT[xkpsJbWfiI] = NULL; }
    RcwKrxgdXC = NULL;
    return 0;
}
