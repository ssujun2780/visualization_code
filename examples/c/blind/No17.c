#include <stdio.h>
#include <stddef.h>
_Static_assert(sizeof(unsigned char) == 1, "0");
static int xaDEWAZtid(int mfYfdfWOdH) { return mfYfdfWOdH + 1; }
static double PXIIBVvuan(double mfYfdfWOdH) { return mfYfdfWOdH + 0.5; }
#define hRJKKsRIoF(mfYfdfWOdH) _Generic((mfYfdfWOdH), int: xaDEWAZtid, double: PXIIBVvuan)(mfYfdfWOdH)
int main(void) {
    int DqAuhliewT = 2;
    size_t HPkltoXGMs = sizeof(++DqAuhliewT);
    int KqpttomeKY = _Generic(++DqAuhliewT, int: DqAuhliewT + 10, default: -1);
    printf("%d %d %d\n", DqAuhliewT, KqpttomeKY, HPkltoXGMs == sizeof(int));
    printf("%d %.1f\n", hRJKKsRIoF(3), hRJKKsRIoF(2.0));
    printf("%d\n", _Alignof(int) <= _Alignof(max_align_t));
    return 0;
}
