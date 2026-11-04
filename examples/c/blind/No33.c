#include <stdio.h>
#include <string.h>
int main(void) {
    const char eakLqHHFBq[] = "ABCD", YMHJwpsjso[] = "ACBD";
    size_t hDGtmqskzl[5][5] = {{0}};
    for (size_t riSfkYHGxi = 1; riSfkYHGxi <= 4; ++riSfkYHGxi) {
        for (size_t qYVSyCOaUF = 1; qYVSyCOaUF <= 4; ++qYVSyCOaUF) {
            if (eakLqHHFBq[riSfkYHGxi - 1] == YMHJwpsjso[qYVSyCOaUF - 1]) hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF] = hDGtmqskzl[riSfkYHGxi - 1][qYVSyCOaUF - 1] + 1;
            else hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF] = hDGtmqskzl[riSfkYHGxi - 1][qYVSyCOaUF] >= hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF - 1]
                ? hDGtmqskzl[riSfkYHGxi - 1][qYVSyCOaUF] : hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF - 1];
        }
    }
    for (size_t riSfkYHGxi = 0; riSfkYHGxi <= 4; ++riSfkYHGxi) {
        for (size_t qYVSyCOaUF = 0; qYVSyCOaUF <= 4; ++qYVSyCOaUF)
            printf("%zu%c", hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF], qYVSyCOaUF == 4 ? '\n' : ' ');
    }
    char TRnhQtEMum[5] = {0};
    size_t UkdROLSTvc = hDGtmqskzl[4][4], riSfkYHGxi = 4, qYVSyCOaUF = 4, urQGjIjRTB = UkdROLSTvc;
    while (riSfkYHGxi && qYVSyCOaUF) {
        if (eakLqHHFBq[riSfkYHGxi - 1] == YMHJwpsjso[qYVSyCOaUF - 1]) { TRnhQtEMum[--urQGjIjRTB] = eakLqHHFBq[riSfkYHGxi - 1]; --riSfkYHGxi; --qYVSyCOaUF; }
        else if (hDGtmqskzl[riSfkYHGxi - 1][qYVSyCOaUF] >= hDGtmqskzl[riSfkYHGxi][qYVSyCOaUF - 1]) --riSfkYHGxi;
        else --qYVSyCOaUF;
    }
    printf("%zu %s\n", UkdROLSTvc, TRnhQtEMum);
    return 0;
}
