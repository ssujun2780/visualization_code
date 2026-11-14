#include <stdio.h>
int twice(int x){return x*2;}
int main(void){
	/* 한글 주석: 📦 */ int 값=3;
	int 합계=twice(값)+4;
	printf("결과=%d\n",합계);
	return 0;
}
