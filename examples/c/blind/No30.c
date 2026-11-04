#include <stdio.h>
#include <stdlib.h>
typedef struct LVxTcEjlAb LVxTcEjlAb;
struct LVxTcEjlAb { int EYKsRfXTOj; LVxTcEjlAb *PgDUrctyqe; };
static int lYyRFlCefh(LVxTcEjlAb **IrffekluyV, int EYKsRfXTOj) {
    while (*IrffekluyV) IrffekluyV = &(*IrffekluyV)->PgDUrctyqe;
    LVxTcEjlAb *QVUQdqNyIp = malloc(sizeof *QVUQdqNyIp);
    if (!QVUQdqNyIp) return 0;
    *QVUQdqNyIp = (LVxTcEjlAb){.EYKsRfXTOj = EYKsRfXTOj, .PgDUrctyqe = NULL};
    *IrffekluyV = QVUQdqNyIp;
    return 1;
}
static void YAMLFWoPRd(LVxTcEjlAb *const *qaJKUkkett, int *BJUKrwvphf, int HYnKXtjrIW) {
    BJUKrwvphf[HYnKXtjrIW] = 1;
    printf("%d", HYnKXtjrIW);
    for (const LVxTcEjlAb *dsXlkBzBRV = qaJKUkkett[HYnKXtjrIW]; dsXlkBzBRV; dsXlkBzBRV = dsXlkBzBRV->PgDUrctyqe)
        if (!BJUKrwvphf[dsXlkBzBRV->EYKsRfXTOj]) YAMLFWoPRd(qaJKUkkett, BJUKrwvphf, dsXlkBzBRV->EYKsRfXTOj);
}
static void uBEaZNZSee(LVxTcEjlAb **qaJKUkkett) {
    for (int SQrAtungyl = 0; SQrAtungyl < 6; ++SQrAtungyl) {
        while (qaJKUkkett[SQrAtungyl]) {
            LVxTcEjlAb *klfulDhnii = qaJKUkkett[SQrAtungyl]; qaJKUkkett[SQrAtungyl] = klfulDhnii->PgDUrctyqe; free(klfulDhnii);
        }
    }
}
int main(void) {
    LVxTcEjlAb *qaJKUkkett[6] = {NULL};
    const int ggcDBcBbGu[7][2] = {{0,1},{0,2},{1,3},{1,4},{2,4},{3,0},{4,5}};
    for (size_t SQrAtungyl = 0; SQrAtungyl < 7; ++SQrAtungyl) {
        if (!lYyRFlCefh(&qaJKUkkett[ggcDBcBbGu[SQrAtungyl][0]], ggcDBcBbGu[SQrAtungyl][1])) { uBEaZNZSee(qaJKUkkett); return 1; }
    }
    int BJUKrwvphf[6] = {0};
    YAMLFWoPRd(qaJKUkkett, BJUKrwvphf, 0); putchar('\n');
    for (int SQrAtungyl = 0; SQrAtungyl < 6; ++SQrAtungyl) BJUKrwvphf[SQrAtungyl] = 0;
    int POvVHKGoxm[6]; size_t IrffekluyV = 0, sUdqVLhQDi = 0;
    POvVHKGoxm[sUdqVLhQDi++] = 0; BJUKrwvphf[0] = 1;
    while (IrffekluyV < sUdqVLhQDi) {
        int HYnKXtjrIW = POvVHKGoxm[IrffekluyV++];
        printf("%d", HYnKXtjrIW);
        for (const LVxTcEjlAb *dsXlkBzBRV = qaJKUkkett[HYnKXtjrIW]; dsXlkBzBRV; dsXlkBzBRV = dsXlkBzBRV->PgDUrctyqe) {
            if (!BJUKrwvphf[dsXlkBzBRV->EYKsRfXTOj]) { BJUKrwvphf[dsXlkBzBRV->EYKsRfXTOj] = 1; POvVHKGoxm[sUdqVLhQDi++] = dsXlkBzBRV->EYKsRfXTOj; }
        }
    }
    putchar('\n');
    uBEaZNZSee(qaJKUkkett);
    return 0;
}
