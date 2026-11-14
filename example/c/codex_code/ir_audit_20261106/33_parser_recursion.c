#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
typedef struct {const char *cursor;int ok;int operations;} Parser;
typedef struct {long value;int ok;} Result;
static Result expression(Parser *p);
static void space(Parser *p){while(isspace((unsigned char)*p->cursor))p->cursor++;}
static Result factor(Parser *p){
 space(p);Result result={0,1};
 if(*p->cursor=='('){
  p->cursor++;result=expression(p);space(p);
  if(*p->cursor!=')'){p->ok=0;result.ok=0;}else p->cursor++;
 }else{
  char *end;result.value=strtol(p->cursor,&end,10);
  if(end==p->cursor){p->ok=0;result.ok=0;}else p->cursor=end;
 }
 return result;
}
static Result term(Parser *p){
 Result value=factor(p);space(p);
 while(p->ok && *p->cursor=='*'){
  p->cursor++;Result rhs=factor(p);value.value*=rhs.value;p->operations++;space(p);
 }
 return value;
}
static Result expression(Parser *p){
 Result value=term(p);space(p);
 while(p->ok && (*p->cursor=='+'||*p->cursor=='-')){
  char op=*p->cursor++;Result rhs=term(p);
  value.value=(op=='+')?value.value+rhs.value:value.value-rhs.value;
  p->operations++;space(p);
 }
 return value;
}
int main(void){
 Parser p={"2*(3+4)-5+6*2",1,0};Result answer=expression(&p);
 printf("%ld %d %d %d\n",answer.value,p.ok&&answer.ok,p.operations,*p.cursor==0);
 return 0;
}
