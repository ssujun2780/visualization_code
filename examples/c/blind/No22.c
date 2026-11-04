#include <stdio.h>
#include <stdlib.h>
typedef struct QnSyIEgKoW QnSyIEgKoW;
struct QnSyIEgKoW { int xfkjjfXVoD; QnSyIEgKoW *ueaqmdreCc; };
static int bfWkgqetCu(QnSyIEgKoW **PQxsDSPfVo, int xfkjjfXVoD) {
    QnSyIEgKoW *rsdxKzaCWs = malloc(sizeof *rsdxKzaCWs);
    if (!rsdxKzaCWs) return 0;
    *rsdxKzaCWs = (QnSyIEgKoW){.xfkjjfXVoD = xfkjjfXVoD, .ueaqmdreCc = *PQxsDSPfVo};
    *PQxsDSPfVo = rsdxKzaCWs;
    return 1;
}
static int FchrLfYYKW(QnSyIEgKoW **PQxsDSPfVo, int xfkjjfXVoD) {
    QnSyIEgKoW **xJpEQdRgPg = PQxsDSPfVo;
    while (*xJpEQdRgPg && (*xJpEQdRgPg)->xfkjjfXVoD != xfkjjfXVoD) xJpEQdRgPg = &(*xJpEQdRgPg)->ueaqmdreCc;
    if (!*xJpEQdRgPg) return 0;
    QnSyIEgKoW *JEqvaHmOpE = *xJpEQdRgPg;
    *xJpEQdRgPg = JEqvaHmOpE->ueaqmdreCc;
    free(JEqvaHmOpE);
    return 1;
}
static void EEQNtrTcgu(const QnSyIEgKoW *PQxsDSPfVo) {
    for (const QnSyIEgKoW *DrFnXkpdOF = PQxsDSPfVo; DrFnXkpdOF; DrFnXkpdOF = DrFnXkpdOF->ueaqmdreCc)
        printf("%d%c", DrFnXkpdOF->xfkjjfXVoD, DrFnXkpdOF->ueaqmdreCc ? ' ' : '\n');
}
int main(void) {
    QnSyIEgKoW *PQxsDSPfVo = NULL;
    for (int cFLWdFUyuZ = 1; cFLWdFUyuZ <= 3; ++cFLWdFUyuZ) {
        if (!bfWkgqetCu(&PQxsDSPfVo, cFLWdFUyuZ)) {
            while (PQxsDSPfVo) { QnSyIEgKoW *JEqvaHmOpE = PQxsDSPfVo; PQxsDSPfVo = JEqvaHmOpE->ueaqmdreCc; free(JEqvaHmOpE); }
            return 1;
        }
    }
    EEQNtrTcgu(PQxsDSPfVo);
    printf("%d\n", FchrLfYYKW(&PQxsDSPfVo, 2));
    EEQNtrTcgu(PQxsDSPfVo);
    printf("%d\n", FchrLfYYKW(&PQxsDSPfVo, 3));
    EEQNtrTcgu(PQxsDSPfVo);
    while (PQxsDSPfVo) { QnSyIEgKoW *JEqvaHmOpE = PQxsDSPfVo; PQxsDSPfVo = JEqvaHmOpE->ueaqmdreCc; free(JEqvaHmOpE); }
    printf("%d\n", PQxsDSPfVo == NULL);
    return 0;
}
