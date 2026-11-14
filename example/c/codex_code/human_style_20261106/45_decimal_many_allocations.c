#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void* allocate(size_t n){void*p=malloc(n);if(!p)exit(1);return p;}
static char* duplicate(const char*s){size_t n=strlen(s);char*p=allocate(n+1);memcpy(p,s,n+1);return p;}
static char* reversed(const char*s){size_t n=strlen(s);char*p=allocate(n+1);for(size_t i=0;i<n;i++)p[i]=s[n-1-i];p[n]=0;return p;}
static char* add(const char*a,const char*b){char*x=reversed(a),*y=reversed(b);size_t na=strlen(x),nb=strlen(y),n=na>nb?na:nb;char*t=allocate(n+2);int carry=0;size_t i=0;
 for(;i<n;i++){int left=i<na?x[i]-'0':0;int right=i<nb?y[i]-'0':0;int sum=left+right+carry;t[i]=(char)('0'+sum%10);carry=sum/10;}
 if(carry)t[i++]=(char)('0'+carry);t[i]=0;char*r=reversed(t);free(x);free(y);free(t);return r;}
static char* digit_product(const char*a,int digit){if(!digit)return duplicate("0");char*x=reversed(a);size_t n=strlen(x);char*t=allocate(n+2);int carry=0;size_t i=0;
 for(;i<n;i++){int product=(x[i]-'0')*digit+carry;t[i]=(char)('0'+product%10);carry=product/10;}
 if(carry)t[i++]=(char)('0'+carry);t[i]=0;char*r=reversed(t);free(x);free(t);return r;}
static char* shifted(const char*s,size_t places){if(s[0]=='0'&&s[1]==0)return duplicate(s);size_t n=strlen(s);char*p=allocate(n+places+1);memcpy(p,s,n);for(size_t i=0;i<places;i++)p[n+i]='0';p[n+places]=0;return p;}
static char* multiply(const char*a,const char*b){char*sum=duplicate("0");size_t n=strlen(b);for(size_t i=0;i<n;i++){char*part=digit_product(a,b[n-1-i]-'0');char*shift=shifted(part,i);char*next=add(sum,shift);free(sum);free(part);free(shift);sum=next;}return sum;}
int main(void){char a[40],b[40];if(scanf("%39s %39s",a,b)!=2)return 1;char*answer=multiply(a,b);puts(answer);free(answer);return 0;}
