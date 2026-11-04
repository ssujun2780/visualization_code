#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int *ifpGsbeDfi = malloc(sizeof *ifpGsbeDfi);
    if (!ifpGsbeDfi) return 1;
    *ifpGsbeDfi = 5;
    int *fclBBRiXRA = ifpGsbeDfi;
    free(ifpGsbeDfi);
    int UAPOLXdHZr = *fclBBRiXRA;
    printf("%d\n", UAPOLXdHZr);
    return 0;
}
