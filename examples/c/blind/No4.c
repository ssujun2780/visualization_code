#include <stdio.h>

int main(void) {
    int nSlNaIMlPN = 0;
    int OAYbLHOOnc = 0;

    for (OAYbLHOOnc = 1; OAYbLHOOnc <= 8; OAYbLHOOnc++) {
        if (OAYbLHOOnc == 3) {
            continue;
        }
        if (OAYbLHOOnc == 7) {
            break;
        }
        nSlNaIMlPN += OAYbLHOOnc;
    }

    int UvjGcxpdbY = 0;
    int qlaFjmIHWC = 5;

    while (qlaFjmIHWC > 0) {
        qlaFjmIHWC--;
        if (qlaFjmIHWC == 2) {
            continue;
        }
        UvjGcxpdbY += qlaFjmIHWC;
    }

    int hoUXZvUMZJ = 0;
    int MhxjfzmEXh = 0;

    do {
        hoUXZvUMZJ += MhxjfzmEXh + 1;
        MhxjfzmEXh++;
    } while (MhxjfzmEXh < 3);

    printf("%d %d\n", nSlNaIMlPN, OAYbLHOOnc);
    printf("%d %d\n", UvjGcxpdbY, qlaFjmIHWC);
    printf("%d %d\n", hoUXZvUMZJ, MhxjfzmEXh);
    return 0;
}
