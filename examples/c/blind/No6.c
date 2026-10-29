#include <stdio.h>

int main(void) {
    int IlorWJBzZD = 5;
    int KgWKbPzoyQ = IlorWJBzZD++;
    printf("%d %d\n", IlorWJBzZD, KgWKbPzoyQ);

    int rswYwqwzLW = ++IlorWJBzZD;
    printf("%d %d\n", IlorWJBzZD, rswYwqwzLW);

    KgWKbPzoyQ += IlorWJBzZD++;
    printf("%d %d\n", IlorWJBzZD, KgWKbPzoyQ);

    rswYwqwzLW *= ++IlorWJBzZD;
    printf("%d %d\n", IlorWJBzZD, rswYwqwzLW);

    int GiEfykyEgf = 20;
    GiEfykyEgf -= KgWKbPzoyQ;
    GiEfykyEgf /= 2;
    GiEfykyEgf %= 3;
    printf("%d\n", GiEfykyEgf);

    int jzSqpFVzHK[3] = {10, 20, 30};
    int pzzsphZlaI = 0;
    jzSqpFVzHK[pzzsphZlaI++] += 5;
    printf("%d %d %d %d\n", pzzsphZlaI,
           jzSqpFVzHK[0], jzSqpFVzHK[1], jzSqpFVzHK[2]);

    return 0;
}
