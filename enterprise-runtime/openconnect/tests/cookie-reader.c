#include <stdio.h>
#include <string.h>
int main(void){char value[128];if(!fgets(value,sizeof(value),stdin))return 2;if(strcmp(value,"fictional-cookie\n"))return 3;puts("cookie pipe verified");return 0;}
