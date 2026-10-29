#include <stdio.h>
#include <assert.h>
typedef struct { int XCAbwgpaMK[4]; size_t lTivTprTZt; } rJNAToCnNB;
typedef struct { int XCAbwgpaMK[4]; size_t vyASrtgcRD, lTivTprTZt; } zypVPYJRei;
static void rlmgxknAjU(rJNAToCnNB *AjVqNosfCl, int OubvZnyupJ) {
    assert(AjVqNosfCl->lTivTprTZt < 4);
    AjVqNosfCl->XCAbwgpaMK[AjVqNosfCl->lTivTprTZt++] = OubvZnyupJ;
}
static int CeeriHHpSV(rJNAToCnNB *AjVqNosfCl) {
    assert(AjVqNosfCl->lTivTprTZt);
    return AjVqNosfCl->XCAbwgpaMK[--AjVqNosfCl->lTivTprTZt];
}
static void QhFYwBIVkt(zypVPYJRei *qmavpXshXN, int OubvZnyupJ) {
    assert(qmavpXshXN->lTivTprTZt < 4);
    qmavpXshXN->XCAbwgpaMK[(qmavpXshXN->vyASrtgcRD + qmavpXshXN->lTivTprTZt) % 4] = OubvZnyupJ;
    ++qmavpXshXN->lTivTprTZt;
}
static int CZKztTrmTe(zypVPYJRei *qmavpXshXN) {
    assert(qmavpXshXN->lTivTprTZt);
    int OubvZnyupJ = qmavpXshXN->XCAbwgpaMK[qmavpXshXN->vyASrtgcRD];
    qmavpXshXN->vyASrtgcRD = (qmavpXshXN->vyASrtgcRD + 1) % 4;
    --qmavpXshXN->lTivTprTZt;
    return OubvZnyupJ;
}
int main(void) {
    rJNAToCnNB AjVqNosfCl = {0};
    rlmgxknAjU(&AjVqNosfCl, 10); rlmgxknAjU(&AjVqNosfCl, 20); rlmgxknAjU(&AjVqNosfCl, 30);
    printf("%d ", CeeriHHpSV(&AjVqNosfCl));
    printf("%d ", CeeriHHpSV(&AjVqNosfCl));
    rlmgxknAjU(&AjVqNosfCl, 40);
    printf("%d ", CeeriHHpSV(&AjVqNosfCl));
    printf("%d\n", CeeriHHpSV(&AjVqNosfCl));
    zypVPYJRei qmavpXshXN = {0};
    QhFYwBIVkt(&qmavpXshXN, 1); QhFYwBIVkt(&qmavpXshXN, 2); QhFYwBIVkt(&qmavpXshXN, 3);
    printf("%d ", CZKztTrmTe(&qmavpXshXN));
    printf("%d\n", CZKztTrmTe(&qmavpXshXN));
    QhFYwBIVkt(&qmavpXshXN, 4); QhFYwBIVkt(&qmavpXshXN, 5); QhFYwBIVkt(&qmavpXshXN, 6);
    for (size_t xQNFuXVBHf = 0; xQNFuXVBHf < 4; ++xQNFuXVBHf) printf("%d%c", qmavpXshXN.XCAbwgpaMK[xQNFuXVBHf], xQNFuXVBHf == 3 ? '\n' : ' ');
    while (qmavpXshXN.lTivTprTZt) {
        int OubvZnyupJ = CZKztTrmTe(&qmavpXshXN);
        printf("%d%c", OubvZnyupJ, qmavpXshXN.lTivTprTZt ? ' ' : '\n');
    }
    printf("%zu %zu\n", AjVqNosfCl.lTivTprTZt, qmavpXshXN.lTivTprTZt);
    return 0;
}
