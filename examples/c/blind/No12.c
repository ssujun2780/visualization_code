#include <stdio.h>
#include <stddef.h>
int main(void) {
    int muuvlAtPtu[2][3] = {{1, 2, 3}, {4, 5, 6}};
    int (*hCIoTbZYYC)[3] = muuvlAtPtu;
    hCIoTbZYYC[1][0] = hCIoTbZYYC[0][2] + 10;
    ++hCIoTbZYYC;
    (*hCIoTbZYYC)[2] += 20;
    for (size_t WnhWaZjSkf = 0; WnhWaZjSkf < 2; ++WnhWaZjSkf) {
        for (size_t pchQQFJhUv = 0; pchQQFJhUv < 3; ++pchQQFJhUv)
            printf("%d%c", muuvlAtPtu[WnhWaZjSkf][pchQQFJhUv], pchQQFJhUv == 2 ? '\n' : ' ');
    }
    printf("%td %zu %zu\n", hCIoTbZYYC - muuvlAtPtu, sizeof muuvlAtPtu / sizeof muuvlAtPtu[0],
           sizeof muuvlAtPtu[0] / sizeof muuvlAtPtu[0][0]);
    printf("%d\n", (unsigned char *)&muuvlAtPtu[1] ==
           (unsigned char *)&muuvlAtPtu + sizeof muuvlAtPtu[0]);
    return 0;
}
