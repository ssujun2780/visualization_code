#include <stdio.h>
#include <string.h>

int main(void) {
    char vPBERxySfE[12] = "abc";
    char VhPTLabjXh[12] = {0};
    const char *shBdIxJWSL = "xyz";

    printf("%zu %zu\n", sizeof vPBERxySfE, strlen(vPBERxySfE));
    printf("%zu %zu\n", sizeof "xyz", strlen(shBdIxJWSL));

    strcpy(VhPTLabjXh, vPBERxySfE);
    vPBERxySfE[0] = 'A';
    strcat(VhPTLabjXh, "de");
    printf("%s %s\n", vPBERxySfE, VhPTLabjXh);

    char mQjExnOqJe[6] = {'p', 'q', '\0', 'r', 's', '\0'};
    printf("%zu %zu\n", sizeof mQjExnOqJe, strlen(mQjExnOqJe));

    for (size_t NvbCdFlnaU = 0; NvbCdFlnaU < sizeof mQjExnOqJe; NvbCdFlnaU++) {
        if (mQjExnOqJe[NvbCdFlnaU] == '\0') {
            putchar('0');
        } else {
            putchar(mQjExnOqJe[NvbCdFlnaU]);
        }
    }
    putchar('\n');

    mQjExnOqJe[2] = '-';
    printf("%s %zu\n", mQjExnOqJe, strlen(mQjExnOqJe));

    char GBDIZPfKlO[12] = {0};
    memcpy(GBDIZPfKlO, VhPTLabjXh, strlen(VhPTLabjXh) + 1);
    memmove(GBDIZPfKlO + 1, GBDIZPfKlO, strlen(GBDIZPfKlO) + 1);
    GBDIZPfKlO[0] = '+';
    printf("%s %s\n", VhPTLabjXh, GBDIZPfKlO);

    return 0;
}
