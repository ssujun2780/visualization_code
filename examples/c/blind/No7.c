#include <stdio.h>

int GiqiZRdpMI = 10;

static int LtVyjYOKEd(void) {
    static int acsLjVYYlz = 0;
    int UXQJYSLGln = 0;

    acsLjVYYlz++;
    UXQJYSLGln++;
    printf("%d %d\n", acsLjVYYlz, UXQJYSLGln);
    return acsLjVYYlz;
}

int main(void) {
    printf("%d\n", GiqiZRdpMI);

    {
        int GiqiZRdpMI = 20;
        printf("%d\n", GiqiZRdpMI);

        {
            int GiqiZRdpMI = 30;
            GiqiZRdpMI++;
            printf("%d\n", GiqiZRdpMI);
        }

        printf("%d\n", GiqiZRdpMI);
    }

    printf("%d\n", GiqiZRdpMI);

    int hahxZqtnAK = LtVyjYOKEd();
    int OJBdtxlPaG = LtVyjYOKEd();
    printf("%d %d %d\n", hahxZqtnAK, OJBdtxlPaG, GiqiZRdpMI);
    return 0;
}
